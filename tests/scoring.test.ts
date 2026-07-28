import assert from "node:assert/strict";
import test from "node:test";
import {
  decayedImportance,
  getRecallScoringConfig,
  rankRecallCandidates,
} from "../src/lib/scoring.js";
import {
  handleListRecent,
  handleRecall,
  handleReinforceMemory,
} from "../src/tools/core.js";
import { createTestDb } from "./test-helpers.js";

test("Codex preset relevance weight is parsed and bounded", () => {
  assert.equal(getRecallScoringConfig({}).relevanceWeight, 0.9);

  const configured = getRecallScoringConfig({
    MEMORY_SEMANTIC_WEIGHT: "0.9",
    MEMORY_HALF_LIFE_WEEKS: "4.0",
    MEMORY_CONSOLIDATION_FACTOR: "1.0",
    TAG_MATCH_BOOST: "0.15",
    MEMORY_MIN_RELEVANCE: "0.6",
    MEMORY_SEMANTIC_ONLY_MIN_RELEVANCE: "0.8",
    MEMORY_DEDUP_SIMILARITY: "0.85",
  });
  assert.equal(configured.relevanceWeight, 0.9);
  assert.equal(configured.minimumRelevance, 0.6);
  assert.equal(configured.semanticOnlyMinimumRelevance, 0.8);
  assert.equal(configured.deduplicationThreshold, 0.85);
  assert.equal(configured.familiarityMaxBoost, 0.03);
  assert.equal(configured.familiarityWindowDays, 30);
  assert.equal(configured.familiaritySaturation, 5);

  const bounded = getRecallScoringConfig({
    MEMORY_SEMANTIC_WEIGHT: "9",
    MEMORY_HALF_LIFE_WEEKS: "0",
    MEMORY_CONSOLIDATION_FACTOR: "-4",
    MEMORY_MIN_RELEVANCE: "2",
    MEMORY_SEMANTIC_ONLY_MIN_RELEVANCE: "-1",
    MEMORY_DEDUP_SIMILARITY: "0",
    MEMORY_RECALL_FAMILIARITY_MAX_BOOST: "9",
    MEMORY_RECALL_FAMILIARITY_WINDOW_DAYS: "0",
    MEMORY_RECALL_FAMILIARITY_SATURATION: "0",
  });
  assert.equal(bounded.relevanceWeight, 1);
  assert.equal(bounded.halfLifeWeeks, 0.01);
  assert.equal(bounded.consolidationFactor, 0);
  assert.equal(bounded.minimumRelevance, 1);
  assert.equal(bounded.semanticOnlyMinimumRelevance, 0);
  assert.equal(bounded.deduplicationThreshold, 0.5);
  assert.equal(bounded.familiarityMaxBoost, 0.05);
  assert.equal(bounded.familiarityWindowDays, 1);
  assert.equal(bounded.familiaritySaturation, 1);
});

test("importance and cosine distance remain bounded", () => {
  const config = getRecallScoringConfig();
  assert.equal(decayedImportance(1.53, null, 500, config), 1);
  assert.equal(decayedImportance(-2, null, 0, config), 0);
});

test("truth-known lexical match beats identity pollution", () => {
  const config = getRecallScoringConfig({
    MEMORY_SEMANTIC_WEIGHT: "0.9",
    TAG_MATCH_BOOST: "0.15",
  });
  const ranked = rankRecallCandidates(
    [
      {
        id: "identity",
        content: "The user's first name is Laurin.",
        tags: '["identity"]',
        importance: 1.53,
        access_count: 527,
        distance: 0.92,
      },
      {
        id: "workaround",
        content: "Use WSL for sqlite-vec on Windows ARM64.",
        tags: '["memory","wsl","arm64"]',
        importance: 0.2,
        access_count: 0,
        distance: 0.68,
      },
    ],
    [
      {
        id: "workaround",
        content: "Use WSL for sqlite-vec on Windows ARM64.",
        tags: '["memory","wsl","arm64"]',
        importance: 0.2,
        access_count: 0,
        ftsRank: -10,
      },
    ],
    "Windows ARM64 sqlite-vec workaround WSL",
    5,
    config,
  );

  assert.equal(ranked[0].id, "workaround");
  assert.ok(ranked.every((candidate) => candidate.score >= 0 && candidate.score <= 1));
  assert.equal(ranked.some((candidate) => candidate.id === "identity"), false);
});

