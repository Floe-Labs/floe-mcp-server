import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FloeApiClient } from './client.js';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

export function createMcpServer(client: FloeApiClient): McpServer {
  const server = new McpServer({
    name: 'floe-lending',
    version: '0.2.0',
  });

  registerAllTools(server, client);
  registerResources(server, client);
  registerPrompts(server);

  return server;
}
