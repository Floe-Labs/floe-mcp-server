import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FloeApiClient } from '../client.js';

export function registerResources(server: McpServer, client: FloeApiClient) {
  server.resource('markets', 'floe://markets',
    { description: 'Live market data', mimeType: 'application/json' },
    async () => {
      const data = await client.getMarkets();
      return { contents: [{ uri: 'floe://markets', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.resource('getting-started', 'floe://docs/getting-started',
    { description: 'Getting started guide', mimeType: 'text/markdown' },
    async () => ({ contents: [{ uri: 'floe://docs/getting-started', mimeType: 'text/markdown', text: GETTING_STARTED }] }),
  );

  server.resource('transaction-signing', 'floe://docs/transaction-signing',
    { description: 'Transaction signing guide', mimeType: 'text/markdown' },
    async () => ({ contents: [{ uri: 'floe://docs/transaction-signing', mimeType: 'text/markdown', text: TX_SIGNING }] }),
  );
}

const GETTING_STARTED = `# Floe MCP Server

Floe is an intent-based DeFi lending protocol on Base Mainnet.

## Workflow
1. **get_markets** — see available markets
2. **get_open_lend_intents** — browse lend offers
3. **create_counter_intent** — accept an offer (solver matches automatically)
4. **get_user_loans** / **repay_loan** / **add_collateral** — manage loans

## Transactions
Write tools return unsigned transactions. Sign locally, then broadcast:
1. Call write tool → get \`{ transactions, summary, warnings }\`
2. \`simulate_transaction\` → dry-run
3. Sign with your wallet
4. \`broadcast_transaction\` → submit
`;

const TX_SIGNING = `# Transaction Signing

Write tools return:
\`\`\`json
{ "transactions": [{ "step": 1, "transaction": { "to", "data", "value", "chainId" }, "isApproval": true }] }
\`\`\`

Sign with viem:
\`\`\`typescript
for (const { transaction: tx } of response.transactions) {
  await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
}
\`\`\`

Tips:
- Skip \`isApproval: true\` steps if you have sufficient allowance
- Check \`expiresAt\` — re-call if stale
- Always \`simulate_transaction\` before broadcasting
`;
