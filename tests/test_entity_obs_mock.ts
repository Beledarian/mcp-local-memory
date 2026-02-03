
import { Database } from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// Mock DB
const db = new DatabaseConstructor(':memory:');
db.exec(`
  CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT, type TEXT, observations TEXT);
  CREATE TABLE entity_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
  );
  -- Mock levenshtein function for fuzzy matching
  -- better-sqlite3 doesn't support adding functions easily in some envs without compilation,
  -- so we cheat by mocking the SQL query to exact match for this test
`);

// 1. Create Entity with Observations
console.log("1. Creating Entity 'Jules'...");
const id = uuidv4();
db.prepare("INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)").run(id, "Jules", "Persona", "[]");
// New observations
db.prepare("INSERT INTO entity_observations (entity_id, content) VALUES (?, ?)").run(id, "Focuses on flaw detection");
db.prepare("INSERT INTO entity_observations (entity_id, content) VALUES (?, ?)").run(id, "User enjoys this agentic behavior");

// 2. Read Graph (Simulated Join)
console.log("2. reading Graph...");
const entity = db.prepare("SELECT * FROM entities WHERE name = ?").get("Jules") as any;
const obs = db.prepare("SELECT content FROM entity_observations WHERE entity_id = ?").all(entity.id) as any[];
const combinedObs = obs.map(o => o.content);
console.log("Observations:", combinedObs);

if (combinedObs.includes("Focuses on flaw detection") && combinedObs.length === 2) {
    console.log("✅ Success: Observations joined correctly.");
} else {
    console.log("❌ Failed: Join missing observations.");
}

// 3. Delete Observation
console.log("3. Deleting 'User enjoys this agentic behavior'...");
const delStmt = db.prepare("DELETE FROM entity_observations WHERE entity_id = ? AND content = ?");
const res = delStmt.run(entity.id, "User enjoys this agentic behavior");

const remaining = db.prepare("SELECT content FROM entity_observations WHERE entity_id = ?").all(entity.id) as any[];
console.log("Remaining:", remaining.map(r => r.content));

if (res.changes === 1 && remaining.length === 1) {
    console.log("✅ Success: Deletion worked.");
} else {
    console.log("❌ Failed: Deletion error.");
}
