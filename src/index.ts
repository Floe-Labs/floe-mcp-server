import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { loadConfig } from './config.js';
import { FloeApiClient } from './client.js';
import { createMcpServer } from './server.js';

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
    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', version: '0.1.0', apiBaseUrl: config.apiBaseUrl });
    });

    app.post('/mcp', async (req, res) => {
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      const allowFallback = process.env.ALLOW_SHARED_KEY_FALLBACK === 'true';

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

    const rawPort = process.env.MCP_PORT ?? '3100';
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid MCP_PORT: "${rawPort}" (must be 1-65535)`);
    }

    const host = process.env.MCP_HOST ?? '127.0.0.1';
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
