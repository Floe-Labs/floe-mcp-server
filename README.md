# @floelabs/mcp-server

[![npm version](https://img.shields.io/npm/v/@floelabs/mcp-server)](https://www.npmjs.com/package/@floelabs/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Base Mainnet](https://img.shields.io/badge/Base-Mainnet-0052FF)](https://basescan.org/address/0x17946cD3e180f82e632805e5549EC913330Bb175)

**The spend layer for AI agents, over MCP.** Give Claude Desktop, Claude Code,
Cursor, CrewAI, or any MCP client a single surface to pay 2,000+ vendor API services —
with budgets the agent can reason about. Walletless. No crypto required.

[Website](https://floelabs.xyz) · [Docs](https://floe-labs.gitbook.io/docs) · [Dashboard](https://dev-dashboard.floelabs.xyz) · [𝕏](https://x.com/FloeLabs)

65 tools covering the full agent lifecycle — create agents, mint/rotate keys, set budgets, estimate costs, and **execute x402 payments** — with transport-aware auth (remote HTTP uses a Bearer token; local stdio reads `FLOE_API_KEY` from the env) and a **keyless tier** (`get_markets`, `check_x402_url`, `search_floe_docs` work with no key at all).

---

> **Start free.** $3 in API credit on signup — no card, no wallet.
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

One-liner installs:

```bash
# Universal (any MCP-aware client)
npx -y add-mcp https://mcp.floelabs.xyz/mcp

# Claude Code
claude mcp add --transport http floe https://mcp.floelabs.xyz/mcp --header "Authorization: Bearer YOUR_FLOE_KEY"

# Codex (reads the key from $FLOE_API_KEY at connect time)
codex mcp add floe --url https://mcp.floelabs.xyz/mcp --bearer-token-env-var FLOE_API_KEY
```

Or by JSON config:

```json
{ "mcpServers": { "floe": {
  "url": "https://mcp.floelabs.xyz/mcp",
  "headers": { "Authorization": "Bearer floe_YOUR_AGENT_KEY" }
} } }
```

Get your agent key: [dashboard](https://dev-dashboard.floelabs.xyz) → Create agent → copy the `floe_<hex>` key
(shown once). Or from the CLI: `npx floe-agent register --name my-agent`. No key yet? The server still works —
see [Keyless tier](#keyless-tier).

**Scope params** — narrow what a session can do straight from the URL:

```
https://mcp.floelabs.xyz/mcp?read_only=true          # only non-mutating tools
https://mcp.floelabs.xyz/mcp?features=spend,pricing  # only the named capability groups
```

Capability groups: `lending`, `spend`, `pricing`, `lifecycle`, `observability`, `payments`, `webhooks`, `docs`.
Both params combine. The `floe-budget` skill's decision loop needs `spend,pricing`.

→ [Local stdio, global install, and key taxonomy below](#install-options)

## Tools at a glance

| Group | Tools | For |
|---|---|---|
| **Payment execution** ⭐ | `x402_pay` (idempotent), `x402_forecast`, `estimate_x402_cost`, `check_x402_url` | pay any x402 vendor — with a cost preflight first |
| **Agent lifecycle** | `create_agent`, `list_agents`, `get_agent`, `pause_agent`, `resume_agent`, `close_agent`, `create_agent_key`, `rotate_agent_key`, `revoke_agent_key`, `set_agent_key_budget`, `open_credit_line`, `get_credit_line_bounds` | bootstrap and manage the fleet with a developer key |
| **Agent awareness** ⭐ | `get_credit_remaining`, `get_loan_state`, `get_spend_limit`, `set_spend_limit`, `clear_spend_limit` | every agent — reason about cost before paying |
| **Spend governance** | `register_credit_threshold`, `list_credit_thresholds`, `delete_credit_threshold` (webhooks) | govern + alert on utilization |
| **Merchant allowlist** | `set_allowlist_mode`, `get_allowlist_mode`, `add_allowlist_entry`, `remove_allowlist_entry`, `list_allowlist` | default-deny on which destinations the agent may pay |
| **Funding & observability** | `get_funding_instructions`, `get_balances`, `get_activity`, `get_usage_summary` | fund agents + watch the fleet spend |
| **Webhooks** | `create_webhook`, `list_webhooks`, `test_webhook` | push notifications for account events |
| **Docs** | `search_floe_docs` (keyless) | learn the Floe API without leaving MCP |
| Wallet | `get_wallet_balance`, `get_accrued_interest` | balances + state |
| Utility | `simulate_transaction`, `broadcast_transaction`, `get_transaction_status` | tx lifecycle |
| Lending protocol (advanced) | 20+ intent / collateral / liquidation tools | crypto-native lending against deposits |

Full per-tool reference is in [Tools (65)](#tools-65) below.

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
FLOE_API_KEY=floe_YOUR_AGENT_KEY npx -y @floelabs/mcp-server --stdio
```

**Claude Desktop config:**
```json
{
  "mcpServers": {
    "floe": {
      "command": "npx",
      "args": ["-y", "@floelabs/mcp-server", "--stdio"],
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
      "args": ["-y", "@floelabs/mcp-server", "--stdio"],
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
FLOE_API_KEY=floe_YOUR_AGENT_KEY floe-mcp --stdio
```

### Transport selection

`--stdio` and `--http` are explicit overrides. With neither flag, the server picks by
what stdin is: **a pipe** (an MCP client spawning it) → stdio; a terminal or a
service manager's `/dev/null` → HTTP on `127.0.0.1:3100`. So a bare `command: npx`
config now works — but keep `--stdio` in configs anyway so behavior never depends on
how the client wires stdio. On startup failure the process logs `[floe-mcp] Fatal:`
to stderr and exits with code 1; in stdio mode all logging goes to stderr, never
stdout (which carries the MCP protocol).

---

## Auth model

Auth source depends on transport:

| Transport | Identity source |
|---|---|
| Remote HTTP (`https://mcp.floelabs.xyz/mcp`) | `Authorization: Bearer <key>` header (per-request) |
| Local stdio (`floe-mcp --stdio` / `npx -y @floelabs/mcp-server --stdio`) | `FLOE_API_KEY` env var |
| Local HTTP (self-hosted) | `Authorization: Bearer <key>` header (per-request). The env-var key is **never** used as a fallback for headerless HTTP requests — requests without a Bearer run keyless. |

<a id="keyless-tier"></a>

### Keyless tier

The server starts (and the hosted endpoint answers) **without any key**. Keyless
sessions get exactly three tools with live results: `get_markets`,
`check_x402_url`, and `search_floe_docs` — enough to vet a vendor, price a call,
and learn the API before signup. Every other tool returns a structured error:

```json
{ "error": "AUTH_REQUIRED", "status": 401,
  "message": "…Requires an agent key (floe_...).",
  "next": "Get a developer key at https://dev-dashboard.floelabs.xyz, then mint agent keys with create_agent_key. …" }
```

Tool errors always carry the backend's HTTP `status` (so agents can distinguish
401/403/404/429), and 401/403 include a remediation hint that distinguishes
**missing key** from **wrong key type**.

### Which key to use

Two key formats unlock different surfaces — every tool description states which
one it needs:

| Key format | Scope | Unlocks |
|---|---|---|
| `floe_<64-hex>` (**agent key**) | One specific agent | Runtime: agent-awareness, spend governance, allowlist, reputation, `estimate_x402_cost`, `x402_forecast`, and **`x402_pay`**. One MCP session = one agent. Lifecycle tools return 401 (wrong key type). |
| `floe_live_<base62>` (**developer key**) | Whole developer account | Lifecycle: `create_agent`, agent keys (`create_agent_key`, `rotate_agent_key`, …), budgets, credit lines, funding instructions, balances, activity, usage, webhooks. Agent-runtime tools return 401 (wrong key type). |

Typical bootstrap: connect with the **developer key** → `create_agent` →
`create_agent_key` → reconnect (or open a second MCP session) with the minted
**agent key** to spend.

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

Get a **developer key** (unlocks the lifecycle tools — `create_agent`, key minting, budgets, funding, webhooks — and multi-tenant visibility across all your agents):

1. Go to [dev-dashboard.floelabs.xyz/keys](https://dev-dashboard.floelabs.xyz/keys)
2. Click **Create Key**, label it, pick `read` or `read_write` permissions
3. Copy the `floe_live_<base62>` key shown once

Developer keys span the whole developer account and have a separate rate limit (100 req/min). Agent-runtime tools (`get_credit_remaining`, `get_spend_limit`, `x402_pay`, etc) return 401 with a developer key because the caller is the developer, not a single agent — the error's `next` hint says so and points at `create_agent_key`. See the [API Keys docs](https://floe-labs.gitbook.io/docs/developers/api-keys) for the full taxonomy.

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
| `FLOE_API_KEY` | No (keyless tier without it) | — | Your Floe API key: `floe_<64-hex>` agent key for runtime/spend tools, `floe_live_<base62>` developer key for lifecycle tools. Identity source in stdio mode; ignored for HTTP requests, which authenticate per-request via `Authorization: Bearer` |
| `FLOE_API_BASE_URL` | No | `https://credit-api.floelabs.xyz` | API endpoint |
| `MCP_PORT` | No | `3100` | HTTP server port (non-stdio mode) |
| `MCP_HOST` | No | `127.0.0.1` | HTTP bind address; set `0.0.0.0` to expose beyond loopback |
| `MCP_TRUSTED_ORIGINS` | No | — | Comma-separated extra origins allowed by CORS in HTTP mode |

---

## Tools (65)

Below the tools are listed by request type. The summary is in [Tools at a glance](#tools-at-a-glance) above.
Every description also names the key it needs: **agent key** (`floe_...`), **developer key**
(`floe_live_...`), any key, or none. The feature-group tag in each heading is what
`?features=` filters on.

### Payment execution (`payments`, `pricing`) ⭐

The reason the rest exists: estimate → forecast → **pay**. `x402_pay` needs an agent key; `check_x402_url` is keyless.

| Tool | Description |
|------|-------------|
| `x402_pay` | Execute a paid x402 call through the Floe proxy — pays the vendor in USDC from the agent's balance/credit, returns the vendor response + `X-Floe-*` metering headers. `idempotency_key` makes retries replay instead of double-paying |
| `x402_forecast` | Batch cost forecast + policy preflight for up to 50 planned calls (with repeat counts) — one round-trip to validate a whole plan |
| `estimate_x402_cost` | Preflight one x402 URL — returns cost + reflection against your credit, no payment |
| `check_x402_url` | Keyless probe: is this URL x402-protected, and what does it cost? |

### Agent lifecycle (`lifecycle`) — developer key

Bootstrap and manage the fleet without touching the dashboard.

| Tool | Description |
|------|-------------|
| `create_agent` | Provision a managed agent: Privy wallet + sponsored on-chain delegation + the $3 welcome credit on the account's first agent (once per account, immediately spendable) |
| `list_agents` | List every agent on the account with status and limits |
| `get_agent` | One agent's detail: status, deposit address, credit used, 24h activity |
| `pause_agent` | Suspend an agent (kill-switch) — its keys fail auth until resumed |
| `resume_agent` | Reactivate a paused agent |
| `close_agent` | Irreversibly wind an agent down: repay loans, sweep funds, disable keys |
| `create_agent_key` | Mint a `floe_...` agent key (plaintext once), optionally with a rolling spend budget |
| `rotate_agent_key` | Atomically revoke + re-mint a key (new plaintext once) |
| `revoke_agent_key` | Delete a key — calls using it fail immediately |
| `set_agent_key_budget` | Set/update a fail-closed rolling budget on one key |
| `open_credit_line` | Upgrade a pay-as-you-go agent to a managed credit line (collateral from its wallet) |
| `get_credit_line_bounds` | Preview valid deposit/LTV ranges before `open_credit_line` |

### Funding & observability (`observability`) — developer key

| Tool | Description |
|------|-------------|
| `get_funding_instructions` | Machine-readable "how to fund this agent": USDC deposit address, chain 8453, minimums/warnings |
| `get_balances` | Aggregate USDC across developer wallet, agent wallets, and API credits |
| `get_activity` | Unified activity feed (proxy calls, onramps, transfers, loans) with filters + cursor pagination |
| `get_usage_summary` | Spend/usage analytics rollup: KPIs, daily series, top endpoints |

### Webhooks (`webhooks`) — developer key

| Tool | Description |
|------|-------------|
| `create_webhook` | Register an endpoint for account events (signing secret shown once) |
| `list_webhooks` | List registered webhooks (secrets never returned) |
| `test_webhook` | Send a signed test delivery to verify connectivity end-to-end |

### Docs (`docs`) — keyless

| Tool | Description |
|------|-------------|
| `search_floe_docs` | Search the Floe documentation index (llms.txt) — titles, URLs, descriptions |

### Read tools (`lending`)

| Tool | Description |
|------|-------------|
| `get_markets` | List active lending markets with rates and liquidity (keyless) |
| `get_open_lend_intents` | Browse lend offers available for borrowing against |
| `get_open_borrow_intents` | Browse borrow requests from borrowers seeking lenders |
| `get_intent_details` | Get full details of a specific intent by hash |
| `get_loan` | Get loan details by numeric ID |
| `get_user_loans` | Get all loans for a wallet (borrower + lender) |
| `get_loan_health` | Check loan LTV, health status, liquidation risk |
| `get_token_price` | Current oracle price for collateral tokens |
| `get_wallet_balance` | Token balances for a wallet |
| `get_accrued_interest` | Interest accrued on a loan |

### Write tools (`lending`, return unsigned transactions)

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

### Analysis tools (`lending`)

| Tool | Description |
|------|-------------|
| `check_compatibility` | Check if two intents can match |
| `calculate_risk` | Risk metrics: LTV, liquidation price, buffer |
| `estimate_interest` | Interest estimate for given loan terms |

### Utility tools (`lending`)

| Tool | Description |
|------|-------------|
| `simulate_transaction` | Dry-run a transaction (eth_call) |
| `broadcast_transaction` | Submit a signed transaction |
| `get_transaction_status` | Check transaction receipt |

### Agent-awareness tools (`spend`) ⭐

Lets an agent answer "do I have credit?", "is this call worth it?", and "where am I in the loan lifecycle?" before committing capital. All require an agent API key (`floe_*`). The calling identity is taken from the Bearer header in HTTP mode, or from `FLOE_API_KEY` in stdio mode.

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
| `get_agent_reputation` | 0–100 credit score, band, and collateral multiplier for the calling agent |

### Merchant-allowlist tools (`spend`)

Opt-in, default-deny restriction on **which destinations** the agent may pay. An allowlist entry is an ordinary capped policy row that doubles as "allowed AND capped". Default mode `off` = allow any vendor (zero onboarding friction). All require an agent API key (`floe_*`).

| Tool | Description |
|------|-------------|
| `set_allowlist_mode` | Set enforcement: `off` \| `host` (block unlisted hosts pre-fetch) \| `vendor` (block unlisted payees pre-sign) \| `both` |
| `get_allowlist_mode` | Read the agent's current enforcement mode |
| `add_allowlist_entry` | Add an allowed-AND-capped entry — `kind=api` (host) or `kind=vendor` (payee), with a `limit_raw` spend cap |
| `remove_allowlist_entry` | Revoke an allowlist entry by policy id (from `list_allowlist`) |
| `list_allowlist` | List host (`api`) and payee (`vendor`) allowlist entries with their caps |

### Inference gateway tools (`pricing`)

| Tool | Description |
|------|-------------|
| `list_models` | OpenAI-compatible model catalog for Floe Inference (text/embedding/TTS/STT/realtime) |
| `estimate_inference_cost` | Price an inference call from a usage vector without making it |

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
