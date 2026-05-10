# @floelabs/mcp-server

[![npm version](https://img.shields.io/npm/v/@floelabs/mcp-server)](https://www.npmjs.com/package/@floelabs/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Base Mainnet](https://img.shields.io/badge/Base-Mainnet-0052FF)](https://basescan.org/address/0x17946cD3e180f82e632805e5549EC913330Bb175)

**The Financial OS for AI Agents — exposed over MCP.**

Connect Claude Desktop, Claude Code, Cursor, CrewAI, or any MCP-compatible client to the full Floe stack: wallet, on-ramp, working capital, x402 payments, and credit thresholds. 36 tools across the six components, with transport-aware auth (remote HTTP uses a Bearer token; local stdio reads `FLOE_API_KEY` from the env).

> **Proof points:** 3,000+ secured working capital lines issued · zero defaults · 13,000+ x402 APIs reachable via the Floe proxy.

---

## The Floe Stack (what this MCP server exposes)

| # | Component | Status | Tools |
|---|---|---|---|
| 01 | **Agent Wallet** | `GA` | `get_wallet_balance`, `get_credit_remaining`, `get_loan_state` |
| 02 | **Fiat on/off-ramp** | Dashboard-driven | On-ramp links generated server-side; no MCP tool required today. Tool surface `Roadmap`. |
| 03 | **Secured working capital** | `GA` | `get_markets`, `get_market_details`, `get_open_lend_intents`, `get_open_borrow_intents`, `get_intent_details`, `get_loan`, `get_user_loans`, `get_loan_health`, `get_liquidation_quote`, `create_lend_intent`, `create_borrow_intent`, `create_counter_intent`, `repay_loan`, `add_collateral`, `withdraw_collateral`, `liquidate_loan`, `revoke_intent`, `approve_token`, `get_accrued_interest`, `get_token_price`, `check_compatibility`, `calculate_risk`, `estimate_interest` |
| 04 | **Unsecured working capital** | `Preview` | Coming soon — email [hello@floelabs.xyz](mailto:hello@floelabs.xyz) for the design partner program |
| 05 | **x402 payment facilitator** | `GA` (preflight + gating) | `estimate_x402_cost`. Payment execution flows through `https://x402.floelabs.xyz/proxy/fetch`. |
| 06 | **Credit & trust bureau** | Writer `GA` · Portable reader `Preview` | `list_credit_thresholds`, `register_credit_threshold`, `delete_credit_threshold`. Portable ERC-8004 reader tool is on the roadmap (see below). |

Plus utility tools — `simulate_transaction`, `broadcast_transaction`, `get_transaction_status` — shared across components.

---

## Tested clients

| Client | Status |
|---|---|
| Claude Desktop | `GA` |
| Claude Code | `GA` |
| Cursor | `GA` |
| Continue / Cline | Best-effort |
| CrewAI (via `langchain-mcp-adapters`) | `Beta` |
| OpenAI Agents SDK | `Preview` (MCP fallback while native adapter ships) |
| ElizaOS | `Preview` |

---

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

---

## Auth model

Auth source depends on transport:

| Transport | Identity source |
|---|---|
| Remote HTTP (`https://mcp.floelabs.xyz/mcp`) | `Authorization: Bearer floe_live_...` header (per-request) |
| Local stdio (`floe-mcp` / `npx @floelabs/mcp-server`) | `FLOE_API_KEY` env var |
| Local HTTP (self-hosted) | Bearer header takes precedence; when `ALLOW_SHARED_KEY_FALLBACK=true`, the server falls back to `FLOE_API_KEY` if no header is sent |

Get a key:

1. Go to [dev-dashboard.floelabs.xyz](https://dev-dashboard.floelabs.xyz)
2. Connect your wallet
3. Create an API key — you'll get a `floe_live_...` key

> **Fund with fiat:** You can fund your wallet with USDC via Coinbase — credit card, bank transfer, Apple Pay, Google Pay — directly from the dashboard. No crypto on-ramp needed.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FLOE_API_KEY` | Yes | — | Your Floe API key (`floe_live_...`) |
| `FLOE_API_BASE_URL` | No | `https://credit-api.floelabs.xyz` | API endpoint |
| `MCP_PORT` | No | `3100` | HTTP server port (non-stdio mode) |
| `ALLOW_SHARED_KEY_FALLBACK` | No | `false` | Allow env-var key fallback when no Bearer header is sent (HTTP mode only) |

---

## What can agents do?

| Floe component | Capability |
|---|---|
| Agent Wallet | Read balances, credit headroom, loan-lifecycle state |
| Secured working capital | Browse markets, post intents, match offers, repay, manage collateral, liquidate |
| x402 payment facilitator | Preflight x402 costs against current credit and spend limits |
| Credit & trust bureau | Register webhook thresholds on credit utilization; list / delete |

---

## Tools (36)

Below the tools are listed by request type. Mapping to the six product components is in the table above.

### Read tools

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

### Write tools (return unsigned transactions)

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

### Analysis tools

| Tool | Description |
|------|-------------|
| `check_compatibility` | Check if two intents can match |
| `calculate_risk` | Risk metrics: LTV, liquidation price, buffer |
| `estimate_interest` | Interest estimate for given loan terms |

### Utility tools

| Tool | Description |
|------|-------------|
| `simulate_transaction` | Dry-run a transaction (eth_call) |
| `broadcast_transaction` | Submit a signed transaction |
| `get_transaction_status` | Check transaction receipt |

### Agent-awareness tools

Lets an agent answer "do I have credit?", "is this call worth it?", and "where am I in the loan lifecycle?" before committing capital. All require an agent API key (`floe_*`). The calling identity is taken from the Bearer header in HTTP mode, or from `FLOE_API_KEY` in stdio mode (and as a fallback in HTTP mode when `ALLOW_SHARED_KEY_FALLBACK=true`).

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

### Roadmap tools (not yet shipped)

- `get_credit_profile` — read a portable ERC-8004 credit record (`Preview`)
- `request_unsecured_credit` — apply for receivables-backed credit (`Preview`)
- `create_onramp_link` — generate a one-shot fiat on-ramp URL for an agent operator (`Roadmap`)

Email [hello@floelabs.xyz](mailto:hello@floelabs.xyz) for early access to any of these.

---

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

### Example: Get a USDC Credit Line

```
Agent: "I need 9,500 USDC working capital"

1. get_open_lend_intents → browse USDC/USDC offers
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

// Sign and send each transaction in order
for (const { transaction: tx } of response.transactions) {
  const hash = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
  });
  // Wait for confirmation before next step
}
```

---

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

### CrewAI

CrewAI agents can consume the Floe MCP tools via `langchain-mcp-adapters`. A runnable crew is available in [floe-examples/crewai-demo](https://github.com/Floe-Labs/floe-examples).

---

## Architecture

```
Your Agent → MCP Server → credit-api.floelabs.xyz → Envio Indexer / Base RPC
                ↑                    ↑
           This package         Private backend
          (open source)        (holds secrets)
```

The MCP server is a thin HTTP client. All protocol logic, indexer queries, and RPC calls happen in the private Floe API backend. This package contains only tool definitions and `fetch()` calls.

---

## Protocol overview

Floe is an **intent-based** lending protocol on Base, surfaced as the lending layer of the Financial OS:

1. **Primary market (USDC/USDC):** Deposit USDC as collateral, borrow up to 95% as a credit line. No price-volatility risk — same-token market.
2. **Volatile markets:** Also supports WETH and cbBTC collateral for crypto-native use cases.
3. **Solvers** automatically match compatible intent pairs on-chain.
4. **Loans** are created with matched terms, collateral locked in per-loan isolated escrow.
5. **Gas-free** — Floe sponsors all transaction costs.
6. **Fixed rates** — no variable-rate surprises.

Key concepts:
- **Intent**: An on-chain offer to lend or borrow
- **Counter-Intent**: An intent created to match an existing offer
- **Health Factor**: Ratio of collateral value to debt — below threshold triggers liquidation
- **LTV (Loan-to-Value)**: Borrower's debt as % of collateral value

---

## Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| LendingIntentMatcher | `0x17946cD3e180f82e632805e5549EC913330Bb175` |
| PriceOracle | `0xEA058a06b54dce078567f9aa4dBBE82a100210Cc` |
| LendingViews | `0x9101027166bE205105a9E0c68d6F14f21f6c5003` |
| x402 Facilitator | `0x58EDdE022FFDAD3Fb0Fb0E7D51eb05AaF66a31f1` |

---

## Links

- [Website](https://floelabs.xyz)
- [Dashboard](https://dev-dashboard.floelabs.xyz)
- [Documentation](https://floe-labs.gitbook.io/docs)
- [TypeScript SDK (`floe-agent`)](https://github.com/Floe-Labs/agentkit-actions)
- [Python SDK (`floe-agentkit-actions`)](https://github.com/Floe-Labs/agentkit-actions-py)
- [End-to-end examples](https://github.com/Floe-Labs/floe-examples)

## License

MIT