test("familiarity is bounded and cannot bypass relevance abstention", () => {
  const config = getRecallScoringConfig({
    MEMORY_RECALL_FAMILIARITY_MAX_BOOST: "0.03",
    MEMORY_RECALL_FAMILIARITY_SATURATION: "5",
  });
  const ranked = rankRecallCandidates(
    [
      {
        id: "generic",
        content: "A generic identity memory.",
        importance: 1,
        familiarity_count: 10_000,
        distance: 0.98,
      },
      {
        id: "specific",
        content: "Recall familiarity uses bounded daily query exposure.",
        importance: 0.2,
        familiarity_count: 20,
        distance: 0.3,
      },
    ],
    [],
    "bounded recall familiarity daily exposure",
    5,
    config,
  );

  assert.deepEqual(ranked.map((candidate) => candidate.id), ["specific"]);
  assert.ok(ranked[0].familiarityBoost > 0);
  assert.ok(ranked[0].familiarityBoost <= 0.03);
  assert.ok(ranked[0].score <= 1);
});

test("lexical coverage uses token boundaries and abstains on weak matches", () => {
  const ranked = rankRecallCandidates(
    [
      {
        id: "generic",
        content: "A generic unrelated identity memory.",
        importance: 1,
        distance: 0.98,
      },
    ],
    [
      {
        id: "farm",
        content: "The farm is productive.",
        importance: 1,
      },
      {
        id: "arm",
        content: "Native ARM builds are unsupported.",
        importance: 0.2,
      },
    ],
    "arm",
    5,
  );

  assert.deepEqual(ranked.map((candidate) => candidate.id), ["arm"]);
  assert.equal(ranked[0].keywordCoverage, 1);
});

test("compound identifiers contribute their meaningful parts", () => {
  const ranked = rankRecallCandidates(
    [],
    [
      {
        id: "config",
        content: "Set MEMORY_SEMANTIC_WEIGHT to 0.9.",
        importance: 0.1,
      },
      {
        id: "generic",
        content: "Memory continuity matters.",
        importance: 1,
      },
    ],
    "memory recall scoring semantic weight",
    5,
  );

  assert.equal(ranked[0].id, "config");
  assert.equal(ranked.some((candidate) => candidate.id === "generic"), false);
});

test("near-identical memories do not crowd the context window", () => {
  const ranked = rankRecallCandidates(
    [],
    [
      {
        id: "first",
        content: "Use WSL for sqlite vec on Windows ARM64.",
        importance: 0.5,
      },
      {
        id: "duplicate",
        content: "Use WSL for sqlite vec on Windows ARM64!",
        importance: 0.5,
      },
      {
        id: "other",
        content: "A Linux runner publishes the Windows ARM64 sqlite vec package.",
        importance: 0.5,
      },
    ],
    "WSL sqlite vec Windows ARM64 package",
    5,
  );

  assert.deepEqual(
    ranked.map((candidate) => candidate.id),
    ["first", "other"],
  );
});

test("recall preserves lifecycle state and records deduplicated familiarity", async () => {
  const previousWeight = process.env.MEMORY_SEMANTIC_WEIGHT;
  process.env.MEMORY_SEMANTIC_WEIGHT = "0.9";
  const db = createTestDb();
  try {
    db.prepare(`
      INSERT INTO memories(
        id, content, tags, importance, last_accessed, access_count
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
    `).run(
      "relevant",
      "Use WSL for sqlite-vec on Windows ARM64.",
      '["wsl","arm64"]',
      0.2,
    );

    const result = await handleRecall(
      db,
      { embed: async () => new Array(384).fill(0) },
      {
        query: "Windows ARM64 sqlite-vec workaround WSL",
        limit: 5,
        json: true,
        debug: true,
      },
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.results[0].id, "relevant");
    assert.equal(payload.method, "fts");
    assert.ok(
      payload.debug.some((line: string) =>
        line.includes("relevance=0.90"),
      ),
    );
    assert.ok(
      payload.debug.some((line: string) =>
        line.includes("minimumRelevance=0.55"),
      ),
    );
    assert.equal(payload.results[0].familiarityBoost, 0);

    const stored = db.prepare(
      `SELECT importance, access_count, reinforcement_count
       FROM memories WHERE id = ?`,
    ).get("relevant") as {
      importance: number;
      access_count: number;
      reinforcement_count: number;
    };
    assert.equal(stored.importance, 0.2);
    assert.equal(stored.access_count, 0);
    assert.equal(stored.reinforcement_count, 0);

    const repeated = await handleRecall(
      db,
      { embed: async () => new Array(384).fill(0) },
      {
        query: "Windows ARM64 sqlite-vec workaround WSL",
        limit: 5,
        json: true,
        debug: true,
      },
    );
    const repeatedPayload = JSON.parse(repeated.content[0].text);
    assert.ok(repeatedPayload.results[0].familiarityBoost > 0);
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) FROM memory_recall_exposures
        WHERE memory_id = ?
      `).pluck().get("relevant"),
      1,
    );
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) FROM memory_recall_exposures
        WHERE query_hash LIKE '%Windows%'
      `).pluck().get(),
      0,
    );
    assert.deepEqual(
      db.prepare(`
        SELECT importance, access_count, reinforcement_count,
               last_reinforced_at
        FROM memories WHERE id = ?
      `).get("relevant"),
      {
        importance: 0.2,
        access_count: 0,
        reinforcement_count: 0,
        last_reinforced_at: null,
      },
    );
  } finally {
    db.close();
    if (previousWeight === undefined) {
      delete process.env.MEMORY_SEMANTIC_WEIGHT;
    } else {
      process.env.MEMORY_SEMANTIC_WEIGHT = previousWeight;
    }
  }
});

