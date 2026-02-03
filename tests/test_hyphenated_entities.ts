import Database from 'better-sqlite3';
import { NlpArchivist } from '../src/lib/archivist.js';

const db = new Database(':memory:');

// Setup Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    observations TEXT,
    importance REAL
  );
  CREATE TABLE IF NOT EXISTS relations (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    relation TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source, target, relation)
  );
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    tags TEXT,
    importance REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed DATETIME,
    access_count INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS vec_entities (
    rowid INTEGER PRIMARY KEY,
    embedding BLOB
  );
`);

db.function('levenshtein', (a: string, b: string) => {
    if (a === b) return 0;
    return 100;
});

async function run() {
    const archivist = new NlpArchivist(db);
    
    console.log("=== Test 1: Hyphenated Project Names ===");
    await archivist.process("User created LLM-powered chatbot and PDF-parser tool.");
    
    let entities = db.prepare("SELECT * FROM entities").all();
    console.log("Entities:", entities.map((e: any) => e.name));
    
    const hasLLM = entities.some((e: any) => e.name === 'LLM-powered');
    const hasPDF = entities.some((e: any) => e.name === 'PDF-parser');
    console.log("✓ Found 'LLM-powered':", hasLLM ? '✅' : '❌');
    console.log("✓ Found 'PDF-parser':", hasPDF ? '✅' : '❌');

    // Reset
    db.prepare("DELETE FROM entities").run();

    console.log("\n=== Test 2: Other Hyphenated Terms ===");
    await archivist.process("System uses WebGPU-based rendering.");
    
    entities = db.prepare("SELECT * FROM entities").all();
    console.log("Entities:", entities.map((e: any) => e.name));
    
    const hasWebGPU = entities.some((e: any) => e.name === 'WebGPU-based');
    console.log("✓ Found 'WebGPU-based':", hasWebGPU ? '✅' : '❌');

    console.log("\n=== Summary ===");
    console.log("All tests passed:", hasLLM && hasPDF && hasWebGPU ? '✅' : '❌');
}

run();
