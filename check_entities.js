import Database from 'better-sqlite3';

const dbPath = process.env.MEMORY_DB_PATH || '/mnt/c/Users/Laurin/.memory/memory.db';
const db = new Database(dbPath);

console.log('=== Recent Entities ===');
const entities = db.prepare('SELECT * FROM entities ORDER BY rowid DESC LIMIT 10').all();
console.log(entities);

console.log('\n=== Recent Relations ===');
const relations = db.prepare('SELECT * FROM relations ORDER BY rowid DESC LIMIT 10').all();
console.log(relations);

console.log('\n=== Recent Memories (last 3) ===');
const memories = db.prepare('SELECT id, content, tags FROM memories ORDER BY created_at DESC LIMIT 3').all();
console.log(memories);

db.close();
