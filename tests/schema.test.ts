import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { initSchema } from "../src/db/schema.js";

test("schema migration clamps historical importance and backfills FTS", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT,
        tags TEXT,
        importance FLOAT,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 0
      );
      CREATE TABLE memory_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        signal TEXT NOT NULL
          CHECK(signal IN ('used', 'important', 'irrelevant', 'incorrect')),
        delta FLOAT NOT NULL,
        reason TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      INSERT INTO memories(id, content, tags, importance)
      VALUES ('old', 'Historical WSL workaround', '["wsl"]', 1.53);
      INSERT INTO memory_feedback(memory_id, signal, delta)
      VALUES ('old', 'used', 0.05);
    `);
    initSchema(db);

    const memory = db.prepare(
      "SELECT importance, lifecycle_state FROM memories WHERE id = 'old'",
    ).get() as { importance: number; lifecycle_state: string };
    assert.equal(memory.importance, 1);
    assert.equal(memory.lifecycle_state, "active");
    db.prepare(`
      INSERT INTO memory_feedback(memory_id, signal, delta)
      VALUES ('old', 'outdated', 0)
    `).run();
    db.prepare(`
      INSERT INTO memory_feedback(memory_id, signal, delta)
      VALUES ('old', 'restore', 0)
    `).run();
    assert.equal(
      db.prepare("SELECT COUNT(*) FROM memory_feedback").pluck().get(),
      3,
    );
    assert.deepEqual(
      db.prepare(`
        SELECT id, content, tags, lifecycle_state
        FROM memories WHERE id = 'old'
      `).get(),
      {
        id: "old",
        content: "Historical WSL workaround",
        tags: '["wsl"]',
        lifecycle_state: "active",
      },
    );
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name = 'memory_recall_exposures'
      `).pluck().get(),
      1,
    );
    db.prepare(`
      UPDATE memories SET importance = 9 WHERE id = 'old'
    `).run();
    assert.equal(
      (db.prepare(
        "SELECT importance FROM memories WHERE id = 'old'",
      ).get() as { importance: number }).importance,
      1,
    );
    db.prepare(`
      INSERT INTO memories(id, content, tags, importance)
      VALUES ('negative', 'Negative importance', '[]', -3)
    `).run();
    assert.equal(
      (db.prepare(
        "SELECT importance FROM memories WHERE id = 'negative'",
      ).get() as { importance: number }).importance,
      0,
    );
    const ftsCount = db.prepare(
      "SELECT count(*) n FROM memories_fts WHERE memories_fts MATCH 'WSL'",
    ).get() as { n: number };
    assert.equal(ftsCount.n, 1);
  } finally {
    db.close();
  }
});
