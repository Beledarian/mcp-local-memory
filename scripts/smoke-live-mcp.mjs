#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function textOf(result) {
  const block = result.content?.find((item) => item.type === "text");
  if (!block || typeof block.text !== "string") {
    throw new Error("MCP result did not contain a text block.");
  }
  return block.text;
}

function lifecycleRow(db, id) {
  return db
    .prepare(`
      SELECT importance, access_count, last_accessed,
             reinforcement_count, last_reinforced_at
      FROM memories
      WHERE id = ?
    `)
    .get(id);
}

function familiarityCount(db, id) {
  return db
    .prepare(`
      SELECT COUNT(*) FROM memory_recall_exposures
      WHERE memory_id = ?
    `)
    .pluck()
    .get(id);
}

async function main() {
  const argv = process.argv.slice(2);
  const databasePath = valueAfter(argv, "--db");
  const serverRoot = valueAfter(argv, "--server-root") ?? process.cwd();
  const extensionsPath = valueAfter(argv, "--extensions") ?? "";
  const probeQuery = valueAfter(argv, "--probe-query");
  const probeOnly = argv.includes("--probe-only");
  const includeOutdated = argv.includes("--include-outdated");
  if (!databasePath) {
    throw new Error(
      "Usage: node scripts/smoke-live-mcp.mjs --db <memory.db> " +
        "[--server-root <checkout>] [--extensions <directory>]",
    );
  }

  const absoluteDb = path.resolve(databasePath);
  const absoluteRoot = path.resolve(serverRoot);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: absoluteRoot,
    env: {
      ...process.env,
      MEMORY_DB_PATH: absoluteDb,
      EXTENSIONS_PATH: extensionsPath,
      ARCHIVIST_STRATEGY: "passive",
      USE_WORKER: "false",
    },
    stderr: "pipe",
  });
  const client = new Client(
    { name: "mcp-local-memory-live-smoke", version: "1.0.0" },
    { capabilities: {} },
  );

  let memoryId;
  let db;
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    for (const required of [
      "remember_fact",
      "recall",
      "reinforce_memory",
      "forget",
    ]) {
      if (!tools.tools.some((tool) => tool.name === required)) {
        throw new Error(`Configured server is missing tool: ${required}`);
      }
    }

    if (probeOnly) {
      if (!probeQuery) {
        throw new Error("--probe-only requires --probe-query.");
      }
      db = new Database(absoluteDb, { readonly: true, fileMustExist: true });
      const lifecycleBefore = db
        .prepare(`
          SELECT SUM(access_count) access_count,
                 SUM(reinforcement_count) reinforcement_count,
                 (SELECT COUNT(*) FROM memory_feedback) feedback_count
          FROM memories
        `)
        .get();
      const familiarityBefore = db
        .prepare("SELECT COUNT(*) FROM memory_recall_exposures")
        .pluck()
        .get();
      const result = await client.callTool({
        name: "recall",
        arguments: {
          query: probeQuery,
          limit: 5,
          json: true,
          debug: true,
          include_outdated: includeOutdated,
        },
      });
      const payload = JSON.parse(textOf(result));
      const lifecycleAfter = db
        .prepare(`
          SELECT SUM(access_count) access_count,
                 SUM(reinforcement_count) reinforcement_count,
                 (SELECT COUNT(*) FROM memory_feedback) feedback_count
          FROM memories
        `)
        .get();
      if (JSON.stringify(lifecycleAfter) !== JSON.stringify(lifecycleBefore)) {
        throw new Error("Probe recall changed aggregate lifecycle state.");
      }
      const familiarityAfter = db
        .prepare("SELECT COUNT(*) FROM memory_recall_exposures")
        .pluck()
        .get();
      console.log(
        JSON.stringify(
          {
            query: probeQuery,
            method: payload.method,
            includeOutdated,
            lifecycleWrite: false,
            familiarityRowsAdded: familiarityAfter - familiarityBefore,
            debug: payload.debug,
            results: payload.results.map((memory) => ({
              id: memory.id,
              preview: memory.content.slice(0, 200),
              lifecycleState: memory.lifecycle_state,
              score: memory.score,
              relevanceScore: memory.relevanceScore,
              keywordCoverage: memory.keywordCoverage,
              importanceScore: memory.importanceScore,
              familiarityCount: memory.familiarity_count,
              familiarityBoost: memory.familiarityBoost,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    const marker = `mcp-smoke-${randomUUID()}`;
    const remembered = await client.callTool({
      name: "remember_fact",
      arguments: {
        text:
          `${marker} verifies lifecycle-preserving recall and explicit reinforcement ` +
          "against the configured database.",
        tags: ["mcp-smoke", marker],
      },
    });
    const idMatch = textOf(remembered).match(
      /Remembered fact with ID: ([0-9a-f-]{36})/i,
    );
    if (!idMatch) {
      throw new Error("Could not parse the temporary memory ID.");
    }
    memoryId = idMatch[1];

    db = new Database(absoluteDb, { readonly: true, fileMustExist: true });
    const beforeRecall = lifecycleRow(db, memoryId);
    if (!beforeRecall) {
      throw new Error("Temporary memory was not durably written.");
    }

    const recalled = await client.callTool({
      name: "recall",
      arguments: { query: marker, limit: 5, json: true, debug: true },
    });
    const recallPayload = JSON.parse(textOf(recalled));
    if (!recallPayload.results?.some((memory) => memory.id === memoryId)) {
      throw new Error("Temporary memory was not returned by exact recall.");
    }

    const afterRecall = lifecycleRow(db, memoryId);
    if (JSON.stringify(afterRecall) !== JSON.stringify(beforeRecall)) {
      throw new Error(
        "Recall changed lifecycle fields; expected a lifecycle-preserving operation.",
      );
    }
    const familiarityRows = familiarityCount(db, memoryId);
    if (familiarityRows !== 1) {
      throw new Error(
        `Recall wrote ${familiarityRows} familiarity rows; expected exactly one.`,
      );
    }

    const reinforced = await client.callTool({
      name: "reinforce_memory",
      arguments: {
        memory_id: memoryId,
        signal: "used",
        reason: "live MCP smoke test",
      },
    });
    if (!textOf(reinforced).includes("Recorded used feedback")) {
      throw new Error("Explicit reinforcement did not acknowledge its write.");
    }

    const afterReinforcement = lifecycleRow(db, memoryId);
    const feedbackCount = db
      .prepare(
        "SELECT COUNT(*) FROM memory_feedback WHERE memory_id = ? AND signal = 'used'",
      )
      .pluck()
      .get(memoryId);
    if (
      afterReinforcement.reinforcement_count !== 1 ||
      afterReinforcement.importance <= beforeRecall.importance ||
      feedbackCount !== 1
    ) {
      throw new Error("Explicit reinforcement state was not written correctly.");
    }

    let probe;
    if (probeQuery) {
      const lifecycleBeforeProbe = db
        .prepare(`
          SELECT SUM(access_count) access_count,
                 SUM(reinforcement_count) reinforcement_count,
                 (SELECT COUNT(*) FROM memory_feedback) feedback_count
          FROM memories
        `)
        .get();
      const probeResult = await client.callTool({
        name: "recall",
        arguments: { query: probeQuery, limit: 5, json: true, debug: true },
      });
      const probePayload = JSON.parse(textOf(probeResult));
      const lifecycleAfterProbe = db
        .prepare(`
          SELECT SUM(access_count) access_count,
                 SUM(reinforcement_count) reinforcement_count,
                 (SELECT COUNT(*) FROM memory_feedback) feedback_count
          FROM memories
        `)
        .get();
      if (
        JSON.stringify(lifecycleAfterProbe) !==
        JSON.stringify(lifecycleBeforeProbe)
      ) {
        throw new Error("Probe recall changed aggregate lifecycle state.");
      }
      probe = {
        query: probeQuery,
        method: probePayload.method,
        lifecycleWrite: false,
        results: probePayload.results.map((memory) => ({
          id: memory.id,
          preview: memory.content.slice(0, 160),
          score: memory.score,
          relevanceScore: memory.relevanceScore,
          keywordCoverage: memory.keywordCoverage,
        })),
      };
    }

    console.log(
      JSON.stringify(
        {
          tools: "ok",
          recall: {
            method: recallPayload.method,
            resultFound: true,
            lifecycleWrite: false,
            familiarityRows,
          },
          reinforcement: {
            feedbackRows: feedbackCount,
            count: afterReinforcement.reinforcement_count,
            importanceBefore: beforeRecall.importance,
            importanceAfter: afterReinforcement.importance,
          },
          probe,
          cleanup: "pending",
        },
        null,
        2,
      ),
    );
  } finally {
    if (memoryId) {
      try {
        await client.callTool({
          name: "forget",
          arguments: { memory_id: memoryId },
        });
      } catch {
        // The final database check below reports cleanup failure.
      }
    }
    db?.close();
    await client.close().catch(() => undefined);

    if (memoryId) {
      const verify = new Database(absoluteDb, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        const remaining = verify
          .prepare("SELECT COUNT(*) FROM memories WHERE id = ?")
          .pluck()
          .get(memoryId);
        if (remaining !== 0) {
          throw new Error(`Temporary smoke memory remains: ${memoryId}`);
        }
        if (familiarityCount(verify, memoryId) !== 0) {
          throw new Error(
            `Temporary familiarity telemetry remains: ${memoryId}`,
          );
        }
      } finally {
        verify.close();
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
