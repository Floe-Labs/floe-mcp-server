# @floelabs/mcp-server

[![npm version](https://img.shields.io/npm/v/@floelabs/mcp-server)](https://www.npmjs.com/package/@floelabs/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Base Mainnet](https://img.shields.io/badge/Base-Mainnet-0052FF)](https://basescan.org/address/0x17946cD3e180f82e632805e5549EC913330Bb175)

**The spend layer for AI agents, over MCP.** Give Claude Desktop, Claude Code,
Cursor, CrewAI, or any MCP client a single surface to pay 2,000+ vendor API services —
with budgets the agent can reason about. Walletless. No crypto required.

[Website](https://floelabs.xyz) · [Docs](https://floe-labs.gitbook.io/docs) · [Dashboard](https://dev-dashboard.floelabs.xyz) · [𝕏](https://x.com/FloeLabs)

41 tools, transport-aware auth (remote HTTP uses a Bearer token; local stdio reads `FLOE_API_KEY` from the env).

---

> **Start free.** $2 in API credit on signup — no card, no wallet.
> [Get an agent key →](https://dev-dashboard.floelabs.xyz)

## What makes this different

Most payment tools let an agent *spend*. Floe lets an agent **reason about spend
before it commits** — and stops it before it overruns.

- **Agent-awareness tools** — `get_credit_remaining`, `estimate_x402_cost`,
  `get_loan_state`: your agent asks "do I have budget? is this call worth it?"
  *before* paying, not after.
- **Context-aware budgets** — set a session spend cap; the agent tapers as it
  nears the limit and replans to finish on budget.
- **The `floe-budget` Claude Skill** (ships in this repo) — the playbook that
  turns those tools into deliberate spending behavior. [Jump to it ↓](#budget-skill)
- **Server-side enforcement** — the soft signal is the skill; the hard ceiling
  is the on-chain spend cap + merchant allowlist. The agent cannot overspend
  regardless of what it decides.

## Quick start (remote, recommended)

```json
{ "mcpServers": { "floe": {
  "url": "https://mcp.floelabs.xyz/mcp",
  "headers": { "Authorization": "Bearer floe_YOUR_AGENT_KEY" }
} } }
```

Get your agent key: [dashboard](https://dev-dashboard.floelabs.xyz) → Create agent → copy the `floe_<hex>` key
(shown once). Or from the CLI: `npx floe-agent register --name my-agent`.

→ [Local stdio, global install, and key taxonomy below](#install-options)

## Tools at a glance

| Group | Tools | For |
|---|---|---|
| **Agent awareness** ⭐ | `get_credit_remaining`, `estimate_x402_cost`, `get_loan_state`, `get_spend_limit`, `set_spend_limit`, `clear_spend_limit` | every agent — reason about cost before paying |
| **Spend governance** | `register_credit_threshold`, `list_credit_thresholds`, `delete_credit_threshold` (webhooks) | govern + alert on utilization |
| **Merchant allowlist** | `set_allowlist_mode`, `get_allowlist_mode`, `add_allowlist_entry`, `remove_allowlist_entry`, `list_allowlist` | default-deny on which destinations the agent may pay |
| Wallet | `get_wallet_balance`, `get_accrued_interest` | balances + state |
| Utility | `simulate_transaction`, `broadcast_transaction`, `get_transaction_status` | tx lifecycle |
| Lending protocol (advanced) | 20+ intent / collateral / liquidation tools | crypto-native lending against deposits |

Full per-tool reference is in [Tools (41)](#tools-41) below.

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

<a id="install-options"></a>

## Install options

Option 1 (remote) is in [Quick start](#quick-start-remote-recommended) above. For local runs:

### Local via npx

Run the server locally. It proxies all requests to the Floe API.

```bash
FLOE_API_KEY=floe_YOUR_AGENT_KEY npx @floelabs/mcp-server
```

**Claude Desktop config:**
```json
{
  "mcpServers": {
    "floe": {
      "command": "npx",
      "args": ["@floelabs/mcp-server"],
      "env": {
        "FLOE_API_KEY": "floe_YOUR_AGENT_KEY"
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
        "FLOE_API_KEY": "floe_YOUR_AGENT_KEY"
      }
    }
  }
}
```

### Install globally

```bash
npm install -g @floelabs/mcp-server
FLOE_API_KEY=floe_YOUR_AGENT_KEY floe-mcp
```

---

## Auth model

Auth source depends on transport:

| Transport | Identity source |
|---|---|
| Remote HTTP (`https://mcp.floelabs.xyz/mcp`) | `Authorization: Bearer <key>` header (per-request) |
| Local stdio (`floe-mcp` / `npx @floelabs/mcp-server`) | `FLOE_API_KEY` env var |
| Local HTTP (self-hosted) | Bearer header takes precedence; when `ALLOW_SHARED_KEY_FALLBACK=true`, the server falls back to `FLOE_API_KEY` if no header is sent |

### Which key to use

Two key formats unlock different surfaces:

| Key format | Scope | When to use |
|---|---|---|
| `floe_<64-hex>` (**agent key**, recommended) | One specific agent | Default for MCP. Required for agent-awareness tools (`get_credit_remaining`, `get_loan_state`, `get_spend_limit`, etc). One MCP session = one agent. |
| `floe_live_<base62>` (developer key) | Whole developer account | Use only if you're running a multi-tenant integration that needs to see *all* agents. Agent-awareness tools return 401 because the caller is the developer, not a single agent. |

Get an **agent key**:

1. Go to [dev-dashboard.floelabs.xyz](https://dev-dashboard.floelabs.xyz)
2. Connect your wallet and **Create an agent** (name + borrow limit + max rate)
3. Copy the `floe_<64-hex>` key shown at the end of the wizard — it is revealed once

You can also mint one from the CLI without visiting the dashboard:

```bash
# TypeScript SDK
npx floe-agent register --name my-agent --borrow-limit 10000

# Python SDK
floe-agent register --name my-agent --borrow-limit 10000
```

Get a **developer key** (only if you need multi-tenant access across all your agents):

1. Go to [dev-dashboard.floelabs.xyz/keys](https://dev-dashboard.floelabs.xyz/keys)
2. Click **Create Key**, label it, pick `read` or `read_write` permissions
3. Copy the `floe_live_<base62>` key shown once

Developer keys span the whole developer account and have a separate rate limit (100 req/min). Agent-awareness tools (`get_credit_remaining`, `get_spend_limit`, etc) return 401 with a developer key because the caller is the developer, not a single agent — use an agent key for those. See the [API Keys docs](https://floe-labs.gitbook.io/docs/developers/api-keys) for the full taxonomy.

> **Fund with fiat:** You can fund your wallet with USDC via Coinbase — credit card, bank transfer, Apple Pay, Google Pay — directly from the dashboard. No crypto on-ramp needed.

### Multiple agents

One Floe developer can own many agents. To run several MCP sessions side by side (e.g. a research agent and a trading agent), mint one key per agent and configure each MCP client entry with its own key:

```json
{
  "mcpServers": {
    "floe-research": {
      "url": "https://mcp.floelabs.xyz/mcp",
      "headers": { "Authorization": "Bearer floe_KEY_FOR_RESEARCH_AGENT" }
    },
    "floe-trading": {
      "url": "https://mcp.floelabs.xyz/mcp",
      "headers": { "Authorization": "Bearer floe_KEY_FOR_TRADING_AGENT" }
    }
  }
}
```

Each session is scoped to one agent — credit lines, spend limits, and webhooks stay isolated.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FLOE_API_KEY` | Yes | — | Your Floe API key (`floe_<64-hex>` agent key recommended; `floe_live_<base62>` developer key also accepted) |
| `FLOE_API_BASE_URL` | No | `https://credit-api.floelabs.xyz` | API endpoint |
| `MCP_PORT` | No | `3100` | HTTP server port (non-stdio mode) |
| `ALLOW_SHARED_KEY_FALLBACK` | No | `false` | Allow env-var key fallback when no Bearer header is sent (HTTP mode only) |

---

## Tools (41)

Below the tools are listed by request type. The summary is in [Tools at a glance](#tools-at-a-glance) above.

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

### Agent-awareness tools ⭐

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

### Merchant-allowlist tools

Opt-in, default-deny restriction on **which destinations** the agent may pay. An allowlist entry is an ordinary capped policy row that doubles as "allowed AND capped". Default mode `off` = allow any vendor (zero onboarding friction). All require an agent API key (`floe_*`).

| Tool | Description |
|------|-------------|
| `set_allowlist_mode` | Set enforcement: `off` \| `host` (block unlisted hosts pre-fetch) \| `vendor` (block unlisted payees pre-sign) \| `both` |
| `get_allowlist_mode` | Read the agent's current enforcement mode |
| `add_allowlist_entry` | Add an allowed-AND-capped entry — `kind=api` (host) or `kind=vendor` (payee), with a `limit_raw` spend cap |
| `remove_allowlist_entry` | Revoke an allowlist entry by policy id (from `list_allowlist`) |
| `list_allowlist` | List host (`api`) and payee (`vendor`) allowlist entries with their caps |

### Roadmap tools (not yet shipped)

- `get_credit_profile` — read a portable ERC-8004 credit record (`Preview`)
- `request_unsecured_credit` — apply for receivables-backed credit (`Preview`)
- `create_onramp_link` — generate a one-shot fiat on-ramp URL for an agent operator (`Roadmap`)

Email [hello@floelabs.xyz](mailto:hello@floelabs.xyz) for early access to any of these.

---

<a id="budget-skill"></a>

## Budget-awareness skill (`floe-budget`)

A portable [Claude Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) ships with this repo at [`skills/floe-budget/`](skills/floe-budget/). It makes any Claude-native agent (Claude Code, the Agent SDK, claude.ai, or any MCP client) spend its Floe credit deliberately: read budget status before paying, **taper** as it nears the tightest cap, **replan** to finish the task on budget, and **stop** before the ceiling.

The MCP tools above are the *actions*; the skill is the *playbook*. It reads budget status from the existing `get_credit_remaining`, `get_spend_limit`, `estimate_x402_cost`, and `get_loan_state` tools, plus the `X-Floe-Budget-Advisory` header the Floe x402 proxy stamps on paid responses. No new tool or backend is required.

> **Soft signal, not the guardrail.** The skill helps a cooperative agent spend wisely. The real ceiling is enforced **server-side** — the on-chain credit line, the session spend cap, and (if configured) the merchant allowlist refuse calls past the limit regardless of what the agent decides.

**Use it:**

- **Claude Code** — copy the folder into your personal (or a repo's `.claude/`) skills directory; Claude discovers it automatically from the `SKILL.md` frontmatter.
  - From a cloned repo: `cp -r skills/floe-budget ~/.claude/skills/`
  - From an npm install: `cp -r node_modules/@floelabs/mcp-server/skills/floe-budget ~/.claude/skills/`
- **claude.ai / Agent SDK** — upload or register the `floe-budget` skill folder per the [Agent Skills docs](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview).
- **Any MCP client** — point the model at [`skills/floe-budget/SKILL.md`](skills/floe-budget/SKILL.md) as system/context guidance alongside the Floe MCP connection.

See [`skills/floe-budget/SKILL.md`](skills/floe-budget/SKILL.md) for the playbook and [`skills/floe-budget/reference.md`](skills/floe-budget/reference.md) for the `X-Floe-Budget-Advisory` field reference.

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
Agent: "I need 9,950 USDC working capital"

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
  { requestInit: { headers: { "Authorization": "Bearer floe_..." } } }
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
    "floe": {"url": "https://mcp.floelabs.xyz/mcp", "headers": {"Authorization": "Bearer floe_..."}}
}) as client:
    tools = client.get_tools()
    # Use tools in your agent
```

### CrewAI

CrewAI agents can consume the Floe MCP tools via `langchain-mcp-adapters`. A runnable crew is available in [floe-cookbook/crewai-demo](https://github.com/Floe-Labs/floe-cookbook).

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

1. **Primary market (USDC/USDC):** Deposit USDC as collateral, borrow up to 99.5% as a credit line. No price-volatility risk — same-token market.
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
- [End-to-end examples](https://github.com/Floe-Labs/floe-cookbook)

## License

MIT
