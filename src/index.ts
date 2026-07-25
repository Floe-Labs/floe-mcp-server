import { fstatSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { loadConfig } from './config.js';
import { FloeApiClient } from './client.js';
import { createMcpServer } from './server.js';
import { VERSION } from './version.js';

// An MCP client spawning us wires stdin to a pipe (or socketpair) it will
// speak the protocol on. A plain non-TTY check would misfire under systemd
// — the hosted deploy's unit runs `node dist/index.js` with no flag, and
// journald makes stdout a pipe while StandardInput defaults to /dev/null
// (a character device) — so probe what stdin actually IS instead. Closed
// or unstattable stdin → not a client, default to HTTP.
function stdinIsPipe(): boolean {
  try {
    const stat = fstatSync(0);
    return stat.isFIFO() || stat.isSocket();
  } catch {
    return false;
  }
}

async function main() {
  const config = loadConfig();
  // Transport selection: --stdio / --http are explicit overrides. With
  // neither flag, default to stdio whenever stdin is a pipe — that is what
  // an MCP client spawning us looks like — and to HTTP when run
  // interactively in a terminal or as a service. Bare `npx
  // @floelabs/mcp-server` under Claude Desktop/Cursor therefore speaks MCP
  // on stdout instead of silently starting an HTTP listener the client
  // will hang on, while the systemd-hosted deploy keeps serving HTTP.
  const wantsStdio = process.argv.includes('--stdio');
  const wantsHttp = process.argv.includes('--http');
  const isStdio = wantsStdio || (!wantsHttp && stdinIsPipe());

  if (isStdio) {
    const client = new FloeApiClient(config.apiBaseUrl, config.apiKey);
    if (!config.apiKey) {
      console.error(
        '[floe-mcp] No FLOE_API_KEY set — running keyless. Only get_markets, ' +
        'check_x402_url, and search_floe_docs will work; every other tool ' +
        'returns AUTH_REQUIRED. Get a key at https://dev-dashboard.floelabs.xyz',
      );
    }
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
    // widen via MCP_TRUSTED_ORIGINS (comma-separated). Entries are
    // canonicalized via new URL().origin so trailing slashes, default
    // ports, etc. don't silently break matching.
    const parseOrigins = (raw: string | undefined): string[] => {
      if (!raw) return [];
      return raw.split(',').map(o => o.trim()).filter(Boolean).map(v => {
        try { return new URL(v).origin; } catch {
          console.warn(`[floe-mcp] Ignoring invalid MCP_TRUSTED_ORIGINS entry: "${v}"`);
          return '';
        }
      }).filter(Boolean);
    };
    const trustedOrigins = new Set([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      ...parseOrigins(process.env.MCP_TRUSTED_ORIGINS),
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

      // Per-request Bearer is the identity in HTTP mode. No header → a
      // keyless client: the public tools (get_markets, check_x402_url,
      // search_floe_docs) still work and every key-gated tool returns a
      // structured AUTH_REQUIRED error instead of a transport-level 401.
      // The old ALLOW_SHARED_KEY_FALLBACK escape hatch is gone: requests
      // without an Origin header (curl, server-side callers) used to slip
      // past the origin check and inherit the process-wide FLOE_API_KEY
      // as an ambient credential. Headerless callers must never inherit
      // the shared key.
      const reqClient = new FloeApiClient(config.apiBaseUrl, bearerToken);

      // Scope narrowing via query params (Supabase/Neon pattern):
      //   ?read_only=true        → register only non-mutating tools
      //   ?features=spend,docs   → register only the named capability groups
      // The server is already instantiated per request, so filtering at
      // registration time is free.
      const requestUrl = new URL(req.url, 'http://localhost');
      const readOnly = requestUrl.searchParams.get('read_only') === 'true';
      const rawFeatures = requestUrl.searchParams.get('features');
      const features = rawFeatures
        ? rawFeatures.split(',').map((f) => f.trim()).filter(Boolean)
        : undefined;

      const server = createMcpServer(reqClient, { readOnly, features });
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
