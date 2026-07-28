import assert from "node:assert/strict";
import test from "node:test";
import { LlmArchivist, NlpArchivist } from "../src/lib/archivist.js";
import {
  handleForget,
  handleRememberFact,
} from "../src/tools/core.js";
import {
  handleCreateEntity,
  handleCreateRelation,
} from "../src/tools/graph_ops.js";
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

test("forget cancels LLM graph writes that resume after embedding", async () => {
  const db = createTestDb();
  const originalFetch = globalThis.fetch;
  let markEmbeddingStarted = () => {};
  let releaseEmbedding = () => {};
  const embeddingStarted = new Promise<void>((resolve) => {
    markEmbeddingStarted = resolve;
  });
  const embeddingReleased = new Promise<void>((resolve) => {
    releaseEmbedding = resolve;
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        response: JSON.stringify({
          importance: 0.7,
          entities: [
            { name: "Apollo", type: "Project", observations: [] },
          ],
          relations: [
            { source: "Apollo", target: "WGSL", relation: "uses" },
          ],
        }),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    const archivist = new LlmArchivist(
      db,
      "http://local.test/api/generate",
      async () => {
        markEmbeddingStarted();
        await embeddingReleased;
        return vector;
      },
    );
    const remember = handleRememberFact(
      db,
      { embed: async () => vector },
      archivist,
      { text: "Apollo uses WGSL.", tags: [] },
    );
    await embeddingStarted;

    const row = db.prepare("SELECT id FROM memories").get() as { id: string };
    handleForget(db, { memory_id: row.id });
    releaseEmbedding();
    await remember;

    assert.equal(db.prepare("SELECT count(*) n FROM memories").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM entities").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM relations").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM memory_entities").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM memory_relations").get().n, 0);
  } finally {
    releaseEmbedding();
    globalThis.fetch = originalFetch;
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

test("manual reaffirmation preserves generated entities and relations", async () => {
  const db = createTestDb();
  try {
    db.prepare(`
      INSERT INTO memories(id, content, tags)
      VALUES ('source-memory', 'Apollo uses WGSL.', '[]')
    `).run();
    db.prepare(`
      INSERT INTO entities(
        id, name, type, observations, auto_generated
      ) VALUES
        ('apollo', 'Apollo', 'Project', '[]', 1),
        ('wgsl', 'WGSL', 'Technology', '[]', 1)
    `).run();
    db.prepare(`
      INSERT INTO relations(
        source, target, relation, auto_generated
      ) VALUES ('Apollo', 'WGSL', 'uses', 1)
    `).run();
    db.prepare(`
      INSERT INTO memory_entities(memory_id, entity_id)
      VALUES
        ('source-memory', 'apollo'),
        ('source-memory', 'wgsl')
    `).run();
    db.prepare(`
      INSERT INTO memory_relations(memory_id, source, target, relation)
      VALUES ('source-memory', 'Apollo', 'WGSL', 'uses')
    `).run();

    await handleCreateEntity(
      db,
      { name: "Apollo", type: "Project", observations: [] },
    );
    await handleCreateEntity(
      db,
      { name: "WGSL", type: "Technology", observations: [] },
    );
    handleCreateRelation(
      db,
      { source: "Apollo", target: "WGSL", relation: "uses" },
    );
    handleForget(db, { memory_id: "source-memory" });

    const entities = db.prepare(`
      SELECT name, auto_generated
      FROM entities
      ORDER BY name
    `).all() as Array<{ name: string; auto_generated: number }>;
    assert.deepEqual(entities, [
      { name: "Apollo", auto_generated: 0 },
      { name: "WGSL", auto_generated: 0 },
    ]);
    const relation = db.prepare(`
      SELECT source, target, relation, auto_generated
      FROM relations
    `).get() as {
      source: string;
      target: string;
      relation: string;
      auto_generated: number;
    };
    assert.deepEqual(relation, {
      source: "Apollo",
      target: "WGSL",
      relation: "uses",
      auto_generated: 0,
    });
    assert.equal(db.prepare("SELECT count(*) n FROM memory_entities").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM memory_relations").get().n, 0);
  } finally {
    db.close();
  }
});

test("forget removes generated graph only after its last source memory", () => {
  const db = createTestDb();
  try {
    db.prepare(`
      INSERT INTO memories(id, content, tags)
      VALUES
        ('source-one', 'Apollo uses WGSL.', '[]'),
        ('source-two', 'WGSL is used by Apollo.', '[]')
    `).run();
    db.prepare(`
      INSERT INTO entities(
        id, name, type, observations, auto_generated
      ) VALUES
        ('apollo', 'Apollo', 'Project', '[]', 1),
        ('wgsl', 'WGSL', 'Technology', '[]', 1)
    `).run();
    db.prepare(`
      INSERT INTO relations(
        source, target, relation, auto_generated
      ) VALUES ('Apollo', 'WGSL', 'uses', 1)
    `).run();
    for (const memoryId of ["source-one", "source-two"]) {
      db.prepare(`
        INSERT INTO memory_entities(memory_id, entity_id)
        VALUES (?, 'apollo'), (?, 'wgsl')
      `).run(memoryId, memoryId);
      db.prepare(`
        INSERT INTO memory_relations(memory_id, source, target, relation)
        VALUES (?, 'Apollo', 'WGSL', 'uses')
      `).run(memoryId);
    }

    handleForget(db, { memory_id: "source-one" });
    assert.equal(db.prepare("SELECT count(*) n FROM entities").get().n, 2);
    assert.equal(db.prepare("SELECT count(*) n FROM relations").get().n, 1);

    handleForget(db, { memory_id: "source-two" });
    assert.equal(db.prepare("SELECT count(*) n FROM entities").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM relations").get().n, 0);
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
