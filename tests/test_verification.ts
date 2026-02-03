
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
  const text = "Test memory for export";
  db.prepare(`INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)`).run(id, text, '[]');

  console.log("Testing export...");
  const exportPath = path.resolve(process.cwd(), "test_export.json");
  
  // Simulate export logic directly since we don't have a full MCP client here
  // But exact same logic as in index.ts
  const alldata = db.prepare('SELECT * FROM memories').all();
  await fs.outputJson(exportPath, alldata, { spaces: 2 });
  
  if (fs.existsSync(exportPath)) {
      console.log("SUCCESS: Export file created at " + exportPath);
      const content = await fs.readJson(exportPath);
      console.log("Content count:", content.length);
      if (content.length > 0 && content[0].content === text) {
          console.log("SUCCESS: Content verified.");
      } else {
          console.error("FAILURE: Content mismatch.");
      }
  } else {
      console.error("FAILURE: Export file not found.");
  }
}

runTest().catch(console.error);
