import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { loadConfig } from './config.js';
import { FloeApiClient } from './client.js';
import { createMcpServer } from './server.js';
import { VERSION } from './version.js';

async function main() {
  const config = loadConfig();
  const isStdio = process.argv.includes('--stdio');

  const client = new FloeApiClient(config.apiBaseUrl, config.apiKey);

  if (isStdio) {
    const server = createMcpServer(client);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[floe-mcp] Running via stdio');
  } else {
    const rawPort = process.env.MCP_PORT ?? '3100';
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid MCP_PORT: "${rawPort}" (must be 1-65535)`);
    }
    const host = process.env.MCP_HOST ?? '127.0.0.1';

    const app = express();

    // CORS: restrict to localhost origins by default. Operators can
    // widen via MCP_TRUSTED_ORIGINS (comma-separated).
    const trustedOrigins = new Set([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      ...(process.env.MCP_TRUSTED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) ?? []),
    ]);

    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && trustedOrigins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID',
      );
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    app.use(express.json());

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', version: VERSION, apiBaseUrl: config.apiBaseUrl });
    });

    app.post('/mcp', async (req, res) => {
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      const allowFallback = process.env.ALLOW_SHARED_KEY_FALLBACK === 'true';

      // Shared-key fallback is only safe when the request comes from a
      // trusted origin. Without this check, any website visited by the
      // operator can invoke MCP tools using the process-wide FLOE_API_KEY
      // as an ambient credential (CVE-level CORS + auth bypass).
      if (!bearerToken && allowFallback) {
        const origin = req.headers.origin;
        if (origin && !trustedOrigins.has(origin)) {
          return res.status(403).json({
            error: 'Cross-origin shared-key fallback is not allowed',
            detail: 'Set MCP_TRUSTED_ORIGINS to include your origin, or pass a Bearer token',
          });
        }
      }

      if (!bearerToken && !allowFallback) {
        return res.status(401).json({ error: 'Missing Bearer token' });
      }

      const reqClient = bearerToken
        ? new FloeApiClient(config.apiBaseUrl, bearerToken)
        : client;

      const server = createMcpServer(reqClient);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        transport.close();
        server.close();
      };

      res.on('close', cleanup);
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        cleanup();
        console.error('[floe-mcp] /mcp request failed:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal MCP error' });
        }
      }
    });

    app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST' }));
    app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Stateless server' }));

    app.listen(port, host, () => {
      console.log(`[floe-mcp] Running at http://${host}:${port}`);
      console.log(`[floe-mcp] API: ${config.apiBaseUrl}`);
    });
  }
}

main().catch((err) => {
  console.error('[floe-mcp] Fatal:', err);
  process.exit(1);
});
