
// Simple script to simulate MCP client calls for verification
import { REMEMBER_FACT_TOOL, EXPORT_MEMORIES_TOOL } from './src/tools/definitions.js';
import { getDb } from './src/db/client.js';
import { initSchema } from './src/db/schema.js';
import { v4 as uuidv4 } from "uuid";
import fs from "fs-extra";
import path from "path";

async function runTest() {
  console.log("Setting up DB...");
  const db = getDb();
  initSchema(db);

  console.log("Adding dummy memory...");
  const id = uuidv4();
  const text = "The user loves coding in Python on rainy days.";
  
  // Clean up if exists from previous runs to avoid dupes in this simple script
  // In real app, IDs are unique
  
  const insertTx = db.transaction(() => {
    db.prepare(`INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)`).run(id, text, '["hobbies"]');
    // We intentionally don't insert into vec_items manually here to simulate vector failure/missing
    // The FTS triggers should have run automatically
  });
  insertTx();

  console.log("Testing FTS Recall...");
  // Simulate the recall logic from index.ts
  const query = "Python coding";
  const ftsResults = db.prepare(`
        SELECT 
            id, 
            memories.content, 
            created_at,
            rank as score
        FROM memories_fts 
        JOIN memories ON memories_fts.rowid = memories.rowid
        WHERE memories_fts MATCH ? 
        ORDER BY rank
  `).all(query) as any[];

  console.log("Search Results:", JSON.stringify(ftsResults, null, 2));

  if (ftsResults.length > 0 && ftsResults[0].content === text) {
      console.log("SUCCESS: FTS Found the memory!");
  } else {
      console.error("FAILURE: FTS did not find the memory.");
  }
}

runTest().catch(console.error);
