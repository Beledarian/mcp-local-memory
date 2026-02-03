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
    return 100; // Mock: never fuzzy match unless identical
});

async function run() {
    console.log("=== Test 1: Complex Concepts Enabled (Default) ===");
    process.env.EXTRACT_COMPLEX_CONCEPTS = 'true';
    const archivist1 = new NlpArchivist(db);
    
    await archivist1.process("User loves optimized WGSL.");
    let entities = db.prepare("SELECT * FROM entities").all();
    console.log("Entities:", entities.map((e: any) => e.name));
    
    const hasOptimized = entities.some((e: any) => e.name === 'optimized WGSL');
    console.log("✓ Found 'optimized WGSL':", hasOptimized ? '✅' : '❌');

    // Reset
    db.prepare("DELETE FROM entities").run();

    await archivist1.process("User loves perfectly written WGSL.");
    entities = db.prepare("SELECT * FROM entities").all();
    console.log("Entities:", entities.map((e: any) => e.name));
    
    const hasPerfectly = entities.some((e: any) => e.name === 'perfectly written WGSL');
    console.log("✓ Found 'perfectly written WGSL':", hasPerfectly ? '✅' : '❌');

    // Reset
    db.prepare("DELETE FROM entities").run();

    console.log("\n=== Test 2: Complex Concepts Disabled (Opt-out) ===");
    process.env.EXTRACT_COMPLEX_CONCEPTS = 'false';
    const archivist2 = new NlpArchivist(db);
    
    await archivist2.process("User loves optimized WGSL.");
    entities = db.prepare("SELECT * FROM entities").all();
    console.log("Entities:", entities.map((e: any) => e.name));
    
    const hasOptimizedDisabled = entities.some((e: any) => e.name === 'optimized WGSL');
    console.log("✓ Should NOT find 'optimized WGSL':", hasOptimizedDisabled ? '❌' : '✅');

    // Verify WGSL alone is still extracted
    const hasWGSL = entities.some((e: any) => e.name === 'WGSL');
    console.log("✓ Should find 'WGSL' alone:", hasWGSL ? '✅' : '❌');

    // Reset
    db.prepare("DELETE FROM entities").run();

    console.log("\n=== Test 3: Standalone Adjectives ===");
    process.env.EXTRACT_COMPLEX_CONCEPTS = 'true';
    const archivist3 = new NlpArchivist(db);
    
    await archivist3.process("User is optimistic and pragmatic.");
    entities = db.prepare("SELECT * FROM entities").all();
    console.log("Entities:", entities.map((e: any) => e.name));
    
    const hasOptimistic = entities.some((e: any) => e.name === 'optimistic');
    const hasPragmatic = entities.some((e: any) => e.name === 'pragmatic');
    console.log("✓ Found 'optimistic':", hasOptimistic ? '✅' : '❌');
    console.log("✓ Found 'pragmatic':", hasPragmatic ? '✅' : '❌');

    console.log("\n=== Summary ===");
    console.log("All tests passed:", !hasOptimizedDisabled && hasOptimized && hasPerfectly && hasWGSL && hasOptimistic && hasPragmatic ? '✅' : '❌');
}

run();
