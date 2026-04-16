import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPrompts(server: McpServer) {
  server.prompt('lending-guide', 'Step-by-step guide for lending on Floe', async () => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: 'Guide me through lending on Floe. Use get_markets, get_open_lend_intents, then help me create a competitive lend intent.' },
    }],
  }));

  server.prompt('borrowing-guide', 'Step-by-step guide for borrowing on Floe', async () => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: 'Guide me through borrowing on Floe. Browse lend offers, create a counter-intent, explain collateral and liquidation risks.' },
    }],
  }));

  server.prompt('risk-assessment', 'Assess risk of a lending/borrowing position', async () => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: 'Assess the risk of a position using calculate_risk, get_token_price, and estimate_interest. Provide a clear summary.' },
    }],
  }));
}
