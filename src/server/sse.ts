// ponytail: Minimal native HTTP/SSE MCP transport server supporting Streamable HTTP & Legacy SSE
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface SseServerOptions {
  port?: number;
  host?: string;
  token?: string | null;
}

export function startSseServer(
  serverFactory: () => Server,
  options: SseServerOptions = {}
): http.Server {
  const port = options.port ?? (Number(process.env.PORT) || Number(process.env.MCP_PORT) || 8320);
  const host = options.host ?? (process.env.HOST || '0.0.0.0');
  const expectedToken = options.token !== undefined
    ? options.token
    : (process.env.MCP_AUTH_TOKEN || process.env.AUTH_TOKEN || null);

  const legacySessions = new Map<string, SSEServerTransport>();
  const streamableSessions = new Map<string, { transport: StreamableHTTPServerTransport; lastActivity: number }>();

  function validateAuth(req: http.IncomingMessage, url: URL): boolean {
    if (!expectedToken) return true; // ponytail: No auth configured, allow local/tailnet access

    const authHeader = req.headers['authorization'];
    let providedToken: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.slice(7).trim();
    } else if (url.searchParams.has('token')) {
      providedToken = url.searchParams.get('token');
    }

    if (!providedToken) return false;

    // Timing-safe token comparison
    try {
      const a = Buffer.from(providedToken);
      const b = Buffer.from(expectedToken);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers for cross-device agent clients & webviews
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const hostHeader = req.headers.host || `localhost:${port}`;
    const protocol = (req.socket as any).encrypted ? 'https' : 'http';
    const url = new URL(req.url || '/', `${protocol}://${hostHeader}`);
    const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';

    // Health check endpoint
    if (req.method === 'GET' && (normalizedPath === '/health' || normalizedPath === '/healthz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'mcp-local-memory',
        version: '2.1.1',
        activeSessions: legacySessions.size + streamableSessions.size,
        legacySessions: legacySessions.size,
        streamableSessions: streamableSessions.size,
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // Authenticate all MCP endpoints
    if (!validateAuth(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing bearer token' }));
      return;
    }

    // Extract session ID from Mcp-Session-Id header or query parameters
    const headerSessionId = (req.headers['mcp-session-id'] as string | undefined)?.trim();
    const querySessionId = (url.searchParams.get('mcp-session-id') || url.searchParams.get('sessionId'))?.trim();
    const sessionId = headerSessionId || querySessionId;

    if (!headerSessionId && querySessionId) {
      req.headers['mcp-session-id'] = querySessionId;
    }

    // Handle DELETE: Streamable HTTP session termination
    if (req.method === 'DELETE') {
      if (sessionId && streamableSessions.has(sessionId)) {
        const entry = streamableSessions.get(sessionId)!;
        streamableSessions.delete(sessionId);
        await entry.transport.handleRequest(req, res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: `Session not found: ${sessionId || 'unspecified'}` },
        id: null
      }));
      return;
    }

    // Handle GET requests
    if (req.method === 'GET') {
      // 1. Streamable HTTP standalone notification stream (GET with session ID)
      if (sessionId) {
        const entry = streamableSessions.get(sessionId);
        if (entry) {
          entry.lastActivity = Date.now();
          await entry.transport.handleRequest(req, res);
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: `Session not found: ${sessionId}` },
          id: null
        }));
        return;
      }

      // 2. Legacy SSE handshake (GET /sse without session ID)
      if (normalizedPath === '/sse') {
        const transport = new SSEServerTransport('/messages', res);
        const legacyId = transport.sessionId;
        legacySessions.set(legacyId, transport);

        transport.onclose = () => {
          legacySessions.delete(legacyId);
        };

        const serverInstance = serverFactory();
        await serverInstance.connect(transport);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    // Handle POST requests
    if (req.method === 'POST') {
      // 1. Legacy SSE message routing (?sessionId=... matching legacy session)
      if (querySessionId && legacySessions.has(querySessionId)) {
        const transport = legacySessions.get(querySessionId)!;
        await transport.handlePostMessage(req, res);
        return;
      }

      // 2. Streamable HTTP existing session message
      if (sessionId && streamableSessions.has(sessionId)) {
        const entry = streamableSessions.get(sessionId)!;
        entry.lastActivity = Date.now();
        await entry.transport.handleRequest(req, res);
        return;
      }

      // 3. Session ID specified but not found
      if (sessionId) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: `Session not found: ${sessionId}` },
          id: null
        }));
        return;
      }

      // 4. Legacy SSE fallback: POST /messages with no session ID and single active session
      const acceptHeader = req.headers['accept'] || '';
      const isStreamableAccept = acceptHeader.includes('text/event-stream');
      if (
        (normalizedPath === '/messages' || normalizedPath === '/message') &&
        legacySessions.size === 1 &&
        !isStreamableAccept
      ) {
        const transport = legacySessions.values().next().value!;
        await transport.handlePostMessage(req, res);
        return;
      }

      // 5. Streamable HTTP initialization (POST /sse, POST /mcp, POST /, etc.)
      const isMcpPath = ['/sse', '/mcp', '/messages', '/message', '/'].includes(normalizedPath);
      if (!isMcpPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });

      const serverInstance = serverFactory();
      await serverInstance.connect(transport);
      await transport.handleRequest(req, res);

      if (transport.sessionId) {
        const newSessionId = transport.sessionId;
        streamableSessions.set(newSessionId, {
          transport,
          lastActivity: Date.now(),
        });
        transport.onclose = () => {
          streamableSessions.delete(newSessionId);
        };
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // Keep-alive heartbeat (every 25s) for legacy SSE sessions to prevent NAT/proxy timeouts
  const heartbeatInterval = setInterval(() => {
    for (const transport of legacySessions.values()) {
      try {
        transport.send({ jsonrpc: '2.0', method: 'ping' } as any).catch(() => {});
      } catch {}
    }
  }, 25000);

  // Prune inactive streamable sessions (idle for > 1 hour)
  const pruneInterval = setInterval(() => {
    const now = Date.now();
    const maxIdleMs = 60 * 60 * 1000;
    for (const [id, entry] of streamableSessions.entries()) {
      if (now - entry.lastActivity > maxIdleMs) {
        streamableSessions.delete(id);
        entry.transport.close().catch(() => {});
      }
    }
  }, 60000);

  httpServer.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(pruneInterval);
    for (const transport of legacySessions.values()) {
      try { transport.close(); } catch {}
    }
    for (const entry of streamableSessions.values()) {
      try { entry.transport.close().catch(() => {}); } catch {}
    }
  });

  httpServer.listen(port, host, () => {
    console.error(`[Server] Memory MCP Server running on SSE/HTTP at http://${host}:${port}/sse (health: http://${host}:${port}/health)`);
  });

  return httpServer;
}
