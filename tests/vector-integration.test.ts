import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getDb } from "../src/db/client.js";
import { initSchema } from "../src/db/schema.js";
import { PassiveArchivist } from "../src/lib/archivist.js";
import {
  handleForget,
  handleRecall,
  handleRememberFact,
} from "../src/tools/core.js";

test("remember/recall/forget works with vec0 or the explicit FTS fallback", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mcp-memory-vector-"));
  const db = getDb(path.join(tempDir, "memory.db"));
  const embedding = new Array(384).fill(0);
  embedding[0] = 1;
  try {
    initSchema(db);
    if (process.platform === "win32" && process.arch === "arm64") {
      const version = db.prepare(
        "SELECT vec_version() AS version",
      ).get() as { version: string };
      assert.equal(version.version, "v0.1.9");
    }
    const remembered = await handleRememberFact(
      db,
      { embed: async () => embedding },
      new PassiveArchivist(),
      {
        text: "Windows ARM64 uses the WSL sqlite vec workaround.",
        tags: ["wsl", "arm64"],
      },
    );
    const id = remembered.content[0].text.match(/ID: ([0-9a-f-]+)/)?.[1];
    assert.ok(id);
    assert.equal(db.prepare("SELECT count(*) n FROM vec_items").get().n, 1);

    const recalled = await handleRecall(
      db,
      { embed: async () => embedding },
      {
        query: "Windows ARM64 WSL sqlite vec workaround",
        json: true,
        debug: true,
      },
    );
    const payload = JSON.parse(recalled.content[0].text);
    assert.equal(payload.results[0].id, id);
    if (process.platform === "win32" && process.arch === "arm64") {
      assert.equal(payload.method, "hybrid");
    } else {
      assert.ok(["hybrid", "fts"].includes(payload.method));
    }

    handleForget(db, { memory_id: id });
    assert.equal(db.prepare("SELECT count(*) n FROM vec_items").get().n, 0);
  } finally {
    db.close();
    rmSync(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
