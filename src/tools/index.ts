import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiError, type FloeApiClient } from '../client.js';
import { searchFloeDocs } from '../docs.js';
import { textResult, errorResult } from '../types/responses.js';

const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
// Agent ids are numeric row ids (from create_agent / list_agents); the
// backend's resolveOwnedAgent rejects anything non-digit with a 400.
const agentId = z.string().regex(/^\d+$/);
// GET /v1/developer/activity validates ?type= against this exact list
// (routes/developer/activity.ts ALL_EVENT_TYPES) and 400s on anything else.
const ACTIVITY_EVENT_TYPE = z.enum([
  'x402_call',
  'onramp_purchase',
  'onramp_sweep',
  'transfer_deposit',
  'transfer_withdrawal',
  'transfer_external',
  'facility_loan_match',
  'facility_loan_repay',
  'facility_loan_rollover',
  'facility_loan_failed',
]);

// Capability groups for the `?features=a,b` scope param on the remote URL
// (Supabase/Neon pattern). Every tool belongs to exactly one group; an
// unknown feature name simply matches nothing.
export const FEATURE_GROUPS = [
  'lending',        // intent-based lending protocol: reads, unsigned-tx writes, analysis, tx utility
  'spend',          // agent awareness / spend governance / allowlist / reputation
  'pricing',        // cost preflights: x402 estimate/forecast/check + inference pricing
  'lifecycle',      // developer-side agent + key + credit-line management
  'observability',  // funding instructions, balances, activity, usage rollups
  'payments',       // x402_pay — the actual paid call
  'webhooks',       // developer webhook CRUD/test
  'docs',           // search_floe_docs
] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

// Which credential a tool needs. 'none' = works keyless (public backend
// route or no backend at all); 'any' = any authenticated principal;
// 'agent' = agent key (floe_*) only; 'dev' = developer key (floe_live_*).
export type KeyNeed = 'none' | 'any' | 'agent' | 'dev';

export interface ToolFilter {
  /** Register only non-mutating tools (`?read_only=true`). */
  readOnly?: boolean;
  /** Register only these capability groups (`?features=spend,pricing`). */
  features?: string[];
}

interface ToolMeta {
  group: FeatureGroup;
  access: 'read' | 'write';
  key: KeyNeed;
}

// Appended to every tool description so an agent knows which key unlocks
// the tool BEFORE calling it (and which error to expect if it guesses).
const KEY_HINT: Record<KeyNeed, string> = {
  none: 'No API key required.',
  any: 'Requires any Floe API key (agent floe_... or developer floe_live_...).',
  agent: 'Requires an agent key (floe_...).',
  dev: 'Requires a developer key (floe_live_...).',
};

const GET_KEY_NEXT =
  'Get a developer key at https://dev-dashboard.floelabs.xyz, then mint agent keys with create_agent_key. ' +
  'Keyless sessions can still use get_markets, check_x402_url, and search_floe_docs.';

// 401/403 remediation: the single most common failure is the WRONG KEY
// TYPE (dev key on an agent tool or vice versa), which the backend reports
// as a bare 401. Distinguish it from missing/revoked keys using the key
// prefix so the agent's next step is obvious.
function remediationFor(status: number, need: KeyNeed, kind: FloeApiClient['keyKind']): string | undefined {
  if (status !== 401 && status !== 403) return undefined;
  if (need === 'agent' && kind === 'dev') {
    return 'Wrong key type: this tool needs an agent key (floe_...) but the session used a developer key ' +
      '(floe_live_...). Mint one with create_agent_key or at https://dev-dashboard.floelabs.xyz.';
  }
  if (need === 'dev' && kind === 'agent') {
    return 'Wrong key type: this tool needs a developer key (floe_live_...) but the session used an agent key ' +
      '(floe_...). Create one at https://dev-dashboard.floelabs.xyz/keys.';
  }
  return 'Key was rejected: it may be invalid, revoked, or missing the required role. ' +
    'Check your keys at https://dev-dashboard.floelabs.xyz.';
}

// Thrown by tool handlers for local cross-field validation failures —
// turned into an INVALID_ARGUMENT error result before any HTTP round-trip.
class ToolInputError extends Error {}

// FLO-579: behavioral capture. Wrap server.tool ONCE so every tool registered
// below is timed and its outcome (name + durationMs + ok/error — never
// arguments or results) is fire-and-forgotten to the Floe API. Tool latency
// and output are unchanged: logging is void-fired in `finally`. Capturing only
// name+timing+ok structurally guarantees no chain-of-thought leaves the agent.
function instrumentToolCalls(server: McpServer, client: FloeApiClient): void {
  const original = (server.tool as (...args: any[]) => any).bind(server);
  (server as unknown as { tool: (...args: any[]) => any }).tool = (...args: any[]) => {
    const name = typeof args[0] === 'string' ? args[0] : 'unknown';
    const handler = args[args.length - 1];
    if (typeof handler === 'function') {
      args[args.length - 1] = async (...handlerArgs: any[]) => {
        const t0 = Date.now();
        let ok = true;
        let errorCode: string | undefined;
        try {
          const result = await handler(...handlerArgs);
          if (result && typeof result === 'object' && (result as { isError?: boolean }).isError) {
            ok = false;
            errorCode = extractErrorCode(result);
          }
          return result;
        } catch (e: any) {
          ok = false;
          errorCode = e?.code ?? 'ERROR';
          throw e;
        } finally {
          // Keyless sessions have no identity to attribute telemetry to —
          // skip the round-trip instead of collecting guaranteed 401s.
          if (client.hasKey) {
            void client
              .logToolCall({ tool: name, durationMs: Date.now() - t0, ok, errorCode })
              .catch(() => {});
          }
        }
      };
    }
    return original(...args);
  };
}

