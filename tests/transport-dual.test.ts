import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startSseServer } from '../src/server/sse.js';

function createDummyServer(): Server {
  const server = new Server(
    { name: 'mcp-local-memory-test', version: '2.1.1' },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'test_tool',
        description: 'a test tool',
        inputSchema: { type: 'object' },
      },
    ],
  }));
  return server;
}

test('Dual Transport Server supports Streamable HTTP, Legacy SSE, Health, and Auth', async () => {
  const server = startSseServer(createDummyServer, {
    port: 0,
    host: '127.0.0.1',
    token: 'secret-test-token',
  });

  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.on('listening', () => resolve());
  });

  const addr = server.address() as { port: number; address: string };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Health check (unauthenticated)
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = (await healthRes.json()) as any;
    assert.equal(healthData.status, 'ok');
    assert.equal(healthData.service, 'mcp-local-memory');
    assert.equal(healthData.version, '2.1.1');
    assert.equal(healthData.activeSessions, 0);

    // 2. Auth rejection on MCP endpoints
    const unauthRes = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    assert.equal(unauthRes.status, 401);

    const authHeaders = {
      Authorization: 'Bearer secret-test-token',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    // 3. Modern Streamable HTTP initialization (POST /sse)
    const initRes = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });
    assert.equal(initRes.status, 200);
    const streamableSessionId = initRes.headers.get('mcp-session-id');
    assert.ok(streamableSessionId, 'Expected Mcp-Session-Id header in initialize response');
    const initBodyText = await initRes.text();
    assert.match(initBodyText, /mcp-local-memory-test/);

    // Verify health reflects active streamable session
    const healthDuringRes = await fetch(`${baseUrl}/health`);
    const healthDuringData = (await healthDuringRes.json()) as any;
    assert.equal(healthDuringData.activeSessions, 1);
    assert.equal(healthDuringData.streamableSessions, 1);

    // 4. Streamable HTTP notification (POST /sse with Mcp-Session-Id)
    const notifRes = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'mcp-session-id': streamableSessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    assert.equal(notifRes.status, 202);

    // 5. Streamable HTTP call tools/list (POST /sse with Mcp-Session-Id)
    const toolsRes = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'mcp-session-id': streamableSessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });
    assert.equal(toolsRes.status, 200);
    const toolsText = await toolsRes.text();
    assert.match(toolsText, /"tools":/);

    // 6. Streamable HTTP DELETE session
    const delRes = await fetch(`${baseUrl}/sse`, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer secret-test-token',
        'mcp-session-id': streamableSessionId,
      },
    });
    assert.equal(delRes.status, 200);

    // Verify session is now gone (404)
    const postDeadSession = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'mcp-session-id': streamableSessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      }),
    });
    assert.equal(postDeadSession.status, 404);

    // 7. Legacy SSE handshake (GET /sse) and message posting (POST /messages?sessionId=...)
    let legacySseRes: http.IncomingMessage | null = null;
    const legacySessionId = await new Promise<string>((resolve, reject) => {
      const sseReq = http.request(
        `${baseUrl}/sse?token=secret-test-token`,
        {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
        },
        (sseRes) => {
          legacySseRes = sseRes;
          assert.equal(sseRes.statusCode, 200);
          sseRes.on('data', (chunk) => {
            const str = chunk.toString();
            const match = str.match(/sessionId=([a-f0-9-]+)/);
            if (match) {
              resolve(match[1]);
            }
          });
          sseRes.on('error', reject);
        }
      );
      sseReq.on('error', reject);
      sseReq.end();
    });

    assert.ok(legacySessionId, 'Expected legacy session ID from GET /sse');

    // Legacy SSE post message
    const legacyPostRes = await fetch(
      `${baseUrl}/messages?sessionId=${legacySessionId}&token=secret-test-token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-legacy', version: '1.0.0' },
          },
        }),
      }
    );
    assert.equal(legacyPostRes.status, 202);
    legacySseRes?.destroy();
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});