test("explicit reinforcement writes bounded, diminishing feedback", () => {
  const db = createTestDb();
  try {
    const memoryId = "fd87e524-3cf5-4bbb-a8e1-a44274f04ae5";
    db.prepare(`
      INSERT INTO memories(id, content, tags, importance)
      VALUES (?, 'Explicit feedback target', '[]', 0.5)
    `).run(memoryId);

    const first = handleReinforceMemory(db, {
      memory_id: memoryId,
      signal: "used",
      reason: "Applied to the final answer",
    });
    assert.equal(first.isError, undefined);

    const afterFirst = db.prepare(`
      SELECT importance, reinforcement_count, last_reinforced_at
      FROM memories WHERE id = ?
    `).get(memoryId) as {
      importance: number;
      reinforcement_count: number;
      last_reinforced_at: string | null;
    };
    assert.ok(afterFirst.importance > 0.5);
    assert.ok(afterFirst.importance <= 0.95);
    assert.equal(afterFirst.reinforcement_count, 1);
    assert.ok(afterFirst.last_reinforced_at);

    const cooldown = handleReinforceMemory(db, {
      memory_id: memoryId,
      signal: "used",
    });
    assert.match(cooldown.content[0].text, /cooldown/);
    const eventCount = db.prepare(`
      SELECT COUNT(*) AS count FROM memory_feedback WHERE memory_id = ?
    `).get(memoryId) as { count: number };
    assert.equal(eventCount.count, 1);

    handleReinforceMemory(db, {
      memory_id: memoryId,
      signal: "irrelevant",
      reason: "Returned for the wrong project",
    });
    const afterNegative = db.prepare(`
      SELECT importance, reinforcement_count
      FROM memories WHERE id = ?
    `).get(memoryId) as {
      importance: number;
      reinforcement_count: number;
    };
    assert.ok(afterNegative.importance < afterFirst.importance);
    assert.equal(afterNegative.reinforcement_count, 1);
  } finally {
    db.close();
  }
});

test("outdated memories are suppressed by default and explicitly restorable", async () => {
  const db = createTestDb();
  try {
    const memoryId = "9ddca789-c743-47eb-b4a4-0911e1fe8712";
    db.prepare(`
      INSERT INTO memories(id, content, tags, importance)
      VALUES (?, 'Legacy recall automatically boosts importance', '["recall"]', 0.5)
    `).run(memoryId);

    const outdated = handleReinforceMemory(db, {
      memory_id: memoryId,
      signal: "outdated",
      reason: "Superseded by explicit reinforcement",
    });
    assert.equal(outdated.isError, undefined);
    assert.equal(
      db
        .prepare("SELECT lifecycle_state FROM memories WHERE id = ?")
        .pluck()
        .get(memoryId),
      "outdated",
    );
    assert.deepEqual(
      JSON.parse(handleListRecent(db, { json: true }).content[0].text),
      [],
    );

    const hidden = await handleRecall(
      db,
      { embed: async () => new Array(384).fill(0) },
      { query: "recall automatically boosts importance", json: true },
    );
    assert.deepEqual(JSON.parse(hidden.content[0].text).results, []);

    const historical = await handleRecall(
      db,
      { embed: async () => new Array(384).fill(0) },
      {
        query: "recall automatically boosts importance",
        json: true,
        include_outdated: true,
      },
    );
    assert.equal(JSON.parse(historical.content[0].text).results[0].id, memoryId);

    const blocked = handleReinforceMemory(db, {
      memory_id: memoryId,
      signal: "used",
    });
    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /Restore it explicitly/);

    const restored = handleReinforceMemory(db, {
      memory_id: memoryId,
      signal: "restore",
      reason: "Historical note is relevant again",
    });
    assert.equal(restored.isError, undefined);
    assert.equal(
      db
        .prepare("SELECT lifecycle_state FROM memories WHERE id = ?")
        .pluck()
        .get(memoryId),
      "active",
    );
    assert.equal(
      JSON.parse(handleListRecent(db, { json: true }).content[0].text)[0].id,
      memoryId,
    );

    const visible = await handleRecall(
      db,
      { embed: async () => new Array(384).fill(0) },
      { query: "recall automatically boosts importance", json: true },
    );
    assert.equal(JSON.parse(visible.content[0].text).results[0].id, memoryId);
  } finally {
    db.close();
  }
});
