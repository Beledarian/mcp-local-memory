import Database from "better-sqlite3";
import { getDb } from "../src/db/client.js";
import { initSchema } from "../src/db/schema.js";
import { getEmbedder } from "../src/lib/embeddings.js";
import { handleRecall } from "../src/tools/core.js";

const dbPath = process.env.AUDIT_MEMORY_DB_PATH;
if (!dbPath) {
  throw new Error(
    "Set AUDIT_MEMORY_DB_PATH to an isolated copy of a memory database.",
  );
}

const sourceDbPath = process.env.AUDIT_SOURCE_MEMORY_DB_PATH;
if (sourceDbPath) {
  const source = new Database(sourceDbPath, { readonly: true });
  try {
    await source.backup(dbPath);
  } finally {
    source.close();
  }
}

const query =
  process.env.RECALL_QUERY ?? "memory recall scoring semantic weight";
const limit = Number.parseInt(process.env.RECALL_LIMIT ?? "8", 10);
const db = getDb(dbPath);

try {
  initSchema(db);
  const before = db.prepare(`
    SELECT count(*) AS count, min(importance) AS minImportance,
           max(importance) AS maxImportance
    FROM memories
  `).get();
  const result = await handleRecall(db, getEmbedder(), {
    query,
    limit,
    json: true,
    debug: true,
  });
  console.log(JSON.stringify({ dbPath, query, before, result }, null, 2));
} finally {
  db.close();
}
