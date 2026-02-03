
import { Database } from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';

// Mock DB setup
const db = new DatabaseConstructor(':memory:');

// Schema
db.exec(`
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tags TEXT,
    importance FLOAT DEFAULT 0.5,
    last_accessed DATETIME,
    access_count INTEGER DEFAULT 0
  );
  CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags);
  CREATE TABLE vec_items (rowid INTEGER PRIMARY KEY, embedding BLOB); -- Mock vec table
`);

// Insert Data
const yesterday = new Date(Date.now() - 86400000).toISOString();
const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString();
const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString();

db.prepare("INSERT INTO memories (id, content, created_at) VALUES (?, ?, ?)").run("1", "Memory from yesterday", yesterday);
db.prepare("INSERT INTO memories (id, content, created_at) VALUES (?, ?, ?)").run("2", "Memory from last week", lastWeek);
db.prepare("INSERT INTO memories (id, content, created_at) VALUES (?, ?, ?)").run("3", "Memory from last month", lastMonth);

// Sync FTS (Manual since triggers might differ in mock)
db.exec(`INSERT INTO memories_fts(rowid, content, tags) SELECT rowid, content, tags FROM memories`);

console.log("Setup complete. Testing queries...");

// Test Helper
function runQuery(label: string, start?: string, end?: string) {
    let sql = `SELECT m.content, m.created_at FROM memories m JOIN memories_fts fts ON m.rowid = fts.rowid WHERE 1=1`;
    const params = [];
    if (start) { sql += " AND m.created_at >= ?"; params.push(start); }
    if (end) { sql += " AND m.created_at <= ?"; params.push(end); }
    
    console.log(`\n[${label}] SQL: ${sql} Params: ${params}`);
    const results = db.prepare(sql).all(...params) as any[];
    results.forEach(r => console.log(` - ${r.content} (${r.created_at})`));
}

// 1. All
runQuery("All");

// 2. Since Yesterday (Should match 1)
runQuery("Since Yesterday", yesterday);

// 3. Last Week Range (Should match 2)
// Approximate range for "last week" is 7 days ago.
// Let's test specific dates.
runQuery("Exact Range (Last Week)", new Date(Date.now() - 8 * 86400000).toISOString(), new Date(Date.now() - 6 * 86400000).toISOString());

console.log("\nDone.");
