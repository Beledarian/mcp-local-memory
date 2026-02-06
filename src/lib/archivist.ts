import { Database } from 'better-sqlite3';
import nlp from 'compromise';
// @ts-ignore
import { v4 as uuidv4 } from 'uuid';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Archivist {
  process(text: string, memoryId?: string): Promise<void>;
}

export class CompositeArchivist implements Archivist {
    private archivists: Archivist[];

    constructor(archivists: Archivist[]) {
        this.archivists = archivists;
    }

    async process(text: string, memoryId?: string): Promise<void> {
        await Promise.all(this.archivists.map(a => a.process(text, memoryId)));
    }
}

export class WorkerArchivist implements Archivist {
    private worker: Worker;

    constructor(dbPath: string) {
        // Detect if we are in a TS environment (approximate check)
        // If the current file is .ts, we assume we might need tsx to run the worker?
        // Actually, simple heuristic: try to find worker.js, if not calculate worker.ts
        const workerPath = path.resolve(__dirname, 'worker.js'); // Default for dist
        const devWorkerPath = path.resolve(__dirname, 'worker.ts'); // For tsx dev
        
        const isTs = __filename.endsWith('.ts');
        
        const finalPath = isTs ? devWorkerPath : workerPath;
        
        console.error(`[WorkerArchivist] Spawning worker from ${finalPath}`);

        // If running in TS (dev), we assume we need tsx/esm loader
        const workerOptions: any = {
            workerData: { dbPath }
        };

        if (isTs) {
            workerOptions.execArgv = ['--import', 'tsx/esm'];
        }
        
        this.worker = new Worker(finalPath, workerOptions);
        
        this.worker.on('error', (err) => console.error("[WorkerArchivist] Worker Error:", err));
        this.worker.on('exit', (code) => {
            if (code !== 0) console.error(`[WorkerArchivist] Worker stopped with exit code ${code}`);
        });
    }

    async process(text: string, memoryId?: string): Promise<void> {
        this.worker.postMessage({ text, memoryId });
    }
}

export class PassiveArchivist implements Archivist {
  async process(text: string, memoryId?: string): Promise<void> {
    console.error(`[PassiveArchivist] Ignoring text: "${text.substring(0, 50)}..."`);
  }
}


type EmbedderFn = (text: string) => Promise<number[]>;

export class NlpArchivist implements Archivist {
  private db: Database;
  private embedder?: EmbedderFn;
  private insertTransaction: (data: any) => void;
  private language: string;

  constructor(db: Database, embedder?: EmbedderFn, language: string = 'en') {
    this.db = db;
    this.embedder = embedder;
    this.language = language;
    
    // Warn if non-English
    if (this.language !== 'en') {
        console.warn(`[NlpArchivist] Language '${this.language}' requested, but only 'en' is fully supported by the current NLP engine.`);
    }
    
    // Pre-compile the transaction for performance/atomicity
    this.insertTransaction = this.db.transaction((data: any) => {
        const { memoryId, entities, relations, tags } = data;

        // 1. Tags Update
        if (memoryId && tags.length > 0) {
            try {
                const existing = this.db.prepare('SELECT tags FROM memories WHERE id = ?').get(memoryId) as any;
                let currentTags = [];
                try { currentTags = JSON.parse(existing?.tags || '[]'); } catch (e) {}
                const newTags = [...new Set([...currentTags, ...tags])];
                this.db.prepare('UPDATE memories SET tags = ? WHERE id = ?').run(JSON.stringify(newTags), memoryId);
            } catch (err) {}
        }

        // 2. Entities & Embeddings
        for (const e of entities) {
             const cleanName = e.name.replace(/[.,!?]$/, "").trim();
             if (cleanName.length < 2) continue;
             
             // Check existence logic can be inside or outside, but inside transaction is safer for consistency
             // We use a simple fuzzy check or exact match. For speed, exact match first.
             // Note: Levenshtein is expensive, so maybe skip allowed duplicates or rely on exact for now?
             // Let's stick to the previous logic but optimized:
             try {
                // Try Exact Match first (fast)
                let existing = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(cleanName) as any;
                
                // If not found, try fuzzy (slower)
                if (!existing) {
                    existing = this.db.prepare('SELECT id FROM entities WHERE levenshtein(name, ?) <= 2 LIMIT 1').get(cleanName) as any;
                }

                if (!existing) {
                    const id = uuidv4();
                    this.db.prepare('INSERT INTO entities (id, name, type, observations, importance) VALUES (?, ?, ?, ?, ?)').run(id, cleanName, e.type, '[]', 0.5);
                    // Embeddings must be handled OUTSIDE the blocking transaction if they are async/slow?
                    // Actually, better-sqlite3 transactions are synchronous. We can't await inside.
                    // So we must gather IDs here and return them for embedding? 
                    // OR: We store the embedding *data* passed in.
                    if (e.embedding) {
                        this.db.prepare('INSERT INTO vec_entities (rowid, embedding) VALUES ((SELECT rowid FROM entities WHERE id = ?), ?)').run(id, e.embedding);
                    }
                }
             } catch (err: any) {
                 if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') console.error("[NlpArchivist] Entity Error:", err.message);
             }
        }

        // 3. Relations
        for (const r of relations) {
            try {
                this.db.prepare(`INSERT OR IGNORE INTO relations (source, target, relation) VALUES (?, ?, ?)`).run(r.source, r.target, r.relation);
            } catch (e) {}
        }
    });
  }

