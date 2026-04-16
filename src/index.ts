import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { loadConfig } from './config.js';
import { FloeApiClient } from './client.js';
import { createMcpServer } from './server.js';

async function main() {
  const config = loadConfig();
  const isStdio = process.argv.includes('--stdio') || !process.stdin.isTTY;

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
      // Forward auth header to API client if present
      const authHeader = req.headers.authorization;
      const reqClient = authHeader
        ? new FloeApiClient(config.apiBaseUrl, authHeader.replace('Bearer ', ''))
        : client;

      const server = createMcpServer(reqClient);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST' }));
    app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Stateless server' }));

    const port = parseInt(process.env.MCP_PORT ?? '3100', 10);
    app.listen(port, '0.0.0.0', () => {
      console.log(`[floe-mcp] Running at http://0.0.0.0:${port}`);
      console.log(`[floe-mcp] API: ${config.apiBaseUrl}`);
    });
  }
}

main().catch((err) => {
  console.error('[floe-mcp] Fatal:', err);
  process.exit(1);
});
