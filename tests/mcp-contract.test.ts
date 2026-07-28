import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP CLI task mutations return valid protocol results exactly once", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mcp-memory-test-"));
  const dbPath = path.join(tempDir, "memory.db");
  const client = new Client(
    { name: "mcp-local-memory-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve("node_modules", "tsx", "dist", "cli.mjs"),
      path.resolve("src", "index.ts"),
    ],
    env: {
      ...process.env,
      MEMORY_DB_PATH: dbPath,
      TEST_MODE: "true",
      ARCHIVIST_STRATEGY: "passive",
      USE_WORKER: "false",
    },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(
      listed.tools.some((tool) => tool.name === "reinforce_memory"),
      "reinforce_memory must be exposed through MCP",
    );
    const addResult = await client.callTool({
      name: "cli",
      arguments: { command: 'task add "Audit task" --section testing' },
    });
    assert.equal(addResult.isError, undefined);
    assert.match((addResult.content[0] as any).text, /Task added/);

    const listResult = await client.callTool({
      name: "cli",
      arguments: { command: "task list" },
    });
    const listText = (listResult.content[0] as any).text as string;
    assert.equal((listText.match(/Audit task/g) ?? []).length, 1);
    assert.ok(listText.includes("\n"));
    assert.ok(!listText.includes("\\n"));

    const invalidLimit = await client.callTool({
      name: "recall",
      arguments: { query: "audit", limit: 0 },
    });
    assert.equal(invalidLimit.isError, true);
    assert.match((invalidLimit.content[0] as any).text, /Validation Error/);
  } finally {
    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
