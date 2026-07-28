import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

test("importance normalization is dry-run first and creates a verified backup", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-normalize-"));
  const databasePath = path.join(directory, "memory.db");
  const backupPath = path.join(directory, "backup", "memory.db");

  try {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        tags TEXT,
        importance FLOAT,
        last_accessed DATETIME,
        access_count INTEGER,
        last_reinforced_at DATETIME,
        reinforcement_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE memory_feedback (
        id INTEGER PRIMARY KEY,
        memory_id TEXT NOT NULL,
        signal TEXT NOT NULL,
        delta FLOAT NOT NULL
      );
      INSERT INTO memories VALUES
        ('one', 'generic identity', '2025-01-01', '[]', 1.53, '2026-01-01', 529, '2026-01-01', 12),
        ('two', 'specific project fact', '2025-02-01', '[]', 0.01, '2025-02-01', 0, NULL, 0);
      INSERT INTO memory_feedback VALUES (1, 'one', 'used', 0.05);
    `);
    db.close();

    const dryRun = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "scripts/normalize-importance.mjs",
          "--db",
          databasePath,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(dryRun.mode, "dry-run");
    assert.equal(dryRun.before.invalid, 1);

    const unchanged = new Database(databasePath, { readonly: true });
    assert.equal(
      unchanged
        .prepare("SELECT importance FROM memories WHERE id = 'one'")
        .pluck()
        .get(),
      1.53,
    );
    unchanged.close();

    const applied = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "scripts/normalize-importance.mjs",
          "--db",
          databasePath,
          "--baseline",
          "0.5",
          "--apply",
          "--backup",
          backupPath,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(applied.backup.integrity, "ok");
    assert.equal(applied.after.minimum, 0.5);
    assert.equal(applied.after.maximum, 0.5);
    assert.equal(applied.after.passively_accessed, 0);

    const normalized = new Database(databasePath, { readonly: true });
    assert.deepEqual(
      normalized
        .prepare(`
          SELECT importance, access_count, last_accessed, last_reinforced_at,
                 reinforcement_count
          FROM memories
          ORDER BY id
        `)
        .all(),
      [
        {
          importance: 0.5,
          access_count: 0,
          last_accessed: "2025-01-01",
          last_reinforced_at: null,
          reinforcement_count: 0,
        },
        {
          importance: 0.5,
          access_count: 0,
          last_accessed: "2025-02-01",
          last_reinforced_at: null,
          reinforcement_count: 0,
        },
      ],
    );
    assert.equal(
      normalized.prepare("SELECT COUNT(*) FROM memory_feedback").pluck().get(),
      1,
    );
    normalized.close();

    const backup = new Database(backupPath, { readonly: true });
    assert.equal(
      backup
        .prepare("SELECT importance FROM memories WHERE id = 'one'")
        .pluck()
        .get(),
      1.53,
    );
    assert.equal(backup.pragma("integrity_check", { simple: true }), "ok");
    backup.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
