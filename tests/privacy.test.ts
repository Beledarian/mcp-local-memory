import assert from "node:assert/strict";
import test from "node:test";
import { NlpArchivist } from "../src/lib/archivist.js";
import {
  handleForget,
  handleRememberFact,
} from "../src/tools/core.js";
import { createTestDb } from "./test-helpers.js";

const vector = new Array(384).fill(0.1);

test("forget cancels concurrent enrichment without orphan graph data", async () => {
  const db = createTestDb();
  try {
    const remember = handleRememberFact(
      db,
      {
        embed: async () => {
          await new Promise((resolve) => setTimeout(resolve, 40));
          return vector;
        },
      },
      new NlpArchivist(db),
      { text: "Project Apollo was confidential.", tags: ["secret"] },
    );
    const row = db.prepare("SELECT id FROM memories").get() as { id: string };
    const forgotten = handleForget(db, { memory_id: row.id });
    assert.equal(forgotten.isError, undefined);
    await remember;

    assert.equal(db.prepare("SELECT count(*) n FROM memories").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM vec_items").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM entities").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM relations").get().n, 0);
  } finally {
    db.close();
  }
});

test("forget removes completed auto-generated knowledge with provenance", async () => {
  const db = createTestDb();
  try {
    const remembered = await handleRememberFact(
      db,
      { embed: async () => vector },
      new NlpArchivist(db),
      { text: "Project Apollo uses WGSL.", tags: ["secret"] },
    );
    const id = remembered.content[0].text.match(
      /ID: ([0-9a-f-]+)/,
    )?.[1];
    assert.ok(id);
    assert.ok(db.prepare("SELECT count(*) n FROM entities").get().n > 0);
    assert.ok(db.prepare("SELECT count(*) n FROM memory_entities").get().n > 0);

    handleForget(db, { memory_id: id });
    assert.equal(db.prepare("SELECT count(*) n FROM memories").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM vec_items").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM entities").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM relations").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM memory_entities").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM memory_relations").get().n, 0);
  } finally {
    db.close();
  }
});

test("forget preserves a manually created entity", async () => {
  const db = createTestDb();
  try {
    db.prepare(`
      INSERT INTO entities(id, name, type, observations, importance)
      VALUES ('manual-apollo', 'Project Apollo', 'Project', '[]', 0.8)
    `).run();
    const remembered = await handleRememberFact(
      db,
      { embed: async () => vector },
      new NlpArchivist(db),
      { text: "Project Apollo uses WGSL.", tags: [] },
    );
    const id = remembered.content[0].text.match(
      /ID: ([0-9a-f-]+)/,
    )?.[1];
    assert.ok(id);
    handleForget(db, { memory_id: id });

    const entity = db.prepare(
      "SELECT name, auto_generated FROM entities WHERE id = 'manual-apollo'",
    ).get() as { name: string; auto_generated: number };
    assert.equal(entity.name, "Project Apollo");
    assert.equal(entity.auto_generated, 0);
  } finally {
    db.close();
  }
});
