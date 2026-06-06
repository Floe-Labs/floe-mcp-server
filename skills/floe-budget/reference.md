# Reference: `X-Floe-Budget-Advisory` header

A read-only advisory the Floe x402 proxy stamps on responses (and that the
`estimate_x402_cost` MCP tool reflects). It is computed from numbers the
enforcement path already has — **no extra query, and no new backend**. It tells
you how close you are to the **tightest** cap across every scope that applies to
the call.

It is a **soft signal**. The hard ceiling is the server-side credit line,
session cap, and (if configured) merchant allowlist. See `SKILL.md` →
"What actually protects you".

## Shape

The header value is JSON:

```json
{
  "near_limit": false,
  "tightest": {
    "scope": "credit_line",
    "match": null,
    "used_bps": 6200,
    "remaining_raw": "3800000",
    "window_kind": "rolling",
    "window_resets_at": null
  }
}
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `near_limit` | boolean | `true` once `used_bps` crosses the warning threshold on the tightest cap. For `credit_line` the threshold is the operator's registered credit-utilization `thresholdBps` (omitted when no threshold subscription exists). For policy scopes it is raw-only for now. Treat `true` as "enter Taper mode". |
| `tightest.scope` | string | Which cap is closest: `credit_line`, `session`, `vendor`, `api`, or `task`. `credit_line` is the backstop and is always present, so `tightest` is never null. |
| `tightest.match` | string \| null | For `vendor`/`api`/`task` scopes, the matched key (e.g. the host or payee). `null` for `credit_line` / `session`. |
| `tightest.used_bps` | number | How full the tightest cap is, in basis points (10000 = 100%). Primary input to the Spend/Taper/Stop decision. |
| `tightest.remaining_raw` | string | Raw USDC left on the tightest cap (6 decimals — `"3800000"` = 3.80 USDC). Compare a call's estimated cost against this before paying. |
| `tightest.window_kind` | string | Cap window type, e.g. `rolling`, `fixed`, or `none`. Tells you whether the cap refills. |
| `tightest.window_resets_at` | string \| null | ISO-8601 timestamp when the window resets, or `null` for non-windowed caps. If non-urgent work is blocked, defer it until after this time. |

> Raw units are USDC at 6 decimals. Divide by 1,000,000 for a dollar figure:
> `remaining_raw = "3800000"` → **$3.80**.

## Scope precedence

`tightest` is the cap with the least proportional headroom — i.e.
`min(remaining / limit)` across all caps that apply to the call. So the scope can
change call to call: early in a task `credit_line` may be tightest; once a
per-vendor cap fills, `vendor` becomes tightest even though the credit line has
room. Always act on whatever `tightest.scope` currently reports, not on the
credit line alone.

## Mapping to MCP tools

When you cannot see response headers (e.g. you are reasoning before a call, or
your client hides them), reconstruct the same picture from tools:

| Advisory field | Closest tool source |
|---|---|
| credit-line `used_bps` / `remaining_raw` | `get_credit_remaining` → `utilizationBps`, `available` |
| session cap | `get_spend_limit` |
| per-call affordability vs. caps | `estimate_x402_cost` (reflects cost against `available` + session cap) |
| lifecycle gate | `get_loan_state` (`at_limit` ⇒ stop) |

The tools and the advisory agree; the advisory is just the tightest of them,
pre-computed, in one place.
