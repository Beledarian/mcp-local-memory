import { Database } from 'better-sqlite3';
import nlp from 'compromise';
// @ts-ignore
import { v4 as uuidv4 } from 'uuid';

export interface Archivist {
  process(text: string): Promise<void>;
}

export class PassiveArchivist implements Archivist {
  async process(text: string): Promise<void> {
    console.error(`[PassiveArchivist] Ignoring text: "${text.substring(0, 50)}..."`);
  }
}

export class NlpArchivist implements Archivist {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async process(text: string): Promise<void> {
    console.error(`[NlpArchivist] Processing: "${text.substring(0, 50)}..."`);
    const doc = nlp(text);
    
    // Improved extraction using tags and matches
    const people = doc.people().out('array');
    const places = doc.places().out('array');
    const orgs = doc.organizations().out('array');
    
    // Catch-all for capitalized nouns that might be entities
    const nouns = doc.match('#ProperNoun').out('array');

    console.error(`[Debug] Found - People: ${people.length}, Places: ${places.length}, Orgs: ${orgs.length}, Nouns: ${nouns.length}`);

    const ensureEntity = (name: string, type: string) => {
        const cleanName = name.replace(/[.,!?]$/, "").trim();
        if (cleanName.length < 2) return;
        
        try {
            const id = uuidv4();
            this.db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, cleanName, type, '[]');
            console.error(`[NlpArchivist] Extracted: ${cleanName} (${type})`);
        } catch (e: any) {
             if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') console.error(e);
        }
    };

    people.forEach((name: string) => ensureEntity(name, 'Person'));
    places.forEach((name: string) => ensureEntity(name, 'Place'));
    orgs.forEach((name: string) => ensureEntity(name, 'Organization'));
    
    // Add nouns as "Entity" if they weren't caught as specific types
    nouns.forEach((name: string) => ensureEntity(name, 'Entity'));
  }
}

export class LlmArchivist implements Archivist {
  private db: Database;
  private endpoint: string;

  constructor(db: Database, endpoint: string = 'http://localhost:11434/api/generate') {
    this.db = db;
    this.endpoint = endpoint;
  }

  async process(text: string): Promise<void> {
    console.error(`[LlmArchivist] Sending to LLM: "${text.substring(0, 50)}..."`);
    
    const prompt = `
      Extract entities and relationships from the following text.
      Return ONLY a JSON object with keys "entities" (array of {name, type}) and "relations" (array of {source, target, relation}).
      Text: "${text}"
    `;

    try {
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3', // User might need to configure this, assuming 'llama3' or 'mistral' is common
                prompt: prompt,
                stream: false,
                format: 'json'
            })
        });

        if (!response.ok) {
            console.error(`[LlmArchivist] LLM request failed: ${response.statusText}`);
            return;
        }

        const data = await response.json();
        const json = JSON.parse(data.response); // Ollama returns 'response' field

        // Process Entities
        if (json.entities) {
            for (const e of json.entities) {
                 try {
                    const id = uuidv4();
                    this.db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, e.name, e.type, '[]');
                     console.error(`[LlmArchivist] Created entity: ${e.name}`);
                 } catch (err: any) { if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') console.error(err); }
            }
        }

        // Process Relations
        if (json.relations) {
            for (const r of json.relations) {
                // Ensure entities exist (simple fallback)
                 try {
                    const id = uuidv4();
                    this.db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, r.source, 'Unknown', '[]');
                 } catch (err) {}
                 try {
                    const id = uuidv4();
                    this.db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, r.target, 'Unknown', '[]');
                 } catch (err) {}

                 try {
                     this.db.prepare(`INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)`).run(r.source, r.target, r.relation);
                     console.error(`[LlmArchivist] Created relation: ${r.source} -> ${r.relation} -> ${r.target}`);
                 } catch (err: any) { if (err.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') console.error(err); }
            }
        }

    } catch (error) {
        console.error("[LlmArchivist] Error calling LLM:", error);
    }
  }
}

export const getArchivist = (db: Database): Archivist => {
    const strategy = process.env.ARCHIVIST_STRATEGY || 'passive';
    console.error(`Initializing Archivist with strategy: ${strategy}`);
    
    switch (strategy.toLowerCase()) {
        case 'nlp':
            return new NlpArchivist(db);
        case 'llm':
            return new LlmArchivist(db);
        case 'passive':
        default:
            return new PassiveArchivist();
    }
};
