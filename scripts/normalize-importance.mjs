#!/usr/bin/env node

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    apply: false,
    baseline: 0.5,
    backup: undefined,
    db: undefined,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--db") {
      options.db = argv[++index];
    } else if (arg === "--backup") {
      options.backup = argv[++index];
    } else if (arg === "--baseline") {
      options.baseline = Number.parseFloat(argv[++index]);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!options.db) {
    throw new Error(
      "Usage: node scripts/normalize-importance.mjs --db <memory.db> " +
        "[--baseline 0.5] [--apply --backup <backup.db>]",
    );
  }
  if (
    !Number.isFinite(options.baseline) ||
    options.baseline < 0 ||
    options.baseline > 1
  ) {
    throw new Error("--baseline must be a number between 0 and 1.");
  }
  if (options.apply && !options.backup) {
    throw new Error("--apply requires an explicit --backup path.");
  }

  return options;
}

function hasTable(db, name) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(name),
  );
}

function memoryColumns(db) {
  return new Set(
    db
      .prepare("PRAGMA table_info(memories)")
      .all()
      .map((column) => column.name),
  );
}

function summarize(db) {
  return db
    .prepare(`
      SELECT
        COUNT(*) AS count,
        MIN(importance) AS minimum,
        MAX(importance) AS maximum,
        AVG(importance) AS average,
        SUM(
          CASE
            WHEN importance IS NULL OR importance < 0 OR importance > 1
            THEN 1 ELSE 0
          END
        ) AS invalid,
        SUM(CASE WHEN access_count > 0 THEN 1 ELSE 0 END) AS passively_accessed
      FROM memories
    `)
    .get();
}

function verifyBackup(backupPath, expectedCount) {
  const backup = new Database(backupPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const integrity = backup.pragma("integrity_check", { simple: true });
    const count = backup.prepare("SELECT COUNT(*) FROM memories").pluck().get();
    if (integrity !== "ok" || count !== expectedCount) {
      throw new Error(
        `Backup verification failed: integrity=${integrity}, memories=${count}`,
      );
    }
  } finally {
    backup.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = path.resolve(options.db);
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("busy_timeout = 10000");

  try {
    if (!hasTable(db, "memories")) {
      throw new Error("The selected database has no memories table.");
    }
    const columns = memoryColumns(db);
    for (const required of ["importance", "access_count", "last_accessed"]) {
      if (!columns.has(required)) {
        throw new Error(`The memories table is missing ${required}.`);
      }
    }

    const before = summarize(db);
    const preview = {
      mode: options.apply ? "apply" : "dry-run",
      database: dbPath,
      baseline: options.baseline,
      before,
      resets: [
        "importance",
        "legacy access_count",
        "legacy last_accessed",
        ...(columns.has("reinforcement_count")
          ? ["reinforcement_count"]
          : []),
        ...(columns.has("last_reinforced_at")
          ? ["last_reinforced_at"]
          : []),
      ],
      preserves: [
        "memory content, IDs, tags, timestamps, embeddings, and graph links",
        "memory_feedback audit rows",
      ],
    };

    if (!options.apply) {
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    const backupPath = path.resolve(options.backup);
    if (backupPath === dbPath) {
      throw new Error("Backup path must differ from the live database path.");
    }
    if (fs.existsSync(backupPath)) {
      throw new Error(`Refusing to overwrite existing backup: ${backupPath}`);
    }
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });

    const backupMetadata = await db.backup(backupPath);
    verifyBackup(backupPath, before.count);

    const assignments = [
      "importance = ?",
      "access_count = 0",
      "last_accessed = created_at",
    ];
    if (columns.has("reinforcement_count")) {
      assignments.push("reinforcement_count = 0");
    }
    if (columns.has("last_reinforced_at")) {
      assignments.push("last_reinforced_at = NULL");
    }

    db.exec("BEGIN EXCLUSIVE");
    try {
      db.prepare(`UPDATE memories SET ${assignments.join(", ")}`).run(
        options.baseline,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const after = summarize(db);
    if (
      after.count !== before.count ||
      after.minimum !== options.baseline ||
      after.maximum !== options.baseline ||
      after.passively_accessed !== 0
    ) {
      throw new Error(
        `Post-normalization verification failed: ${JSON.stringify(after)}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ...preview,
          backup: {
            path: backupPath,
            pages: backupMetadata.totalPages,
            integrity: "ok",
            memories: before.count,
          },
          after,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
