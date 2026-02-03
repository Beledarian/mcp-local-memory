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

  constructor(db: Database, embedder?: EmbedderFn) {
    this.db = db;
    this.embedder = embedder;
  }

  async process(text: string, memoryId?: string): Promise<void> {
    console.error(`[NlpArchivist] Processing: "${text.substring(0, 50)}..."`);
    const doc = nlp(text);
    
    // Improved extraction using tags and matches
    const people = doc.people().out('array');
    const places = doc.places().out('array');
    const orgs = doc.organizations().out('array');
    
    // Fallback: Catch-all for capitalized nouns that might be entities
    // We filter out common sentence-starting non-entities
    const stopWords = new Set(['The', 'A', 'An', 'He', 'She', 'They', 'It', 'This', 'That', 'These', 'Those', 'In', 'On', 'At', 'To', 'From', 'With']);
    const nouns = doc.terms().out('array')
        .filter((n: string) => /^[A-Z]/.test(n))
        .map((n: string) => n.replace(/[.,!?]$/, "").trim())
        .filter((n: string) => !stopWords.has(n))
        .filter((n: string) => n.length > 2);
    
    // Improved Prefix detection for Places/People
    const prefixed = doc.match('(in|at|from|the) #TitleCase').out('array')
        .map((t: string) => t.split(' ').slice(1).join(' ').replace(/[.,!?]$/, "").trim())
        .filter((t: string) => t.length > 2 && !stopWords.has(t));

    // Specific match for Projects (e.g. "Project Alpha", "Operation X")
    let projects = doc.match('(project|operation|initiative) #TitleCase').out('array');
    if (projects.length === 0) {
        projects = doc.match('(project|operation|initiative) .').out('array');
    }

    console.error(`[NlpArchivist] Found - People: ${people.length}, Places: ${places.length}, Orgs: ${orgs.length}, Projects: ${projects.length}, Nouns: ${nouns.length}, Prefixed: ${prefixed.length}`);

    const ensureEntity = async (name: string, type: string) => {
        const cleanName = name.replace(/[.,!?]$/, "").trim();
        if (cleanName.length < 2) return;
        
        try {
            // Check for existing entity via fuzzy match
            const existing = this.db.prepare(`SELECT id, name FROM entities WHERE levenshtein(name, ?) <= 2 LIMIT 1`).get(cleanName) as any;
            if (existing) {
                console.error(`[NlpArchivist] Resolved '${cleanName}' to existing '${existing.name}'`);
                return;
            }

            const id = uuidv4();
            this.db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, cleanName, type, '[]');
            console.error(`[NlpArchivist] Extracted: ${cleanName} (${type})`);
            
            // Generate Embedding if available
            if (this.embedder) {
                try {
                    const vector = await this.embedder(cleanName + " " + type);
                    const float32 = new Float32Array(vector);
                    this.db.prepare('INSERT INTO vec_entities (rowid, embedding) VALUES ((SELECT rowid FROM entities WHERE id = ?), ?)').run(id, Buffer.from(float32.buffer));
                } catch (err: any) {
                    console.warn(`[NlpArchivist] Failed to embed entity '${cleanName}':`, err.message);
                }
            }

        } catch (e: any) {
             if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') console.error("Insert Entity Error:", e.message);
        }
    };

    // Parallelize entity creation
    const entityPromises: Promise<void>[] = [];
    people.forEach((name: string) => entityPromises.push(ensureEntity(name, 'Person')));
    places.forEach((name: string) => entityPromises.push(ensureEntity(name, 'Place')));
    orgs.forEach((name: string) => entityPromises.push(ensureEntity(name, 'Organization')));
    projects.forEach((name: string) => entityPromises.push(ensureEntity(name, 'Project')));
    nouns.forEach((name: string) => entityPromises.push(ensureEntity(name, 'Entity')));
    prefixed.forEach((name: string) => entityPromises.push(ensureEntity(name, 'Location/Target')));

    await Promise.all(entityPromises);

    // Update Memory Tags and create basic Relations
    if (memoryId) {
        const allEntities = [...new Set([...people, ...places, ...orgs, ...projects, ...nouns, ...prefixed])].map(e => e.replace(/[.,!?]$/, "").trim());
        if (allEntities.length > 0) {
            try {
                const existing = this.db.prepare('SELECT tags FROM memories WHERE id = ?').get(memoryId) as any;
                let tags = [];
                try { tags = JSON.parse(existing.tags || '[]'); } catch (e) {}
                
                const newTags = [...new Set([...tags, ...allEntities])];
                this.db.prepare('UPDATE memories SET tags = ? WHERE id = ?').run(JSON.stringify(newTags), memoryId);
                console.error(`[NlpArchivist] Tagged memory ${memoryId} with: ${allEntities.join(', ')}`);

                // Basic Relation Extraction (A [predicate] B)
                if (allEntities.length >= 2) {
                    const sentences = doc.sentences().json() as any[];
                    sentences.forEach(s => {
                        const sDoc = nlp(s.text);
                        const sEntities = allEntities.filter(e => s.text.includes(e));
                        if (sEntities.length >= 2) {
                            // Extract relations with granular sentiment
                            let verb = 'related_to';
                            
                            const hateMatch = sDoc.match('(hate|hates|loathe|loathes|detest|detests)');
                            const dislikeMatch = sDoc.match('(dislike|dislikes|not like|not likes)');
                            const loveMatch = sDoc.match('(love|loves|adore|adores|worship|worships)');
                            const likeMatch = sDoc.match('(like|likes|prefer|prefers|enjoy|enjoys)');
                            const containMatch = sDoc.match('(contains|includes|consists of|has|have)');
                            const madeOfMatch = sDoc.match('(made of|composed of|built with|built from)');
                            const useMatch = sDoc.match('(uses|utilizes|employs|using)');

                            if (hateMatch.found) {
                                verb = 'hates';
                            } else if (dislikeMatch.found) {
                                verb = 'dislikes';
                            } else if (loveMatch.found) {
                                verb = 'loves';
                            } else if (likeMatch.found) {
                                verb = 'likes';
                            } else if (containMatch.found) {
                                verb = 'contains';
                            } else if (madeOfMatch.found) {
                                verb = 'made_of';
                            } else if (useMatch.found) {
                                verb = 'uses';
                            } else {
                                verb = sDoc.verbs().first().out('normal') || 'related_to';
                            }
                            
                            // Link first entity to others in the same sentence
                            const source = sEntities[0];
                            for (let i = 1; i < sEntities.length; i++) {
                                try {
                                    this.db.prepare(`
                                        INSERT OR IGNORE INTO relations (source, target, relation) 
                                        VALUES (?, ?, ?)
                                    `).run(source, sEntities[i], verb);
                                    console.error(`[NlpArchivist] Extracted Relation: ${source} -> ${verb} -> ${sEntities[i]}`);
                                } catch (e) {}
                            }
                        }
                    });
                }
            } catch (err: any) { 
                console.error("Failed to update tags/relations:", err.message); 
            }
        }
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
