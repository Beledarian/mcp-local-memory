
import Database from 'better-sqlite3';
import { NlpArchivist } from './src/lib/archivist.js';

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
    return 100; // Mock: never fuzzy match unless identical
});

async function run() {
    const archivist = new NlpArchivist(db);
    
    console.log("--- Test 1: optimized WGSL ---");
    await archivist.process("User loves optimized WGSL.");
    
    let entities = db.prepare("SELECT * FROM entities").all();
    console.log("Entities:", entities.map((e: any) => e.name));
    
    // Check if 'optimized WGSL' exists
    const hasOptimized = entities.some((e: any) => e.name === 'optimized WGSL');
    console.log("Found 'optimized WGSL':", hasOptimized);

    // Reset
    db.prepare("DELETE FROM entities").run();

    console.log("\n--- Test 2: perfectly written WGSL ---");
    await archivist.process("User loves perfectly written WGSL.");
    
    entities = db.prepare("SELECT * FROM entities").all();
    console.log("Entities:", entities.map((e: any) => e.name));
    
    const hasPerfectly = entities.some((e: any) => e.name === 'perfectly written WGSL');
    console.log("Found 'perfectly written WGSL':", hasPerfectly);
}

run();
