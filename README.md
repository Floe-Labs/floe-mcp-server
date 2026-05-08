# @floelabs/mcp-server

[![npm version](https://img.shields.io/npm/v/@floelabs/mcp-server)](https://www.npmjs.com/package/@floelabs/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Base Mainnet](https://img.shields.io/badge/Base-Mainnet-0052FF)](https://basescan.org/address/0x17946cD3e180f82e632805e5549EC913330Bb175)

MCP server for the [Floe](https://dev-dashboard.floelabs.xyz) credit protocol. Gives AI agents (Claude, Cursor, custom) full access to DeFi lending on Base.

## Quick Start

### Option 1: Remote (recommended)

Point your MCP client directly at the hosted endpoint — no installation needed.

**Claude Desktop / Claude Code:**
```json
{
  "mcpServers": {
    "floe": {
      "url": "https://mcp.floelabs.xyz/mcp",
      "headers": {
        "Authorization": "Bearer floe_live_YOUR_API_KEY"
      }
    }
  }
}
```

### Option 2: Local via npx

Run the server locally. It proxies all requests to the Floe API.

```bash
FLOE_API_KEY=floe_live_YOUR_API_KEY npx @floelabs/mcp-server
```

**Claude Desktop config:**
```json
{
  "mcpServers": {
    "floe": {
      "command": "npx",
      "args": ["@floelabs/mcp-server"],
      "env": {
        "FLOE_API_KEY": "floe_live_YOUR_API_KEY"
      }
    }
  }
}
```

**Cursor config (`.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "floe": {
      "command": "npx",
      "args": ["@floelabs/mcp-server"],
      "env": {
        "FLOE_API_KEY": "floe_live_YOUR_API_KEY"
      }
    }
  }
}
```

### Option 3: Install globally

```bash
npm install -g @floelabs/mcp-server
FLOE_API_KEY=floe_live_YOUR_API_KEY floe-mcp
```

## Get an API Key

1. Go to [dev-dashboard.floelabs.xyz](https://dev-dashboard.floelabs.xyz)
2. Connect your wallet
3. Create an API key — you'll get a `floe_live_...` key

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FLOE_API_KEY` | Yes | — | Your Floe API key (`floe_live_...`) |
| `FLOE_API_BASE_URL` | No | `https://credit-api.floelabs.xyz` | API endpoint |
| `MCP_PORT` | No | `3100` | HTTP server port (non-stdio mode) |

## What Can Agents Do?

| Category | Capabilities |
|----------|-------------|
| **Markets** | Browse lending markets, check rates, view liquidity |
| **Intents** | Create lend/borrow offers, accept existing offers, cancel intents |
| **Loans** | Monitor loan health, repay, add/withdraw collateral, liquidate |
| **Transactions** | Build unsigned txs, simulate, broadcast signed txs, check receipts |
| **Analysis** | Check intent compatibility, calculate risk metrics, estimate interest |

## Tools (36)

### Read Tools
| Tool | Description |
|------|-------------|
| `get_markets` | List active lending markets with rates and liquidity |
| `get_market_details` | Detailed market info including oracle prices |
| `get_open_lend_intents` | Browse lend offers available for borrowing against |
| `get_open_borrow_intents` | Browse borrow requests from borrowers seeking lenders |
| `get_intent_details` | Get full details of a specific intent by hash |
| `get_loan` | Get loan details by numeric ID |
| `get_user_loans` | Get all loans for a wallet (borrower + lender) |
| `get_loan_health` | Check loan LTV, health status, liquidation risk |
| `get_liquidation_quote` | Get liquidation eligibility and details |
| `get_token_price` | Current oracle price for collateral tokens |
| `get_wallet_balance` | Token balances for a wallet |
| `get_accrued_interest` | Interest accrued on a loan |

### Write Tools (return unsigned transactions)
| Tool | Description |
|------|-------------|
| `create_lend_intent` | Create a lending offer |
| `create_borrow_intent` | Create a borrowing request |
| `create_counter_intent` | Accept an existing offer (solver matches automatically) |
| `repay_loan` | Repay a loan with slippage protection |
| `add_collateral` | Add collateral to improve loan health |
| `withdraw_collateral` | Withdraw excess collateral |
| `liquidate_loan` | Liquidate an unhealthy loan |
| `revoke_intent` | Cancel an active intent |
| `approve_token` | Approve token spending for the protocol |

### Analysis Tools
| Tool | Description |
|------|-------------|
| `check_compatibility` | Check if two intents can match |
| `calculate_risk` | Risk metrics: LTV, liquidation price, buffer |
| `estimate_interest` | Interest estimate for given loan terms |

### Utility Tools
| Tool | Description |
|------|-------------|
| `simulate_transaction` | Dry-run a transaction (eth_call) |
| `broadcast_transaction` | Submit a signed transaction |
| `get_transaction_status` | Check transaction receipt |

### Agent Awareness Tools

Let's an agent answer "do I have credit?", "is this call worth it?", and "where am I in the loan lifecycle?" before committing capital. All require an agent API key (`floe_*`); the calling identity is taken from the bearer token.

| Tool | Description |
|------|-------------|
| `get_credit_remaining` | Current available credit, headroom to auto-borrow, utilization in bps |
| `get_loan_state` | Coarse state: `idle` \| `borrowing` \| `at_limit` \| `repaying` |
| `get_spend_limit` | Currently active session spend cap, if any |
| `set_spend_limit` | Set a session-level USDC ceiling (resets the session window) |
| `clear_spend_limit` | Remove the session spend cap |
| `list_credit_thresholds` | List registered credit-utilization thresholds |
| `register_credit_threshold` | Register a webhook trigger at a utilization threshold (cap: 20 per agent) |
| `delete_credit_threshold` | Remove a registered threshold |
| `estimate_x402_cost` | Preflight an x402 URL — returns cost + reflection against your credit, no payment |

## Transaction Flow

All write tools return **unsigned transactions** — the server never holds private keys.

```
1. Call a write tool (e.g., create_counter_intent)
   → Returns { transactions: [...], summary, warnings, expiresAt }

2. (Optional) Call simulate_transaction to dry-run

3. Sign each transaction locally with your wallet

4. Call broadcast_transaction with the signed hex
   → Returns { transactionHash, status, blockNumber }
```

### Example: Accept a Lend Offer

```
Agent: "Borrow 1000 USDC on Floe"

1. get_open_lend_intents → browse offers
2. create_counter_intent(offer_hash, wallet) → unsigned txs
3. simulate_transaction(from, to, data) → { success: true, gasEstimate }
4. Sign locally → signed hex
5. broadcast_transaction(signed_hex) → confirmed
```

### Signing with viem

```typescript
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const wallet = createWalletClient({
  account: privateKeyToAccount(PRIVATE_KEY),
  chain: base,
  transport: http(),
});

// Optional launch gate: create a pre-send receipt before broadcast.
// Run this once per tx in your shell/client flow:
// npx --package nishvault-preflight-buy nishvault-guard-tx -- \
//   --seller-url https://api.nishvault.com \
//   --to "$TX_TO" \
//   --data "$TX_DATA" \
//   --value "$TX_VALUE"

// Sign and send each transaction in order after PRE_SEND_PROOF_RECEIPT exists.
for (const { transaction: tx } of response.transactions) {
  const hash = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
  });
  // Wait for confirmation before next step
}
```

## Programmatic Usage

### MCP Client SDK

```typescript
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-agent" });
await client.connect(new StreamableHTTPClientTransport(
  new URL("https://mcp.floelabs.xyz/mcp"),
  { requestInit: { headers: { "Authorization": "Bearer floe_live_..." } } }
));

const markets = await client.callTool("get_markets", {});
const counter = await client.callTool("create_counter_intent", {
  offer_hash: "0x...",
  wallet_address: "0x...",
});
```

### LangChain / LangGraph

```python
from langchain_mcp_adapters import MultiServerMCPClient

async with MultiServerMCPClient({
    "floe": {"url": "https://mcp.floelabs.xyz/mcp", "headers": {"Authorization": "Bearer floe_live_..."}}
}) as client:
    tools = client.get_tools()
    # Use tools in your agent
```

## Architecture

```
Your Agent → MCP Server → credit-api.floelabs.xyz → Envio Indexer / Base RPC
                ↑                    ↑
           This package         Private backend
          (open source)        (holds secrets)
```

The MCP server is a thin HTTP client. All protocol logic, indexer queries, and RPC calls happen in the private Floe API backend. This package contains only tool definitions and `fetch()` calls.

## Protocol Overview

Floe is an **intent-based** lending protocol:

1. **Lenders** post offers specifying amount, minimum rate, and max LTV
2. **Borrowers** post requests specifying amount, collateral, and max rate
3. **Solvers** automatically match compatible intent pairs on-chain
4. **Loans** are created with the matched terms, collateral locked
5. **Borrowers** repay principal + interest to unlock collateral

Key concepts:
- **Intent**: An on-chain offer to lend or borrow
- **Counter-Intent**: An intent created to match an existing offer
- **Health Factor**: Ratio of collateral value to debt — below threshold triggers liquidation
- **LTV (Loan-to-Value)**: Borrower's debt as % of collateral value

## Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| LendingIntentMatcher | `0x17946cD3e180f82e632805e5549EC913330Bb175` |
| PriceOracle | `0xEA058a06b54dce078567f9aa4dBBE82a100210Cc` |
| LendingViews | `0x9101027166bE205105a9E0c68d6F14f21f6c5003` |

## Links

- [Website](https://floelabs.xyz)
- [Documentation](https://floe-labs.gitbook.io/docs)
- [AgentKit Actions (TypeScript)](https://github.com/floelabs/agentkit-actions)
- [AgentKit Actions (Python)](https://github.com/floelabs/agentkit-actions-py)

## License

MIT
