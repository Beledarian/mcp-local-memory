
import { getDb } from './src/db/client.js';
import { initSchema } from './src/db/schema.js';
import { v4 as uuidv4 } from "uuid";

async function runGraphTest() {
  console.log("Setting up DB...");
  const db = getDb();
  initSchema(db);

  console.log("Creating entities...");
  const ensureEntity = (name: string, type: string) => {
      try {
        db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(uuidv4(), name, type, "[]");
      } catch (e: any) {
        if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') console.error(e);
      }
  }

  ensureEntity("Alice", "Person");
  ensureEntity("Bob", "Person");
  ensureEntity("Python", "Language");

  console.log("Creating relations...");
  const ensureRelation = (s: string, t: string, r: string) => {
      try {
        db.prepare(`INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)`).run(s, t, r);
      } catch (e: any) {
          if (e.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') console.error(e);
      }
  }

  ensureRelation("Alice", "Bob", "knows");
  ensureRelation("Alice", "Python", "loves");

  console.log("Reading graph for Alice...");
  const outgoing = db.prepare(`SELECT * FROM relations WHERE source = ?`).all("Alice");
  const incoming = db.prepare(`SELECT * FROM relations WHERE target = ?`).all("Alice");

  console.log("Edges:", outgoing.length + incoming.length);
  
  if (outgoing.find((e: any) => e.target === "Bob" && e.relation === "knows")) {
      console.log("SUCCESS: Found Alice -> knows -> Bob");
  } else {
      console.error("FAILURE: Relation not found");
  }

  const pythonNode = db.prepare(`SELECT * FROM entities WHERE name = 'Python'`).get();
  if (pythonNode) {
      console.log("SUCCESS: Found Python entity");
  }

}

runGraphTest().catch(console.error);
