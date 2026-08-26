// ponytail: Minimal native HTTP/SSE MCP transport server using node:http & node:crypto
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

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

  const sessions = new Map<string, SSEServerTransport>();

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const hostHeader = req.headers.host || `localhost:${port}`;
    const protocol = (req.socket as any).encrypted ? 'https' : 'http';
    const url = new URL(req.url || '/', `${protocol}://${hostHeader}`);

    // Health check endpoint
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'mcp-local-memory',
        version: '2.0.1',
        activeSessions: sessions.size,
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

    // SSE Handshake
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      sessions.set(sessionId, transport);

      transport.onclose = () => {
        sessions.delete(sessionId);
      };

      const serverInstance = serverFactory();
      await serverInstance.connect(transport);
      return;
    }

    // Post Messages
    if (req.method === 'POST' && (url.pathname === '/messages' || url.pathname === '/message')) {
      const sessionId = url.searchParams.get('sessionId');
      let transport: SSEServerTransport | undefined;

      if (sessionId) {
        transport = sessions.get(sessionId);
      } else if (sessions.size === 1) {
        // ponytail: If single active session and client omitted query param, route directly
        transport = sessions.values().next().value;
      }

      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Session not found: ${sessionId || 'unspecified'}` }));
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // Keep-alive heartbeat (every 25s) to prevent NAT/proxy timeouts
  const heartbeatInterval = setInterval(() => {
    for (const transport of sessions.values()) {
      try {
        transport.send({ jsonrpc: '2.0', method: 'ping' } as any).catch(() => {});
      } catch {}
    }
  }, 25000);

  httpServer.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  httpServer.listen(port, host, () => {
    console.error(`[Server] Memory MCP Server running on SSE at http://${host}:${port}/sse (health: http://${host}:${port}/health)`);
  });

  return httpServer;
}