  async process(text: string, memoryId?: string): Promise<void> {
    const doc = nlp(text);
    
    // --- Extraction Logic ---
    
    // 1. People, Places, Orgs (Standard NER)
    const people = doc.people().out('array');
    const places = doc.places().out('array');
    const orgs = doc.organizations().out('array');
    
    // 2. Custom Tech/Project detection
    // Heuristic: Capitalized words that follow "Project", "Operation", or are known tech terms?
    // User global rule: "WGSL", "SoA", "L1". These are often Nouns or Acronyms.
    const acronyms = doc.terms().filter((t: any) => {
        const text = typeof t.text === 'function' ? t.text() : (t.text || '');
        return typeof text === 'string' && text.length > 1 && text === text.toUpperCase() && /^[A-Z0-9]+$/.test(text);
    }).out('array');
    
    // Robust Project Detection
    let projects: string[] = [];
    const textStr = typeof doc.text === 'function' ? doc.text() : doc.text || '';
    if (typeof textStr === 'string') {
        const matches = textStr.matchAll(/(?:Project|Operation|Initiative)\s+([A-Z][a-z0-9]+)/g);
        for (const m of matches) {
            if (m[1]) projects.push("Project " + m[1]);
        }
    }
    
    // Fallback if Regex failed (sometimes spacing/encoding varies)
    if (projects.length === 0) {
        const fallback = doc.match('(project|operation|initiative) .').out('array');
        // Filter to ensure TitleCase
        fallback.forEach((p: string) => {
            if (/[A-Z]/.test(p)) projects.push(p); 
        });
    }
    
    // 3. General Concepts (Capitalized Nouns)
    // Capture things like "WorkerArchivist", "DbPath", "Strategies".
    // Strategy: Filter for capitalized noun terms.
    const concepts = doc.match('#Noun')
        .not('#Pronoun')
        .terms().out('array')
        .map((n: string) => n.replace(/[.,!?]$/, "")) // Remove trailing punctuation
        .filter((n: string) => /^[A-Z][a-zA-Z0-9-]*$/.test(n)) // Allow CamelCase and hyphens
        .filter((n: string) => n.length > 2 && !['The', 'This', 'That'].includes(n))
        .filter((n: string) => !n.endsWith('-')); // Remove if ends with lone hyphen

    // 4. Complex Concepts (Modifiers + Capitalized Noun)
    // Captures: "optimized WGSL", "perfectly written WGSL", "fast Code"
    // Strategy: Look for modifier chains (Adj/Verb/Adverb) directly before a Capitalized Noun
    // But exclude the main sentence verb by using a more targeted pattern
    // OPT-OUT: Can be disabled via EXTRACT_COMPLEX_CONCEPTS=false
    const complexConcepts: string[] = [];
    const extractComplexConcepts = process.env.EXTRACT_COMPLEX_CONCEPTS !== 'false';
    
    if (extractComplexConcepts) {
        // Pattern 1: #Verb #Noun (e.g., "optimized WGSL")
        doc.match('#Verb #Noun').forEach((match: any) => {
            const text = typeof match.text === 'function' ? match.text() : match.text;
            if (typeof text === 'string') {
                const terms = text.split(' ');
                const head = terms[terms.length - 1].replace(/[.,!?]$/, "");
                if (/^[A-Z][a-zA-Z0-9-]*$/.test(head) && !head.endsWith('-') && terms.length > 1) {
                    complexConcepts.push(text.replace(/[.,!?]$/, ""));
                }
            }
        });
        
        // Pattern 2: #Adverb #Verb #Noun (e.g., "perfectly written WGSL")
        doc.match('#Adverb #Verb #Noun').forEach((match: any) => {
            const text = typeof match.text === 'function' ? match.text() : match.text;
            if (typeof text === 'string') {
                const terms = text.split(' ');
                const head = terms[terms.length - 1].replace(/[.,!?]$/, "");
                if (/^[A-Z][a-zA-Z0-9-]*$/.test(head) && !head.endsWith('-') && terms.length > 1) {
                    complexConcepts.push(text.replace(/[.,!?]$/, ""));
                }
            }
        });
        
        // Pattern 3: #Adjective #Noun (e.g., "fast Code")
        doc.match('#Adjective #Noun').forEach((match: any) => {
            const text = typeof match.text === 'function' ? match.text() : match.text;
            if (typeof text === 'string') {
                const terms = text.split(' ');
                const head = terms[terms.length - 1].replace(/[.,!?]$/, "");
                if (/^[A-Z][a-zA-Z0-9-]*$/.test(head) && !head.endsWith('-') && terms.length > 1) {
                    complexConcepts.push(text.replace(/[.,!?]$/, ""));
                }
            }
        });
    }

    // 5. Standalone Adjectives (Quality/Traits)
    // Captures: "optimistic", "pragmatic", "efficient" as standalone concepts
    // Useful for tracking user preferences and traits
    const adjectives = doc.adjectives()
        .out('array')
        .map((adj: string) => adj.replace(/[.,!?]$/, ""))
        .filter((adj: string) => adj.length > 3); // Filter short/common words

    // Create Typed Entities
    const rawEntities = [
        ...people.map((n: string) => ({ name: n, type: 'Person' })),
        ...places.map((n: string) => ({ name: n, type: 'Place' })),
        ...orgs.map((n: string) => ({ name: n, type: 'Organization' })),
        ...projects.map((n: string) => ({ name: n, type: 'Project' })),
        ...acronyms.map((n: string) => ({ name: n, type: 'Concept' })),
        ...concepts.map((n: string) => ({ name: n, type: 'Concept' })),
        ...complexConcepts.map((n: string) => ({ name: n, type: 'Concept' })),
        ...adjectives.map((n: string) => ({ name: n, type: 'Trait' }))
    ];
    
    // 6. Hyphenated Compounds Reconstruction
    // compromise splits "LLM-powered" into ["LLM", "powered"], we need to stitch them back
    // Strategy: Look for capitalized terms followed by another term with a hyphen between them in original text
    const hyphenatedCompounds: Array<{name: string, type: string}> = [];
    const hyphenTextStr = typeof doc.text === 'function' ? doc.text() : doc.text || '';
    
    if (typeof hyphenTextStr === 'string') {
        // Match patterns like "LLM-powered", "PDF-parser", "WebGPU-based"
        // Must start with capital, then hyphen, then lowercase word
        const compoundMatches = hyphenTextStr.matchAll(/\b([A-Z][A-Za-z0-9]*)-([a-z][a-z]*)\b/g);
        for (const match of compoundMatches) {
            const compound = match[0]; // e.g., "LLM-powered"
            hyphenatedCompounds.push({ name: compound, type: 'Concept' });
        }
    }
    
    rawEntities.push(...hyphenatedCompounds);
    
    // Clean & Dedupe
    const stopWords = new Set(['The', 'A', 'An', 'This', 'That', 'These', 'Those', 'In', 'On']);
    const uniqueMap = new Map();
    
    rawEntities.forEach(e => {
        const clean = e.name.replace(/[.,!?]$/, "").trim();
        if (!stopWords.has(clean) && clean.length > 1) {
            // Priority: specific types overwrite generic 'Entity'
            if (!uniqueMap.has(clean) || (uniqueMap.get(clean).type === 'Entity' && e.type !== 'Entity')) {
                uniqueMap.set(clean, { name: clean, type: e.type, embedding: null as Buffer | null });
            }
        }
    });

    const entities = Array.from(uniqueMap.values());

    // Pre-calculate Embeddings (Async) before Transaction
    if (this.embedder) {
        await Promise.all(entities.map(async (e) => {
            try {
                const vec = await this.embedder!(e.name + " " + e.type);
                e.embedding = Buffer.from(new Float32Array(vec).buffer);
            } catch (err) {}
        }));
    }

    // --- Relation Extraction (Simple) ---
    // Link entities in the same sentence
    const relations: {source: string, target: string, relation: string}[] = [];
    const sentences = doc.sentences().json();
    
    const entityNames = new Set(entities.map(e => e.name));

    (sentences as any[]).forEach((s: any) => {
        const sentText = s.text;
        // Sort entities by appearance in sentence to preserve Source -> Target flow
        const sentEntities = entities
            .filter(e => sentText.includes(e.name))
            .sort((a, b) => sentText.indexOf(a.name) - sentText.indexOf(b.name));
        
        if (sentEntities.length >= 2) {
             const sDoc = nlp(sentText);
             let verb = '';
             let isPassive = false;
             
             // Check explicit emotional/structural verbs first
             if (sDoc.match('(hate|hates|loathe|loathes)').found) verb = 'hates';
             else if (sDoc.match('(dislike|dislikes|not like)').found) verb = 'dislikes';
             else if (sDoc.match('(love|loves|adore|adores)').found) verb = 'loves';
             else if (sDoc.match('(like|likes|prefer|prefers|enjoy)').found) verb = 'likes';
             else if (sDoc.match('(contains|includes|consists of|has)').found) verb = 'contains';
             else if (sDoc.match('(uses|utilizes|employs|using)').found) verb = 'uses';
             else if (sDoc.match('(requires|needs)').found) verb = 'requires';
             
             // Passive Voice Detection
             if (sDoc.match('(is used by|used by)').found) { verb = 'uses'; isPassive = true; }
             else if (sDoc.match('(is created by|created by|made by|authored by)').found) { verb = 'authored'; isPassive = true; }
             else if (sDoc.match('(is owned by|owned by)').found) { verb = 'owns'; isPassive = true; }
             else if (sDoc.match('(run on|runs on)').found) { verb = 'runs_on'; isPassive = false; } // Active: Server -> runs_on -> Linux

             // Fallback to first main verb if no specific one found
             if (!verb) {
                 verb = sDoc.verbs().first().out('normal') || 'related_to';
                 if (verb.includes(" by")) isPassive = true;
             }
             
             // Normalize Verb
             const cleanVerb = verb.replace(' by', ''); 

             if (isPassive) {
                 // Passive: "Python (0) is used by Alice (1)". Source = Alice (last), Target = Python (others)
                 // Passive: "A (0) and B (1) are used by C (2)". Source = C, Targets = A, B
                 const source = sentEntities[sentEntities.length - 1].name;
                 for (let i = 0; i < sentEntities.length - 1; i++) {
                     relations.push({ source, target: sentEntities[i].name, relation: cleanVerb });
                 }
             } else {
                 // Active: "Alice (0) uses A (1) and B (2)". Source = Alice, Targets = A, B
                 const source = sentEntities[0].name;
                 for (let i = 1; i < sentEntities.length; i++) {
                     relations.push({ source, target: sentEntities[i].name, relation: cleanVerb });
                 }
             }
        }
    });

    // Execute Transaction
    this.insertTransaction({
        memoryId,
        entities,
        relations,
        tags: [ ...entityNames ] // Auto-tag memory with found entities
    });
    
    // Log summary
    if (entities.length > 0) {
       // console.error(`[NlpArchivist] Extracted ${entities.length} entities & ${relations.length} relations.`);
    }
  }
}