function extractErrorCode(result: unknown): string | undefined {
  try {
    const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    if (!text) return undefined;
    const parsed = JSON.parse(text) as { error?: string };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

export function registerAllTools(server: McpServer, client: FloeApiClient, opts: ToolFilter = {}) {
  // Instrument tool-call telemetry before any tool is registered.
  instrumentToolCalls(server, client);

  // Registration gate. Each tool declares its capability group, whether it
  // mutates anything, and which key it needs. The gate:
  //   - skips registration when the read_only / features scope excludes it,
  //   - appends the key requirement to the description (agents read this),
  //   - short-circuits key-gated tools with a structured AUTH_REQUIRED
  //     error when the session is keyless,
  //   - shapes every failure as { error, status, message, next? } so the
  //     HTTP status survives into the tool result (agents can distinguish
  //     401/403/404/429) and 401/403 carry a remediation hint.
  const tool = (
    name: string,
    meta: ToolMeta,
    description: string,
    schema: z.ZodRawShape,
    fn: (args: any) => Promise<unknown> | unknown,
  ) => {
    if (opts.readOnly && meta.access === 'write') return;
    if (opts.features && opts.features.length > 0 && !opts.features.includes(meta.group)) return;
    server.tool(name, `${description} ${KEY_HINT[meta.key]}`, schema, async (args: any) => {
      if (meta.key !== 'none' && !client.hasKey) {
        return errorResult('AUTH_REQUIRED', {
          status: 401,
          message: `${name} was called without an API key. ${KEY_HINT[meta.key]}`,
          next: GET_KEY_NEXT,
        });
      }
      try {
        const out = await fn(args ?? {});
        // Ack-only backend routes (204 / empty body) resolve undefined;
        // JSON.stringify(undefined) would emit a text-less content item.
        return textResult(out === undefined ? { ok: true } : out);
      } catch (e: any) {
        if (e instanceof ToolInputError) {
          return errorResult('INVALID_ARGUMENT', { status: 400, message: e.message });
        }
        if (e instanceof ApiError) {
          const details: Record<string, unknown> = { status: e.status, message: e.message };
          const next = remediationFor(e.status, meta.key, client.keyKind);
          if (next) details.next = next;
          return errorResult(e.code, details);
        }
        return errorResult(e?.code ?? 'ERROR', { status: 500, message: e?.message });
      }
    });
  };

  // ═══════════════════════════════════════════════════════════════════
  // READ TOOLS (10)
  // ═══════════════════════════════════════════════════════════════════

  tool('get_markets', { group: 'lending', access: 'read', key: 'none' },
    'List all active lending markets with current rates and liquidity.', {},
    () => client.getMarkets());

  tool('get_open_lend_intents', { group: 'lending', access: 'read', key: 'any' },
    'Browse open lend offers available for borrowing against.', {
      limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
      skip: z.number().int().min(0).default(0).describe('Skip count'),
    }, ({ limit, skip }) => client.getIntents({ type: 'lend', limit, skip }));

  tool('get_open_borrow_intents', { group: 'lending', access: 'read', key: 'any' },
    'Browse open borrow requests. Use create_counter_intent to lend against one.', {
      limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
      skip: z.number().int().min(0).default(0).describe('Skip count'),
    }, ({ limit, skip }) => client.getIntents({ type: 'borrow', limit, skip }));

  tool('get_intent_details', { group: 'lending', access: 'read', key: 'any' },
    'Get full details of a specific intent by its offer hash.', {
      offer_hash: z.string().describe('Intent offer hash (bytes32 hex)'),
    }, ({ offer_hash }) => client.getIntentByHash(offer_hash));

  tool('get_loan', { group: 'lending', access: 'read', key: 'any' },
    'Get details of a specific loan by its numeric ID.', {
      loan_id: z.string().describe('Numeric loan ID'),
    }, ({ loan_id }) => client.getLoanById(loan_id));

  tool('get_user_loans', { group: 'lending', access: 'read', key: 'any' },
    'Get all loans for a wallet address, both as borrower and lender.', {
      wallet_address: addr.describe('Wallet address'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
    }, ({ wallet_address, limit }) => client.getLoans({ wallet: wallet_address, limit }));

  tool('get_loan_health', { group: 'lending', access: 'read', key: 'any' },
    'Check loan health: LTV, liquidation risk, accrued interest, early repayment terms.', {
      loan_id: z.string().describe('Numeric loan ID'),
    }, ({ loan_id }) => client.getLoanHealth(loan_id));

  tool('get_token_price', { group: 'lending', access: 'read', key: 'any' },
    'Get current oracle price for collateral token.', {
      market_id: z.string().optional().describe('Market ID (bytes32). If omitted, the backend uses its configured default market (USDC/USDC on Base Mainnet).'),
    }, ({ market_id }) => client.getPrice(market_id));

  tool('get_wallet_balance', { group: 'lending', access: 'read', key: 'any' },
    'Check token balances for a wallet.', {
      wallet_address: addr.describe('Wallet address'),
      token_symbol: z.string().optional().describe('Token symbol (e.g. "USDC"). Omit for all.'),
    }, ({ wallet_address, token_symbol }) => client.getBalance(wallet_address, token_symbol));

  tool('get_accrued_interest', { group: 'lending', access: 'read', key: 'any' },
    'Get accrued interest and full credit status for a loan.', {
      loan_id: z.string().describe('Numeric loan ID'),
    }, ({ loan_id }) => client.getCreditStatus(loan_id));

  // ═══════════════════════════════════════════════════════════════════
  // WRITE TOOLS (9) — return unsigned transactions
  // ═══════════════════════════════════════════════════════════════════

  tool('create_lend_intent', { group: 'lending', access: 'write', key: 'any' },
    'Build unsigned tx to create a lending offer. Solver matches it with borrowers.', {
      wallet_address: addr.describe('Lender wallet'),
      amount: z.string().describe('Amount in raw token units'),
      min_interest_rate_bps: z.number().int().min(1).max(10000).describe('Min annual rate in bps (500 = 5%)'),
      max_ltv_bps: z.number().int().min(1000).max(9950).describe('Max LTV in bps (the liquidation threshold on the resulting loan). Volatile-collateral markets (USDC/WETH, USDC/cbBTC) cap at 9500 (95%). Same-token markets (e.g. USDC/USDC) cap at 9950 (99.5%) — values above 9500 are the aggressive opt-in, only safe for short-duration loans because the interest-accrual headroom shrinks.'),
      min_duration_days: z.number().int().min(1).describe('Min duration in days'),
      max_duration_days: z.number().int().min(1).describe('Max duration in days'),
      market_id: z.string().optional().describe('Market ID (bytes32). Omit to use the USDC/USDC same-token market on Base Mainnet — the recommended default for AI agents (no price risk, only interest-accrual liquidation).'),
    }, (params) => {
      if (params.min_duration_days > params.max_duration_days) {
        throw new ToolInputError('min_duration_days must be <= max_duration_days');
      }
      return client.createLendIntent(params);
    });

  tool('create_borrow_intent', { group: 'lending', access: 'write', key: 'any' },
    'Build unsigned tx to create a borrow request. Solver matches it with lenders.', {
      wallet_address: addr.describe('Borrower wallet'),
      borrow_amount: z.string().describe('Amount to borrow in raw token units'),
      collateral_amount: z.string().describe('Collateral in raw token units'),
      max_interest_rate_bps: z.number().int().min(1).max(10000).describe('Max annual rate in bps'),
      min_duration_days: z.number().int().min(1).describe('Min duration in days'),
      max_duration_days: z.number().int().min(1).describe('Max duration in days'),
      min_ltv_bps: z.number().int().optional().default(8000).describe('Min LTV in bps (default 8000 = 80%). For agents pushing the USDC/USDC market to 99% LTV, pass 9900. Same-token markets need only a 50bps gap to the lender\'s max_ltv_bps; volatile markets need 800bps.'),
      market_id: z.string().optional().describe('Market ID (bytes32). Omit to use the USDC/USDC same-token market on Base Mainnet — the recommended default for AI agents (no price risk, only interest-accrual liquidation).'),
    }, (params) => {
      if (params.min_duration_days > params.max_duration_days) {
        throw new ToolInputError('min_duration_days must be <= max_duration_days');
      }
      return client.createBorrowIntent(params);
    });

  tool('create_counter_intent', { group: 'lending', access: 'write', key: 'any' },
    'Create a counter-intent against an existing offer. Primary way to accept offers. Solver auto-matches.', {
      offer_hash: z.string().describe('Source intent offer hash'),
      wallet_address: addr.describe('Your wallet address'),
    }, (params) => client.createCounterIntent(params));

  tool('repay_loan', { group: 'lending', access: 'write', key: 'any' },
    'Build unsigned tx to repay a loan with auto-approval and slippage protection.', {
      wallet_address: addr.describe('Borrower wallet'),
      loan_id: z.string().describe('Loan ID'),
      slippage_bps: z.number().int().optional().default(500).describe('Slippage tolerance (500 = 5%)'),
    }, (params) => client.repayLoan(params));

  tool('add_collateral', { group: 'lending', access: 'write', key: 'any' },
    'Build unsigned tx to add collateral to a loan.', {
      wallet_address: addr.describe('Wallet adding collateral'),
      loan_id: z.string().describe('Loan ID'),
      amount: z.string().describe('Collateral amount in raw token units'),
      market_id: z.string().optional().describe('Market ID'),
    }, (params) => client.addCollateral(params));

  tool('withdraw_collateral', { group: 'lending', access: 'write', key: 'any' },
    'Build unsigned tx to withdraw excess collateral.', {
      loan_id: z.string().describe('Loan ID'),
      amount: z.string().describe('Amount to withdraw'),
    }, (params) => client.withdrawCollateral(params));

  tool('liquidate_loan', { group: 'lending', access: 'write', key: 'any' },
    'Build unsigned tx to liquidate an unhealthy loan.', {
      wallet_address: addr.describe('Liquidator wallet'),
      loan_id: z.string().describe('Loan ID'),
      max_repayment: z.string().describe('Max amount willing to pay'),
      market_id: z.string().optional().describe('Market ID'),
    }, (params) => client.liquidateLoan(params));

  tool('revoke_intent', { group: 'lending', access: 'write', key: 'any' },
    'Build unsigned tx to cancel an active intent.', {
      offer_hash: z.string().describe('Intent offer hash'),
      side: z.enum(['lend', 'borrow']).describe('Intent side'),
    }, (params) => client.revokeIntent(params));

  tool('approve_token', { group: 'lending', access: 'write', key: 'any' },
    'Build unsigned tx to approve a token for Floe protocol.', {
      token_address: addr.describe('Token contract address'),
      amount: z.string().describe('Amount to approve in raw units'),
    }, (params) => client.approveToken(params));

  // ═══════════════════════════════════════════════════════════════════
  // ANALYSIS TOOLS (3)
  // ═══════════════════════════════════════════════════════════════════

  tool('check_compatibility', { group: 'lending', access: 'read', key: 'any' },
    'Check if two intents can match.', {
      lend_offer_hash: z.string().describe('Lend intent hash'),
      borrow_offer_hash: z.string().describe('Borrow intent hash'),
    }, (params) => client.checkCompatibility(params));

  tool('calculate_risk', { group: 'lending', access: 'read', key: 'any' },
    'Calculate risk metrics for a potential loan position.', {
      borrow_amount: z.number().positive().describe('Borrow amount in human units'),
      collateral_amount: z.number().positive().describe('Collateral in human units'),
      interest_rate_percent: z.number().min(0).max(100).describe('Annual rate %'),
      duration_days: z.number().int().min(1).describe('Duration in days'),
      liquidation_ltv_percent: z.number().optional().default(88).describe('Liquidation threshold %'),
    }, (params) => client.calculateRisk(params));

  tool('estimate_interest', { group: 'lending', access: 'read', key: 'any' },
    'Estimate total interest for given loan terms.', {
      principal: z.number().positive().describe('Loan principal in human units'),
      interest_rate_bps: z.number().int().min(1).max(10000).describe('Annual rate in bps'),
      duration_days: z.number().int().min(1).describe('Duration in days'),
    }, (params) => client.estimateInterest(params));

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY TOOLS (3)
  // ═══════════════════════════════════════════════════════════════════

  tool('simulate_transaction', { group: 'lending', access: 'read', key: 'any' },
    'Dry-run an unsigned tx. Returns success/revert and gas estimate.', {
      from: addr.describe('Signing address (msg.sender)'),
      to: addr.describe('Contract address'),
      data: z.string().describe('Encoded calldata (0x hex)'),
      value: z.string().optional().default('0x0').describe('ETH value in hex'),
    }, (params) => client.simulateTransaction(params));

  tool('broadcast_transaction', { group: 'lending', access: 'write', key: 'any' },
    'Submit a signed transaction to Base Mainnet.', {
      signed_transaction_hex: z.string().describe('Signed tx as 0x RLP hex'),
    }, (params) => client.broadcastTransaction(params));

  tool('get_transaction_status', { group: 'lending', access: 'read', key: 'any' },
    'Check status of a submitted transaction.', {
      transaction_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).describe('Transaction hash'),
    }, ({ transaction_hash }) => client.getTxStatus(transaction_hash));

  // ═══════════════════════════════════════════════════════════════════
  // AGENT AWARENESS TOOLS (8) — let an agent reason about its own
  // credit before committing capital. Decide → estimate → check → act.
  // All require an agent API key (`floe_*`); the calling identity is
  // taken from the bearer token, so none of these tools need a wallet
  // address parameter.
  // ═══════════════════════════════════════════════════════════════════

  tool('get_credit_remaining', { group: 'spend', access: 'read', key: 'agent' },
    'Return how much USDC credit the calling agent has left. Use BEFORE deciding whether to make a paid call. ' +
    'Two distinct numbers: `available` (= spendable USDC right now — what the proxy actually gates on) and ' +
    '`headroomToAutoBorrow` (= operator-delegation borrowing capacity — how much MORE the agent could draw from its credit line). ' +
    'These differ when the agent has delegation capacity but no facility loan opened yet: ' +
    'headroomToAutoBorrow > 0 does NOT imply available > 0. Use `available` for the spend gate.',
    {},
    () => client.getCreditRemaining());

  tool('get_loan_state', { group: 'spend', access: 'read', key: 'agent' },
    'Return the agent\'s coarse credit state-machine view: idle | borrowing | at_limit | repaying. Use to gate actions that only make sense in specific states (e.g. don\'t spend while at_limit).',
    {},
    () => client.getLoanState());

  tool('get_spend_limit', { group: 'spend', access: 'read', key: 'agent' },
    'Return the agent\'s currently-active session spend cap, if any. Returns { active: false } when no cap is set.',
    {},
    () => client.getSpendLimit());

  tool('set_spend_limit', { group: 'spend', access: 'write', key: 'agent' },
    'Set or update the agent\'s session spend cap (USDC raw, 6 decimals). Resets the session window — anything spent before this call no longer counts. Operator-defined; distinct from the on-chain creditLimit.',
    {
      limit_raw: z.string().regex(/^[1-9]\d*$/).describe('Cap in raw USDC units (6 decimals), positive. e.g. "1000000" = $1.'),
    },
    ({ limit_raw }) => client.setSpendLimit({ limitRaw: limit_raw }));

  tool('clear_spend_limit', { group: 'spend', access: 'write', key: 'agent' },
    'Remove the agent\'s session spend cap. Subsequent paid calls will only be bounded by the on-chain creditLimit.',
    {},
    async () => {
      await client.clearSpendLimit();
      return { ok: true };
    });

  tool('list_credit_thresholds', { group: 'spend', access: 'read', key: 'agent' },
    'List the agent\'s registered credit-utilization thresholds. Each fires a credit.warning / credit.at_limit / credit.recovered webhook when crossed.',
    {},
    () => client.listCreditThresholds());

  tool('register_credit_threshold', { group: 'spend', access: 'write', key: 'agent' },
    'Register a new credit-utilization threshold. When utilizationBps crosses thresholdBps from below, the agent\'s webhook receives credit.warning (or credit.at_limit if >= 9500). Drops below → credit.recovered. Cap of 20 thresholds per agent.',
    {
      threshold_bps: z.number().int().min(1).max(10000).describe('Utilization threshold in bps (5000 = 50%, 9500 = 95% → at_limit).'),
      webhook_id: z.number().int().positive().optional().describe('Optional: pin to a specific webhook owned by this developer. Omit for fanout.'),
    },
    ({ threshold_bps, webhook_id }) =>
      client.registerCreditThreshold({ thresholdBps: threshold_bps, webhookId: webhook_id }));

  tool('delete_credit_threshold', { group: 'spend', access: 'write', key: 'agent' },
    'Delete one of the agent\'s credit-utilization thresholds by id (from list_credit_thresholds).',
    {
      id: z.number().int().positive().describe('Threshold subscription id.'),
    },
    async ({ id }) => {
      await client.deleteCreditThreshold(id);
      return { ok: true, id };
    });

  // ═══════════════════════════════════════════════════════════════════
  // PRICING / COST-PREFLIGHT TOOLS (5) — price a call BEFORE spending.
  // estimate_x402_cost + x402_forecast reflect against the calling
  // agent's credit; check_x402_url is the public probe; list_models +
  // estimate_inference_cost cover the FLO-602 keyless LLM/voice gateway.
  // ═══════════════════════════════════════════════════════════════════

  tool('estimate_x402_cost', { group: 'pricing', access: 'read', key: 'agent' },
    'Preflight an x402-protected URL and return its USDC cost without paying. Reflects against the calling agent\'s available credit and session spend-limit so you can decide gating in one round-trip. Use BEFORE x402_pay.',
    {
      url: z.string()
        .url()
        .refine((u) => /^https?:\/\//i.test(u), 'URL must use http:// or https://')
        .describe('Target URL to preflight.'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
        .optional()
        .describe('HTTP method (default GET).'),
    },
    ({ url, method }) => client.estimateX402Cost({ url, method }));

  tool('check_x402_url', { group: 'pricing', access: 'read', key: 'none' },
    'Check whether a URL is x402-protected and, if so, what it costs — without any credential. Public probe (IP rate-limited). Returns { x402: false, status } for plain URLs or the payment requirements for x402 ones. Use to vet a vendor before minting keys or funding.',
    {
      url: z.string()
        .url()
        .refine((u) => /^https?:\/\//i.test(u), 'URL must use http:// or https://')
        .describe('Target URL to probe.'),
    },
    ({ url }) => client.checkX402Url(url));

  tool('x402_forecast', { group: 'pricing', access: 'read', key: 'agent' },
    'Batch cost forecast + policy preflight for a PLAN of paid calls (FLO-545). Given up to 50 planned x402 calls (each with an optional repeat count), returns the aggregated USDC cost projection and a policyPreflight block listing which of the agent\'s policies would breach if the plan ran now. Read-only — nothing is paid or mutated. Use to validate a multi-step plan in one round-trip instead of estimating call-by-call.',
    {
      items: z.array(z.object({
        url: z.string().url().describe('Planned x402 URL.'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
          .optional().describe('HTTP method (default GET).'),
        count: z.number().int().positive().max(10_000).optional().describe('How many times the plan calls this URL (default 1).'),
        task_id: z.string().min(1).max(128).optional().describe('Optional task id for task-scoped policy preflight.'),
      })).min(1).max(50).describe('The planned paid calls.'),
    },
    ({ items }) => client.forecastX402({
      items: items.map((i: { url: string; method?: string; count?: number; task_id?: string }) => ({
        url: i.url, method: i.method, count: i.count, taskId: i.task_id,
      })),
    }));

  tool('list_models', { group: 'pricing', access: 'read', key: 'any' },
    'List the models available on Floe Inference — the keyless pay-as-you-go LLM/voice gateway. Returns OpenAI-compatible model objects (id like "openai/gpt-4o", modality: text | embedding | tts | stt | realtime, context_window). Use the id with the OpenAI-compatible /v1/chat/completions, /v1/embeddings, /v1/audio, or /v1/realtime endpoints, or price a call first with estimate_inference_cost.',
    {},
    () => client.listInferenceModels());

  tool('estimate_inference_cost', { group: 'pricing', access: 'read', key: 'any' },
    'Estimate the USDC cost of a Floe Inference call for a given model and usage vector, WITHOUT making the call or touching balance. Returns the cheapest priceable source: { rail, provider, margin_bps, upstream_cost_usdc, cost_usdc, cost_raw }. Provide only the units the model bills: text models use input_tokens/output_tokens (+cached_input_tokens); TTS uses characters; STT uses audio_seconds; realtime voice uses audio_input_tokens/audio_output_tokens. Use BEFORE inference to decide gating.',
    {
      model: z.string().min(1).max(128).describe('Model id from list_models, e.g. "openai/gpt-4o" or "elevenlabs/eleven-turbo-v2.5".'),
      input_tokens: z.number().int().nonnegative().optional().describe('Prompt tokens (text models).'),
      output_tokens: z.number().int().nonnegative().optional().describe('Completion tokens (text models).'),
      cached_input_tokens: z.number().int().nonnegative().optional().describe('Cached prompt tokens billed at the cached rate (text models).'),
      characters: z.number().int().nonnegative().optional().describe('Characters of input text (TTS models).'),
      audio_seconds: z.number().nonnegative().optional().describe('Seconds of audio, fractional allowed (STT models).'),
      audio_input_tokens: z.number().int().nonnegative().optional().describe('Input audio tokens (realtime voice).'),
      audio_output_tokens: z.number().int().nonnegative().optional().describe('Output audio tokens (realtime voice).'),
    },
    (args) => client.estimateInferenceCost(args));

  // ═══════════════════════════════════════════════════════════════════
  // MERCHANT ALLOWLIST TOOLS (5) — opt-in, default-deny restriction on
  // which destinations the agent may pay. An allowlist entry is an
  // ordinary capped policy row (kind='api' host, kind='vendor' payee).
  // Default mode 'off' = allow any vendor. All require an agent API key.
  // ═══════════════════════════════════════════════════════════════════

  tool('set_allowlist_mode', { group: 'spend', access: 'write', key: 'agent' },
    'Set the agent\'s merchant-allowlist enforcement mode. "off" (default) allows any vendor. "host" blocks unlisted hosts before the first fetch; "vendor" blocks unlisted payees before signing; "both" enforces both. Allowlist entries themselves are managed with add_allowlist_entry.',
    {
      mode: z.enum(['off', 'host', 'vendor', 'both']).describe('Enforcement mode: off | host | vendor | both.'),
    },
    ({ mode }) => client.setAllowlistMode({ mode }));

  tool('get_allowlist_mode', { group: 'spend', access: 'read', key: 'agent' },
    'Return the agent\'s current merchant-allowlist enforcement mode (off | host | vendor | both).',
    {},
    () => client.getAllowlistMode());

  tool('add_allowlist_entry', { group: 'spend', access: 'write', key: 'agent' },
    'Add a merchant-allowlist entry — an allowed-AND-capped policy row. Use kind="api" to allowlist a host (match_key = hostname) or kind="vendor" to allowlist a payee (match_key = recipient wallet). limit_raw caps spend against this entry (raw USDC, 6 decimals). Enforcement only kicks in once set_allowlist_mode is host/vendor/both.',
    {
      kind: z.enum(['api', 'vendor']).describe('"api" for a host entry (match_key = hostname) or "vendor" for a payee entry (match_key = recipient wallet address).'),
      match_key: z.string().min(1).max(255).describe('Host (for kind="api") or payee wallet address (for kind="vendor").'),
      limit_raw: z.string().regex(/^[1-9]\d*$/).describe('Spend cap in raw USDC units (6 decimals), positive. e.g. "1000000" = $1.'),
      match_kind: z.enum(['host_exact', 'host_suffix', 'recipient']).optional().describe('Optional matcher: host_exact | host_suffix (api) or recipient (vendor). Defaults server-side.'),
    },
    ({ kind, match_key, limit_raw, match_kind }) => {
      // Kind-aware cross-field validation: the flat enums above allow
      // incoherent combos (e.g. a vendor entry whose match_key is a
      // hostname, or an api entry asking for the 'recipient' matcher).
      // Reject those locally before the round-trip.
      if (kind === 'vendor') {
        if (!addr.safeParse(match_key).success) {
          throw new ToolInputError('kind="vendor" requires match_key to be a payee wallet address (0x + 40 hex).');
        }
        if (match_kind !== undefined && match_kind !== 'recipient') {
          throw new ToolInputError('kind="vendor" only supports match_kind="recipient".');
        }
      } else {
        // kind === 'api' (host entry)
        if (match_kind !== undefined && match_kind !== 'host_exact' && match_kind !== 'host_suffix') {
          throw new ToolInputError('kind="api" only supports match_kind="host_exact" or "host_suffix".');
        }
      }
      return client.addAllowlistEntry({ kind, matchKey: match_key, limitRaw: limit_raw, matchKind: match_kind });
    });

  tool('remove_allowlist_entry', { group: 'spend', access: 'write', key: 'agent' },
    'Remove (revoke) a merchant-allowlist entry by policy id (from list_allowlist).',
    {
      policy_id: z.number().int().positive().describe('Policy id of the allowlist entry.'),
    },
    async ({ policy_id }) => {
      await client.removeAllowlistEntry(policy_id);
      return { ok: true, policy_id };
    });

  tool('list_allowlist', { group: 'spend', access: 'read', key: 'agent' },
    'List the agent\'s merchant-allowlist entries (host "api" and payee "vendor" policies) with their spend caps. Does not include session/task spend policies.',
    {},
    () => client.listAllowlist());

  tool('get_agent_reputation', { group: 'spend', access: 'read', key: 'agent' },
    'Return the calling agent\'s unified credit reputation: a 0-100 score, an A-E band, confidence (0-1 share of the model backed by real signals), the resulting collateral-requirement multiplier (collateralMultiplierBps; 10000 = 1.0x baseline, lower score = higher multiplier), modelVersion, and computedAt. Behavioral discipline (declined spends, policy breaches, tool-call reliability, verified-settlement diversity) feeds the score alongside repayment and payment history. Use to understand how much collateral the next borrow will require. Returns 404 until the first score is computed.',
    {},
    () => client.getReputation());

  // ═══════════════════════════════════════════════════════════════════
  // AGENT LIFECYCLE TOOLS (10) — developer-side provisioning: create
  // agents, mint/rotate/revoke their keys, budget each key. These wrap
  // /v1/developer/* routes, so they need a developer key (`floe_live_*`);
  // a bare dev key holds the `owner` role and passes every role gate.
  // ═══════════════════════════════════════════════════════════════════

  tool('create_agent', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Provision a new managed agent end-to-end: agents row → Privy-managed wallet → sponsored on-chain operator delegation → $3 welcome credit auto-disbursed on the account\'s FIRST agent only (immediately spendable; once per account, not per agent). Defaults to pay-as-you-go funding (no credit line; upgrade later with open_credit_line). Returns agentId, privyWalletAddress (the deposit address), and delegationTxHash — NOT an API key; mint one with create_agent_key.',
    {
      name: z.string().min(1).max(64).regex(/^[A-Za-z0-9 _-]+$/).describe('Agent name (alphanumeric / space / underscore / hyphen).'),
      borrow_limit_raw: z.string().regex(/^[1-9]\d*$/).optional().describe('Optional on-chain borrow limit in raw USDC (6 decimals). Omit for the pay-as-you-go default.'),
      max_rate_bps: z.number().int().min(1).max(10000).default(1500).describe('Max annual interest rate the delegation accepts, in bps (default 1500 = 15%).'),
      expiry_seconds: z.number().int().min(60).max(86400 * 365).default(86400 * 90).describe('Operator delegation lifetime in seconds (default 90 days).'),
    },
    ({ name, borrow_limit_raw, max_rate_bps, expiry_seconds }) =>
      client.createAgent({ name, borrowLimitRaw: borrow_limit_raw, maxRateBps: max_rate_bps, expirySeconds: expiry_seconds }));

  tool('list_agents', { group: 'lifecycle', access: 'read', key: 'dev' },
    'List every agent owned by the developer account, with status, wallets, and credit limits.',
    {},
    () => client.listAgents());

  tool('get_agent', { group: 'lifecycle', access: 'read', key: 'dev' },
    'Get one agent\'s full detail: status, privyWalletAddress (deposit address), creditUsed, 24h transaction count, and session spend snapshot.',
    {
      agent_id: agentId.describe('Numeric agent id (from create_agent / list_agents).'),
    },
    ({ agent_id }) => client.getAgent(agent_id));

  tool('pause_agent', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Pause (suspend) one agent — the per-agent kill-switch. Every call with the agent\'s keys fails auth from its next request until resume_agent. Only active agents can be paused.',
    {
      agent_id: agentId.describe('Numeric agent id.'),
    },
    ({ agent_id }) => client.setAgentStatus(agent_id, { status: 'suspended' }));

  tool('resume_agent', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Resume a paused (suspended) agent. Cannot resurrect closed agents or ones suspended by their own lifecycle flows (credit freeze, failed delegation).',
    {
      agent_id: agentId.describe('Numeric agent id.'),
    },
    ({ agent_id }) => client.setAgentStatus(agent_id, { status: 'active' }));

  tool('close_agent', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Permanently close an agent: repays outstanding facility loans, sweeps unspent funds back to the developer (unspent welcome credit returns to the treasury), and disables its keys. Irreversible.',
    {
      agent_id: agentId.describe('Numeric agent id.'),
    },
    ({ agent_id }) => client.closeAgent(agent_id));

  tool('create_agent_key', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Mint a new agent API key (floe_...) for an agent — the credential its runtime tools and x402_pay use. The plaintext key is returned ONCE; store it securely and never echo it into chat. Optionally cap the key with a rolling spend budget (fail-closed).',
    {
      agent_id: agentId.describe('Numeric agent id.'),
      label: z.string().max(100).optional().describe('Human-readable label for the key.'),
      budget_raw: z.string().regex(/^[1-9]\d*$/).optional().describe('Optional per-key spend budget in raw USDC (6 decimals), positive.'),
      window_seconds: z.number().int().min(60).max(86400 * 365).optional().describe('Rolling budget window in seconds. Omit for the server default.'),
    },
    ({ agent_id, label, budget_raw, window_seconds }) =>
      client.createAgentKey(agent_id, { label, budgetRaw: budget_raw, windowSeconds: window_seconds }));

  tool('rotate_agent_key', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Atomically revoke an agent key and mint its replacement (inherits label/permissions unless overridden). The new plaintext key is returned ONCE. Use on suspected leak or on a rotation schedule.',
    {
      agent_id: agentId.describe('Numeric agent id.'),
      key_id: z.number().int().positive().describe('Key id to rotate (from the agent\'s key list).'),
      label: z.string().max(100).optional().describe('Optional new label; omit to inherit.'),
    },
    ({ agent_id, key_id, label }) =>
      client.rotateAgentKey(agent_id, key_id, label !== undefined ? { label } : undefined));

  tool('revoke_agent_key', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Revoke (delete) an agent API key. Calls using it fail auth immediately. Irreversible — rotate_agent_key instead if the agent should keep running.',
    {
      agent_id: agentId.describe('Numeric agent id.'),
      key_id: z.number().int().positive().describe('Key id to revoke.'),
    },
    async ({ agent_id, key_id }) => {
      await client.revokeAgentKey(agent_id, key_id);
      return { ok: true, agent_id, key_id };
    });

  tool('set_agent_key_budget', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Set or update the rolling spend budget on one agent API key (FLO-585). Fail-closed: spend attributed to the key past the budget is refused until the window rolls. A 0 budget is invalid — revoke the key to block it entirely.',
    {
      agent_id: agentId.describe('Numeric agent id.'),
      key_id: z.number().int().positive().describe('Key id to budget.'),
      budget_raw: z.string().regex(/^[1-9]\d*$/).describe('Budget in raw USDC units (6 decimals), positive. e.g. "5000000" = $5.'),
      window_seconds: z.number().int().min(60).max(86400 * 365).optional().describe('Rolling window in seconds. Omit for the server default.'),
    },
    ({ agent_id, key_id, budget_raw, window_seconds }) =>
      client.setAgentKeyBudget(agent_id, key_id, { budgetRaw: budget_raw, windowSeconds: window_seconds }));

  tool('open_credit_line', { group: 'lifecycle', access: 'write', key: 'dev' },
    'Upgrade a pay-as-you-go agent to a managed credit line: the server signs a borrow intent collateralized from the agent\'s wallet (which must already hold the deposit — see get_funding_instructions). Check get_credit_line_bounds first for valid deposit/LTV ranges.',
    {
      agent_id: agentId.describe('Numeric agent id.'),
      deposit_raw: z.string().regex(/^[1-9]\d*$/).describe('Collateral deposit in raw USDC units (6 decimals), positive.'),
      max_ltv_bps: z.number().int().min(1).max(9500).optional().describe('Optional max LTV in bps. Omit for the server default.'),
      max_rate_bps: z.number().int().min(1).max(10000).optional().describe('Optional max annual rate in bps. Omit for the server default.'),
    },
    ({ agent_id, deposit_raw, max_ltv_bps, max_rate_bps }) =>
      client.openCreditLine(agent_id, { depositRaw: deposit_raw, maxLtvBps: max_ltv_bps, maxRateBps: max_rate_bps }));

  tool('get_credit_line_bounds', { group: 'lifecycle', access: 'read', key: 'dev' },
    'Preview the valid deposit / LTV bounds and current funded balances for upgrading an agent to a credit line. Use BEFORE open_credit_line.',
    {
      agent_id: agentId.describe('Numeric agent id.'),
    },
    ({ agent_id }) => client.getCreditLineBounds(agent_id));

  // ═══════════════════════════════════════════════════════════════════
  // FUNDING & OBSERVABILITY TOOLS (5) — developer-side monitoring: how
  // to fund an agent, what the fleet has been doing/spending, and how much
  // of that spend Floe actually enforces (Coverage Score).
  // ═══════════════════════════════════════════════════════════════════

  tool('get_funding_instructions', { group: 'observability', access: 'read', key: 'dev' },
    'Return machine-readable funding instructions for an agent: the USDC deposit address, chain (Base, 8453), and any minimums/warnings. Hand this to the human when welcome credit runs out — funding is the one step an agent cannot do alone.',
    {
      agent_id: agentId.describe('Numeric agent id.'),
    },
    async ({ agent_id }) => {
      // GET /v1/developer/agents/:id/funding is a new WS1 endpoint that may
      // deploy after this server ships. On 404, fall back to the agent
      // detail's privyWalletAddress (the deposit address) so the tool stays
      // useful either way. A missing agent 404s in the fallback too, which
      // is the right error for the caller.
      try {
        return await client.getAgentFunding(agent_id);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        const detail = await client.getAgent(agent_id);
        const depositAddress = detail?.agent?.privyWalletAddress ?? null;
        return {
          agentId: agent_id,
          depositAddress,
          chainId: 8453,
          asset: 'USDC',
          note: depositAddress
            ? 'Derived from the agent record (the dedicated funding endpoint is not deployed yet). Send USDC on Base (8453) to depositAddress.'
            : 'Agent has no deposit wallet yet — provisioning may still be in flight. Retry shortly.',
        };
      }
    });

  tool('get_balances', { group: 'observability', access: 'read', key: 'dev' },
    'Aggregate USDC balances across the developer account: developer wallet, every agent wallet, and API credits.',
    {},
    () => client.getBalances());

  tool('get_activity', { group: 'observability', access: 'read', key: 'dev' },
    'Unified account activity feed: x402 proxy calls, onramps, transfers, and loan events, newest first. Filter by agent, type, or time range; paginate with the returned cursor.',
    {
      agent_id: agentId.optional().describe('Filter to one agent (numeric id).'),
      // The backend validates ?type= against this exact set and 400s on
      // anything else, so the enum is the contract — not a free string.
      // Multiple types are sent as a CSV, which is what the route parses.
      type: z.array(ACTIVITY_EVENT_TYPE).min(1).optional()
        .describe('Filter to these activity types. Omit for all.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results, 1-100 (server default 50).'),
      since: z.string().optional().describe('ISO-8601 lower bound.'),
      until: z.string().optional().describe('ISO-8601 upper bound.'),
      cursor: z.string().optional().describe('Opaque pagination cursor from a previous page.'),
    },
    ({ agent_id, type, limit, since, until, cursor }) =>
      client.getActivity({ agentId: agent_id, type: type?.join(','), limit, since, until, cursor }));

  tool('get_usage_summary', { group: 'observability', access: 'read', key: 'dev' },
    'Spend/usage analytics rollup for the account: KPIs, daily series, and top endpoints over a time window. The "how is my fleet doing" one-call view.',
    {
      // Closed set server-side — an unrecognized window is a 400, not a
      // silent fallback, so mirror the enum rather than accepting a string.
      window: z.enum(['24h', '7d', '30d', 'all']).optional().describe('Time window (server default 7d).'),
      agent_id: agentId.optional().describe('Scope to one agent (numeric id).'),
    },
    ({ window, agent_id }) => client.getUsageSummary({ window, agentId: agent_id }));

  tool('get_coverage_score', { group: 'observability', access: 'read', key: 'dev' },
    'Report the Coverage Score: the share of an agent\'s (or the whole fleet\'s) KNOWN spend Floe can enforce ' +
    'pre-call vs reconciled (off-path, seen only after the fact) vs dark (never seen). Answers "how much of my ' +
    'agent\'s spend is actually enforced?" Pass agent_id to scope to one agent; omit it for the fleet-wide score ' +
    '(this server has no configured primary agent, so a keyless-of-agent call is fleet-wide by design). Pairs ' +
    'with floe-guard\'s opt-in ledger sync, which feeds the reconciled bucket. Budget, not balance.',
    {
      agent_id: agentId.optional().describe('Numeric agent id (from create_agent / list_agents) to scope the score to one agent. Omit for the fleet-wide Coverage Score across all agents.'),
      days: z.number().int().min(1).max(365).default(30).describe('Look-back window in days (default 30).'),
    },
    async ({ agent_id, days }) => {
      const coverage = await client.getCoverageScore({ agentId: agent_id, days });
      // Append an honest read of the buckets so the agent doesn't mistake
      // "reconciled" for "enforced": reconciled spend was recorded AFTER the
      // fact (via floe-guard ledger sync), never gated pre-call. A lower
      // enforceable % is the signal to route more spend through Floe.
      return {
        ...coverage,
        note: 'Coverage = share of KNOWN spend Floe gated BEFORE the call (pre-call-enforceable) vs reconciled ' +
          '(off-path spend Floe saw only after the fact via floe-guard ledger sync — recorded, not gated) vs dark ' +
          '(spend Floe never saw). Reconciled is NOT enforced; a lower enforceable % means route more spend through ' +
          'Floe. This is budget coverage, not a balance.',
      };
    });

  // ═══════════════════════════════════════════════════════════════════
  // PAYMENT EXECUTION (1) — the tool that actually spends. Everything
  // else in the pricing group exists so the agent can decide BEFORE
  // calling this.
  // ═══════════════════════════════════════════════════════════════════

  tool('x402_pay', { group: 'payments', access: 'write', key: 'agent' },
    'Execute a paid x402 call through the Floe proxy: Floe pays the vendor in USDC from the calling agent\'s balance/credit (subject to spend limits, budgets, and allowlist) and returns the vendor\'s response plus the X-Floe-* metering headers (cost, budget advisory, settled receipt). Pass idempotency_key (Stripe-style) so retries never double-pay. Use estimate_x402_cost or x402_forecast FIRST.',
    {
      url: z.string()
        .url()
        .refine((u) => /^https?:\/\//i.test(u), 'URL must use http:// or https://')
        .describe('The x402 vendor URL to call.'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
        .optional()
        .describe('HTTP method (default GET).'),
      headers: z.record(z.string()).optional().describe('Extra request headers to forward to the vendor (payment/framing headers are stripped server-side).'),
      body: z.string().optional().describe('Raw request body string (JSON-encode it yourself for JSON APIs).'),
      idempotency_key: z.string().min(1).max(255).optional().describe('Idempotency key: a replayed call returns the cached response instead of paying again (FLO-548).'),
    },
    ({ url, method, headers, body, idempotency_key }) =>
      client.proxyFetch({ url, method, headers, body }, idempotency_key));

  // ═══════════════════════════════════════════════════════════════════
  // WEBHOOK TOOLS (11) — developer-side push notifications + delivery
  // logs. Thin wrappers; the event catalog is validated server-side (and
  // served live by list_webhook_events) so new event types light up
  // without a server release here.
  // ═══════════════════════════════════════════════════════════════════

  tool('create_webhook', { group: 'webhooks', access: 'write', key: 'dev' },
    'Register a webhook endpoint for account events. Returns the signing secret ONCE — store it to verify deliveries. Subscribe to exact event names, "*", or prefix wildcards like "call.*"; call list_webhook_events for the live 30-event catalog (loan, agent, credit, call, phone, marketplace categories). Max 10 webhooks.',
    {
      url: z.string().url().max(2048)
        .refine((value) => /^https:\/\//i.test(value), 'URL must use https://')
        .describe('HTTPS endpoint to deliver events to.'),
      events: z.array(z.string().min(1)).min(1).describe('Event names to subscribe to — exact names, "*", or prefix wildcards like "call.*" (validated server-side; see list_webhook_events).'),
      scope: z.enum(['global', 'wallet', 'agent', 'loan']).default('global').describe('Delivery scope (default global). "agent" filters to one agent by its wallet address.'),
      scope_value: z.string().max(256).optional().describe('Wallet address (scope wallet/agent — the agent WALLET address, not the numeric agent id) or numeric loan id (scope loan). Omit for global.'),
      description: z.string().max(256).optional().describe('Human-readable label.'),
    },
    ({ url, events, scope, scope_value, description }) => {
      // The backend pairs scope with scopeValue strictly: wallet/agent need
      // an address, loan needs a numeric id, global must have neither.
      // Reject the incoherent combos here so the agent gets the rule, not
      // a 400.
      if (scope === 'global' && scope_value !== undefined) {
        throw new ToolInputError('scope="global" does not accept a scope_value.');
      }
      if (scope !== 'global' && scope_value === undefined) {
        throw new ToolInputError(`scope="${scope}" requires a scope_value (wallet address or numeric loan id).`);
      }
      if ((scope === 'wallet' || scope === 'agent') && !/^0x[a-fA-F0-9]{40}$/.test(scope_value ?? '')) {
        throw new ToolInputError(`scope="${scope}" requires scope_value to be a 0x wallet address (for scope="agent", the agent's wallet address, not its numeric id).`);
      }
      if (scope === 'loan' && !/^\d+$/.test(scope_value ?? '')) {
        throw new ToolInputError('scope="loan" requires scope_value to be a numeric loan id.');
      }
      return client.createWebhook({ url, events, scope, scopeValue: scope_value, description });
    });

  tool('list_webhooks', { group: 'webhooks', access: 'read', key: 'dev' },
    'List the account\'s registered webhooks with their subscribed events, scope, and active flag (secrets are never returned).',
    {},
    () => client.listWebhooks());

  tool('list_webhook_events', { group: 'webhooks', access: 'read', key: 'dev' },
    'List the live webhook event catalog: every subscribable event with its name, title, description, category (loan/agent/credit/call/phone/marketplace), and scope dimension. The authoritative list for create_webhook / update_webhook events arrays.',
    {},
    () => client.listWebhookEvents());

  tool('get_webhook', { group: 'webhooks', access: 'read', key: 'dev' },
    'Get one webhook endpoint plus its delivery stats (pending/success/failed/retrying/total counts). Secrets are never returned.',
    {
      webhook_id: z.number().int().positive().describe('Webhook id (from list_webhooks).'),
    },
    ({ webhook_id }) => client.getWebhook(webhook_id));

  tool('update_webhook', { group: 'webhooks', access: 'write', key: 'dev' },
    'Update a webhook endpoint: change its URL, subscribed events, description, or pause/resume it via active. Scope cannot be changed after creation — delete and recreate instead.',
    {
      webhook_id: z.number().int().positive().describe('Webhook id (from list_webhooks).'),
      url: z.string().url().max(2048)
        .refine((value) => /^https:\/\//i.test(value), 'URL must use https://')
        .optional().describe('New HTTPS endpoint URL.'),
      events: z.array(z.string().min(1)).min(1).optional().describe('Replacement event list (exact names, "*", or prefix wildcards).'),
      active: z.boolean().optional().describe('false pauses deliveries, true resumes them.'),
      description: z.string().max(256).optional().describe('New human-readable label.'),
    },
    ({ webhook_id, url, events, active, description }) => {
      if (url === undefined && events === undefined && active === undefined && description === undefined) {
        throw new ToolInputError('Provide at least one field to update: url, events, active, or description.');
      }
      return client.updateWebhook(webhook_id, { url, events, active, description });
    });

  tool('delete_webhook', { group: 'webhooks', access: 'write', key: 'dev' },
    'Delete a webhook endpoint permanently. Deliveries to it stop immediately; its delivery history is removed with it.',
    {
      webhook_id: z.number().int().positive().describe('Webhook id (from list_webhooks).'),
    },
    ({ webhook_id }) => client.deleteWebhook(webhook_id));

  tool('test_webhook', { group: 'webhooks', access: 'write', key: 'dev' },
    'Send a signed test delivery to one webhook endpoint so you can verify connectivity and signature handling end-to-end.',
    {
      webhook_id: z.number().int().positive().describe('Webhook id (from list_webhooks).'),
    },
    ({ webhook_id }) => client.testWebhook(webhook_id));

  tool('rotate_webhook_secret', { group: 'webhooks', access: 'write', key: 'dev' },
    'Rotate a webhook\'s signing secret. Returns the new secret ONCE — update your receiver before old-secret deliveries stop verifying.',
    {
      webhook_id: z.number().int().positive().describe('Webhook id (from list_webhooks).'),
    },
    ({ webhook_id }) => client.rotateWebhookSecret(webhook_id));

  tool('list_webhook_deliveries', { group: 'webhooks', access: 'read', key: 'dev' },
    'List the account-wide webhook delivery log (all endpoints), newest first, with cursor pagination. Rows carry event, status (pending/success/failed/retrying), HTTP status, attempt count, agent wallet, and correlation id (call id / job id / loan id) — but not payloads; use get_webhook_delivery for those. Logs are retained 30 days.',
    {
      endpoint_id: z.number().int().positive().optional().describe('Filter to one webhook endpoint id.'),
      event: z.string().min(1).max(128).optional().describe('Filter by exact event name (no wildcards).'),
      agent_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().describe('Filter by agent wallet address.'),
      status: z.enum(['pending', 'success', 'failed', 'retrying']).optional().describe('Filter by delivery status.'),
      from: z.string().min(1).optional().describe('Only deliveries at/after this ISO timestamp.'),
      to: z.string().min(1).optional().describe('Only deliveries at/before this ISO timestamp.'),
      id_search: z.string().min(1).max(128).optional().describe('Match a delivery id OR correlation id (call session id, job id, loan id).'),
      cursor: z.string().min(1).optional().describe('Opaque cursor from a previous response\'s nextCursor.'),
      limit: z.number().int().min(1).max(100).default(50).describe('Page size (default 50, max 100).'),
    },
    ({ endpoint_id, event, agent_wallet, status, from, to, id_search, cursor, limit }) =>
      client.listWebhookDeliveries({ endpoint: endpoint_id, event, agent: agent_wallet, status, from, to, id: id_search, cursor, limit }));

  tool('get_webhook_delivery', { group: 'webhooks', access: 'read', key: 'dev' },
    'Get one webhook delivery in full: the exact payload that was sent, the sanitized response body (capped at 1KB), and the next retry time if it is still retrying.',
    {
      delivery_id: z.string().min(1).max(64).describe('The hex delivery id (from list_webhook_deliveries rows or the X-Floe-Delivery-Id header) — not the numeric row id.'),
    },
    ({ delivery_id }) => client.getWebhookDelivery(delivery_id));

  tool('retry_webhook_delivery', { group: 'webhooks', access: 'write', key: 'dev' },
    'Manually redeliver one failed webhook delivery to its endpoint. Test deliveries cannot be retried. Receivers should dedupe on the X-Floe-Delivery-Id header.',
    {
      webhook_id: z.number().int().positive().describe('Webhook id the delivery belongs to.'),
      delivery_id: z.string().min(1).max(64).describe('The hex delivery id to redeliver.'),
    },
    ({ webhook_id, delivery_id }) => client.retryWebhookDelivery(webhook_id, delivery_id));

  // ═══════════════════════════════════════════════════════════════════
  // DOCS (1) — Stripe pattern: the agent should not need a second MCP
  // server to learn the Floe API. Keyless by design.
  // ═══════════════════════════════════════════════════════════════════

  tool('search_floe_docs', { group: 'docs', access: 'read', key: 'none' },
    'Search the Floe documentation index (llms.txt) and return matching pages with titles, URLs, and descriptions. Whitespace-separated terms are matched case-insensitively against a page\'s section, title, URL, and description; results are ranked by how many terms hit, so pages matching every term come first. Use to answer "how do I…" questions about the Floe API, x402 vendors, spend controls, or this MCP server.',
    {
      query: z.string().min(1).max(200).describe('Search terms, e.g. "spend limit webhook".'),
      limit: z.number().int().min(1).max(25).default(10).describe('Max matches to return.'),
    },
    ({ query, limit }) => searchFloeDocs(query, limit));
}
