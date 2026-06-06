---
name: floe-budget
description: >-
  Spend Floe credit well. Use this when an agent makes paid x402 API calls
  through the Floe MCP server and needs to stay inside its credit line and
  session spend cap — read budget status before paying, taper as it nears the
  tightest cap, replan to finish the task on budget, and stop before the ceiling.
license: MIT
metadata:
  version: 0.1.0
  author: Floe Labs
  homepage: https://floelabs.xyz
  requires:
    mcp-server: "@floelabs/mcp-server"
    tools:
      - get_credit_remaining
      - get_spend_limit
      - estimate_x402_cost
      - get_loan_state
---

# floe-budget

A spend playbook for any Claude-native agent (Claude Code, the Agent SDK,
claude.ai, or any MCP client) that pays for x402 APIs through the Floe MCP
server. It teaches the agent to **read its budget, taper near the cap, replan,
and stop** — so a runaway loop dies at a dollar instead of draining the credit
line.

## The one thing to remember

This skill is a **soft signal**. It helps a well-behaved agent spend
deliberately. It is **not** the protection. The real ceiling is enforced
**server-side** by Floe — the on-chain credit line and the session spend cap
refuse calls past the limit no matter what the agent decides. Do not rely on
self-restraint for safety; rely on it for *good judgement under a hard cap that
already exists*. (See "What actually protects you" below.)

## When to use this skill

Use it whenever you are about to spend, or are in a loop that spends:

- Before any paid call (anything routed through the Floe x402 proxy).
- Inside any multi-step or iterative task that calls paid APIs repeatedly.
- Whenever a tool response carries an `X-Floe-Budget-Advisory` header.

## How to read budget status

You have two sources. Use whichever is available; they agree.

### 1. The MCP tools (pull — ask any time)

| Tool | Tells you |
|---|---|
| `get_credit_remaining` | `available` (spendable USDC right now — what the proxy gates on), `headroomToAutoBorrow` (extra you could draw from the credit line), `utilizationBps` (how full the line is, 10000 = 100%). |
| `get_spend_limit` | The active session spend cap, if any (`{ active: false }` when none). |
| `estimate_x402_cost` | The USDC cost of a specific URL **and** how it reflects against your `available` credit and session cap — call this *before* paying. |
| `get_loan_state` | Coarse lifecycle: `idle \| borrowing \| at_limit \| repaying`. Do not spend while `at_limit`. |

Gate on `available`, not `headroomToAutoBorrow`. Having borrowing headroom does
not mean you have spendable USDC right now.

### 2. The advisory header (push — arrives on paid responses)

Every response from the Floe x402 proxy can carry an `X-Floe-Budget-Advisory`
header describing the **tightest** cap you are approaching across *all* scopes
(credit line, session, per-vendor, per-task). Read it after each paid call.
Field reference is in [reference.md](reference.md); the fields you act on:

- `near_limit` — `true` once you cross the warning threshold on the tightest cap.
- `tightest.scope` — which cap is closest (`credit_line`, `session`, `vendor`, `api`, `task`).
- `tightest.used_bps` — how full that cap is (10000 = 100%).
- `tightest.remaining_raw` — raw USDC (6 decimals) left on that cap.
- `tightest.window_kind` / `tightest.window_resets_at` — whether the cap rolls over, and when.

## The decision rule

Translate the tightest cap into one of three modes. Use `used_bps` (from the
header) or `utilization` derived from the tools (`available` vs. the relevant
cap). Thresholds are defaults — defer to any `near_limit` flag the server sends.

1. **Spend (under ~80% / `used_bps < 8000`, `near_limit` false)**
   Proceed normally. Still call `estimate_x402_cost` before large or repeated
   paid calls.

2. **Taper (~80–95% / `used_bps` 8000–9500, or `near_limit` true)**
   You are close. Tighten up:
   - Stop speculative or "nice to have" calls. Spend only on what the task needs.
   - Prefer one consolidated call over several small ones; widen page sizes,
     batch lookups, drop redundant retries.
   - Re-estimate every paid call with `estimate_x402_cost` and skip any whose
     cost exceeds `tightest.remaining_raw`.
   - If the cap has a reset window (`window_resets_at`) and the work is not
     urgent, consider deferring non-critical calls until after the reset.

3. **Stop (≥ ~95% / `used_bps >= 9500`, or `remaining_raw` < next call's cost, or `get_loan_state` = `at_limit`)**
   Do not attempt more paid calls. Finalize with what you have, report the
   budget state to the user, and ask before requesting more credit. Attempting
   the call anyway will simply be refused server-side — stopping cleanly is
   better than a failed call mid-task.

## Replanning to finish on budget

When you hit **Taper** mid-task, do not just keep going slower — replan so the
task *completes* within `tightest.remaining_raw`:

1. List the remaining paid steps and `estimate_x402_cost` for each.
2. Sum them. If the sum exceeds `remaining_raw`, cut or merge steps until it
   fits — drop the lowest-value calls first.
3. If no plan fits, deliver the best partial result now and tell the user
   exactly what was skipped and why (cite the cap and remaining budget).

Never silently burn the whole budget on early steps and strand the task before
the goal.

## What actually protects you (read this)

The hard ceiling is **server-side and on-chain**, independent of this skill:

- The **credit line** (on-chain operator delegation: `borrowLimit`, `maxRateBps`,
  `expiry`) and the **session spend cap** (`get_spend_limit` / `set_spend_limit`)
  are enforced by the Floe facilitator. Calls past them are **refused** — the
  agent cannot spend through them by ignoring this skill.
- If a developer has configured a **merchant allowlist**, payments to
  non-allowlisted hosts or payees are blocked before signing.

So: this skill makes a cooperative agent spend *wisely*; the server makes *every*
agent spend *safely*. If you ever find the advisory and the tools disagree with a
refused call, trust the refusal — the server is authoritative.
