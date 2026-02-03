const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.memory/memory.db');

try {
    console.log(`Opening database at ${dbPath}...`);
    const db = new Database(dbPath);
    
    // Explicitly request a checkpoint to merge WAL into the main DB file
    console.log('Running PRAGMA wal_checkpoint(FULL)...');
    const result = db.pragma('wal_checkpoint(FULL)');
    console.log('Checkpoint result:', result);
    
    const memories = db.prepare('SELECT content, created_at FROM memories').all();
    const entities = db.prepare('SELECT name, type FROM entities').all();
    console.log(`Successfully opened merged database.`);
    console.log(`Total memories: ${memories.length}`);
    memories.forEach(m => console.log(`- [${m.created_at}] ${m.content.substring(0, 50)}...`));
    console.log(`Total entities: ${entities.length}`);
    entities.forEach(e => console.log(`- ${e.name} [${e.type}]`));
    
    db.close();
    console.log('Database closed.');
} catch (err) {
    console.error('Recovery failed:', err);
    process.exit(1);
}