export class LlmArchivist implements Archivist {
  private db: Database;
  private endpoint: string;
  private embedder?: EmbedderFn;

  constructor(db: Database, endpoint: string = 'http://localhost:11434/api/generate', embedder?: EmbedderFn) {
    this.db = db;
    this.endpoint = endpoint;
    this.embedder = embedder;
  }

  async process(text: string, memoryId?: string): Promise<void> {
    console.error(`[LlmArchivist] Sending to LLM: "${text.substring(0, 50)}..."`);
    // ... (Keep existing prompt logic, just update Entity Insertion part)
    // Actually simpler to just define prompt again to avoid complex partial replace blocks
    
    // For brevity in this diff, I will rely on the fact that I am replacing the class. 
    // I need to copy the prompt logic.
    const prompt = `
      Extract entities and relations from the text.
      Also rate the IMPORTANCE of this memory from 0.0 (trivial) to 1.0 (vital).
      Return JSON only:
      {
        "importance": 0.5,
        "entities": [{"name": "Name", "type": "Person", "observations": ["fact1"]}],
        "relations": [{"source": "EntityA", "target": "EntityB", "relation": "knows"}]
      }
      Text: "${text}"
    `;

    try {
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3', 
                prompt: prompt,
                stream: false,
                format: 'json'
            })
        });

        if (!response.ok) { console.error(`[LlmArchivist] LLM failed: ${response.statusText}`); return; }
        const data = await response.json();
        const json = JSON.parse(data.response); 

        // 1. Importance
        if (memoryId && typeof json.importance === 'number') {
            try { this.db.prepare('UPDATE memories SET importance = ? WHERE id = ?').run(json.importance, memoryId); } catch(e){}
        }

        // 2. Entities
        if (json.entities) {
            for (const e of json.entities) {
                 try {
                    const existing = this.db.prepare(`SELECT id, name FROM entities WHERE levenshtein(name, ?) <= 2 LIMIT 1`).get(e.name) as any;
                    if (existing) continue;

                    const id = uuidv4();
                    const imp = json.importance || 0.5;
                    this.db.prepare(`INSERT INTO entities (id, name, type, observations, importance) VALUES (?, ?, ?, ?, ?)`).run(id, e.name, e.type, JSON.stringify(e.observations || []), imp);
                    
                    // Embed
                    if (this.embedder) {
                        try {
                            const vec = await this.embedder(e.name + " " + e.type);
                            const f32 = new Float32Array(vec);
                            this.db.prepare('INSERT INTO vec_entities (rowid, embedding) VALUES ((SELECT rowid FROM entities WHERE id = ?), ?)').run(id, Buffer.from(f32.buffer));
                        } catch(err) { console.warn("[LlmArchivist] Embed failed:", err); }
                    }

                 } catch (err) {}
            }
        }

        // 3. Tags
        if (memoryId && json.entities?.length > 0) {
             const names = json.entities.map((e: any) => e.name);
             try {
                const existing = this.db.prepare('SELECT tags FROM memories WHERE id = ?').get(memoryId) as any;
                let tags = [];
                try { tags = JSON.parse(existing.tags || '[]'); } catch (e) {}
                const newTags = [...new Set([...tags, ...names])];
                this.db.prepare('UPDATE memories SET tags = ? WHERE id = ?').run(JSON.stringify(newTags), memoryId);
             } catch (err) {}
        }

        // 4. Relations
        if (json.relations) {
            for (const r of json.relations) {
                 // Ensure Stubs
                 [r.source, r.target].forEach(name => {
                     try {
                        const id = uuidv4();
                        this.db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, name, 'Unknown', '[]');
                     } catch(e) {}
                 });
                 try { this.db.prepare(`INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)`).run(r.source, r.target, r.relation); } catch(e) {}
            }
        }

    } catch (error) { console.error("[LlmArchivist] Error:", error); }
  }
}

export const getArchivist = (db: Database, embedder?: EmbedderFn): Archivist => {
    if (process.env.USE_WORKER === 'true') {
        return new WorkerArchivist(db.name);
    }

    const strategyEnv = process.env.ARCHIVIST_STRATEGY || 'nlp';
    console.error(`Initializing Archivist with strategy: ${strategyEnv}`);
    
    const strategies = strategyEnv.split(',').map(s => s.trim().toLowerCase());
    const archivists: Archivist[] = [];

    if (strategies.includes('nlp')) archivists.push(new NlpArchivist(db, embedder));
    if (strategies.includes('llm')) archivists.push(new LlmArchivist(db, process.env.OLLAMA_URL, embedder));
    
    if (archivists.length === 0) {
        return new PassiveArchivist();
    }
    
    return new CompositeArchivist(archivists);
};
