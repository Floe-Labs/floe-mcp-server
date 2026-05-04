import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FloeApiClient } from '../client.js';
import { textResult, errorResult } from '../types/responses.js';

const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

function wrap(fn: () => Promise<any>) {
  return async () => {
    try { return textResult(await fn()); }
    catch (e: any) { return errorResult(e.code ?? 'ERROR', { message: e.message }); }
  };
}

export function registerAllTools(server: McpServer, client: FloeApiClient) {
  // ═══════════════════════════════════════════════════════════════════
  // READ TOOLS (12)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('get_markets', 'List all active lending markets with current rates and liquidity.', {},
    wrap(() => client.getMarkets()));

  server.tool('get_market_details', 'Get detailed market info including oracle prices and stats.', {},
    wrap(() => client.getMarketRates()));

  server.tool('get_open_lend_intents', 'Browse open lend offers available for borrowing against.', {
    limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
    skip: z.number().int().min(0).default(0).describe('Skip count'),
  }, async ({ limit, skip }) => wrap(() => client.getIntents({ type: 'lend', limit, skip }))());

  server.tool('get_open_borrow_intents', 'Browse open borrow requests. Use create_counter_intent to lend against one.', {
    limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
    skip: z.number().int().min(0).default(0).describe('Skip count'),
  }, async ({ limit, skip }) => wrap(() => client.getIntents({ type: 'borrow', limit, skip }))());

  server.tool('get_intent_details', 'Get full details of a specific intent by its offer hash.', {
    offer_hash: z.string().describe('Intent offer hash (bytes32 hex)'),
  }, async ({ offer_hash }) => wrap(() => client.getIntentByHash(offer_hash))());

  server.tool('get_loan', 'Get details of a specific loan by its numeric ID.', {
    loan_id: z.string().describe('Numeric loan ID'),
  }, async ({ loan_id }) => wrap(() => client.getLoanById(loan_id))());

  server.tool('get_user_loans', 'Get all loans for a wallet address, both as borrower and lender.', {
    wallet_address: addr.describe('Wallet address'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
  }, async ({ wallet_address, limit }) => wrap(() => client.getLoans({ wallet: wallet_address, limit }))());

  server.tool('get_loan_health', 'Check loan health: LTV, liquidation risk, accrued interest, early repayment terms.', {
    loan_id: z.string().describe('Numeric loan ID'),
  }, async ({ loan_id }) => wrap(() => client.getLoanHealth(loan_id))());

  server.tool('get_liquidation_quote', 'Get loan status and liquidation eligibility.', {
    loan_id: z.string().describe('Numeric loan ID'),
  }, async ({ loan_id }) => wrap(() => client.getLoanById(loan_id))());

  server.tool('get_token_price', 'Get current oracle price for collateral token.', {
    market_id: z.string().optional().describe('Market ID. Omit for default USDC/WETH.'),
  }, async ({ market_id }) => wrap(() => client.getPrice(market_id))());

  server.tool('get_wallet_balance', 'Check token balances for a wallet.', {
    wallet_address: addr.describe('Wallet address'),
    token_symbol: z.string().optional().describe('Token symbol (e.g. "USDC"). Omit for all.'),
  }, async ({ wallet_address, token_symbol }) => wrap(() => client.getBalance(wallet_address, token_symbol))());

  server.tool('get_accrued_interest', 'Get accrued interest and full credit status for a loan.', {
    loan_id: z.string().describe('Numeric loan ID'),
  }, async ({ loan_id }) => wrap(() => client.getCreditStatus(loan_id))());

  // ═══════════════════════════════════════════════════════════════════
  // WRITE TOOLS (9) — return unsigned transactions
  // ═══════════════════════════════════════════════════════════════════

  server.tool('create_lend_intent', 'Build unsigned tx to create a lending offer. Solver matches it with borrowers.', {
    wallet_address: addr.describe('Lender wallet'),
    amount: z.string().describe('Amount in raw token units'),
    min_interest_rate_bps: z.number().int().min(1).max(10000).describe('Min annual rate in bps (500 = 5%)'),
    max_ltv_bps: z.number().int().min(1000).max(9500).describe('Max LTV in bps (7000 = 70%)'),
    min_duration_days: z.number().int().min(1).describe('Min duration in days'),
    max_duration_days: z.number().int().min(1).describe('Max duration in days'),
    market_id: z.string().optional().describe('Market ID. Omit for default.'),
  }, async (params) => {
    if (params.min_duration_days > params.max_duration_days) {
      return errorResult('INVALID_ARGUMENT', { message: 'min_duration_days must be <= max_duration_days' });
    }
    return wrap(() => client.createLendIntent(params))();
  });

  server.tool('create_borrow_intent', 'Build unsigned tx to create a borrow request. Solver matches it with lenders.', {
    wallet_address: addr.describe('Borrower wallet'),
    borrow_amount: z.string().describe('Amount to borrow in raw token units'),
    collateral_amount: z.string().describe('Collateral in raw token units'),
    max_interest_rate_bps: z.number().int().min(1).max(10000).describe('Max annual rate in bps'),
    min_duration_days: z.number().int().min(1).describe('Min duration in days'),
    max_duration_days: z.number().int().min(1).describe('Max duration in days'),
    min_ltv_bps: z.number().int().optional().default(8000).describe('Min LTV in bps'),
    market_id: z.string().optional().describe('Market ID. Omit for default.'),
  }, async (params) => {
    if (params.min_duration_days > params.max_duration_days) {
      return errorResult('INVALID_ARGUMENT', { message: 'min_duration_days must be <= max_duration_days' });
    }
    return wrap(() => client.createBorrowIntent(params))();
  });

  server.tool('create_counter_intent',
    'Create a counter-intent against an existing offer. Primary way to accept offers. Solver auto-matches.',
    {
      offer_hash: z.string().describe('Source intent offer hash'),
      wallet_address: addr.describe('Your wallet address'),
    }, async (params) => wrap(() => client.createCounterIntent(params))());

  server.tool('repay_loan', 'Build unsigned tx to repay a loan with auto-approval and slippage protection.', {
    wallet_address: addr.describe('Borrower wallet'),
    loan_id: z.string().describe('Loan ID'),
    slippage_bps: z.number().int().optional().default(500).describe('Slippage tolerance (500 = 5%)'),
  }, async (params) => wrap(() => client.repayLoan(params))());

  server.tool('add_collateral', 'Build unsigned tx to add collateral to a loan.', {
    wallet_address: addr.describe('Wallet adding collateral'),
    loan_id: z.string().describe('Loan ID'),
    amount: z.string().describe('Collateral amount in raw token units'),
    market_id: z.string().optional().describe('Market ID'),
  }, async (params) => wrap(() => client.addCollateral(params))());

  server.tool('withdraw_collateral', 'Build unsigned tx to withdraw excess collateral.', {
    loan_id: z.string().describe('Loan ID'),
    amount: z.string().describe('Amount to withdraw'),
  }, async (params) => wrap(() => client.withdrawCollateral(params))());

  server.tool('liquidate_loan', 'Build unsigned tx to liquidate an unhealthy loan.', {
    wallet_address: addr.describe('Liquidator wallet'),
    loan_id: z.string().describe('Loan ID'),
    max_repayment: z.string().describe('Max amount willing to pay'),
    market_id: z.string().optional().describe('Market ID'),
  }, async (params) => wrap(() => client.liquidateLoan(params))());

  server.tool('revoke_intent', 'Build unsigned tx to cancel an active intent.', {
    offer_hash: z.string().describe('Intent offer hash'),
    side: z.enum(['lend', 'borrow']).describe('Intent side'),
  }, async (params) => wrap(() => client.revokeIntent(params))());

  server.tool('approve_token', 'Build unsigned tx to approve a token for Floe protocol.', {
    token_address: addr.describe('Token contract address'),
    amount: z.string().describe('Amount to approve in raw units'),
  }, async (params) => wrap(() => client.approveToken(params))());

  // ═══════════════════════════════════════════════════════════════════
  // ANALYSIS TOOLS (3)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('check_compatibility', 'Check if two intents can match.', {
    lend_offer_hash: z.string().describe('Lend intent hash'),
    borrow_offer_hash: z.string().describe('Borrow intent hash'),
  }, async (params) => wrap(() => client.checkCompatibility(params))());

  server.tool('calculate_risk', 'Calculate risk metrics for a potential loan position.', {
    borrow_amount: z.number().positive().describe('Borrow amount in human units'),
    collateral_amount: z.number().positive().describe('Collateral in human units'),
    interest_rate_percent: z.number().min(0).max(100).describe('Annual rate %'),
    duration_days: z.number().int().min(1).describe('Duration in days'),
    liquidation_ltv_percent: z.number().optional().default(88).describe('Liquidation threshold %'),
  }, async (params) => wrap(() => client.calculateRisk(params))());

  server.tool('estimate_interest', 'Estimate total interest for given loan terms.', {
    principal: z.number().positive().describe('Loan principal in human units'),
    interest_rate_bps: z.number().int().min(1).max(10000).describe('Annual rate in bps'),
    duration_days: z.number().int().min(1).describe('Duration in days'),
  }, async (params) => wrap(() => client.estimateInterest(params))());

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY TOOLS (3)
  // ═══════════════════════════════════════════════════════════════════

  server.tool('simulate_transaction', 'Dry-run an unsigned tx. Returns success/revert and gas estimate.', {
    from: addr.describe('Signing address (msg.sender)'),
    to: addr.describe('Contract address'),
    data: z.string().describe('Encoded calldata (0x hex)'),
    value: z.string().optional().default('0x0').describe('ETH value in hex'),
  }, async (params) => wrap(() => client.simulateTransaction(params))());

  server.tool('broadcast_transaction', 'Submit a signed transaction to Base Mainnet.', {
    signed_transaction_hex: z.string().describe('Signed tx as 0x RLP hex'),
  }, async (params) => wrap(() => client.broadcastTransaction(params))());

  server.tool('get_transaction_status', 'Check status of a submitted transaction.', {
    transaction_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).describe('Transaction hash'),
  }, async ({ transaction_hash }) => wrap(() => client.getTxStatus(transaction_hash))());

  // ═══════════════════════════════════════════════════════════════════
  // AGENT AWARENESS TOOLS (9) — let an agent reason about its own
  // credit before committing capital. Decide → estimate → check → act.
  // All require an agent API key (`floe_*`); the calling identity is
  // taken from the bearer token, so none of these tools need a wallet
  // address parameter.
  // ═══════════════════════════════════════════════════════════════════

  server.tool('get_credit_remaining',
    'Return how much USDC credit the calling agent has left. Use BEFORE deciding whether to make a paid call. Includes available, creditLimit, headroomToAutoBorrow, utilizationBps, and any session spend-limit state.',
    {},
    wrap(() => client.getCreditRemaining()));

  server.tool('get_loan_state',
    'Return the agent\'s coarse credit state-machine view: idle | borrowing | at_limit | repaying. Use to gate actions that only make sense in specific states (e.g. don\'t spend while at_limit).',
    {},
    wrap(() => client.getLoanState()));

  server.tool('get_spend_limit',
    'Return the agent\'s currently-active session spend cap, if any. Returns { active: false } when no cap is set.',
    {},
    wrap(() => client.getSpendLimit()));

  server.tool('set_spend_limit',
    'Set or update the agent\'s session spend cap (USDC raw, 6 decimals). Resets the session window — anything spent before this call no longer counts. Operator-defined; distinct from the on-chain creditLimit.',
    {
      limit_raw: z.string().regex(/^[1-9]\d*$/).describe('Cap in raw USDC units (6 decimals), positive. e.g. "1000000" = $1.'),
    },
    async ({ limit_raw }) => wrap(() => client.setSpendLimit({ limitRaw: limit_raw }))());

  server.tool('clear_spend_limit',
    'Remove the agent\'s session spend cap. Subsequent paid calls will only be bounded by the on-chain creditLimit.',
    {},
    wrap(async () => {
      await client.clearSpendLimit();
      return { ok: true };
    }));

  server.tool('list_credit_thresholds',
    'List the agent\'s registered credit-utilization thresholds. Each fires a credit.warning / credit.at_limit / credit.recovered webhook when crossed.',
    {},
    wrap(() => client.listCreditThresholds()));

  server.tool('register_credit_threshold',
    'Register a new credit-utilization threshold. When utilizationBps crosses thresholdBps from below, the agent\'s webhook receives credit.warning (or credit.at_limit if >= 9500). Drops below → credit.recovered. Cap of 20 thresholds per agent.',
    {
      threshold_bps: z.number().int().min(1).max(10000).describe('Utilization threshold in bps (5000 = 50%, 9500 = 95% → at_limit).'),
      webhook_id: z.number().int().positive().optional().describe('Optional: pin to a specific webhook owned by this developer. Omit for fanout.'),
    },
    async ({ threshold_bps, webhook_id }) =>
      wrap(() => client.registerCreditThreshold({ thresholdBps: threshold_bps, webhookId: webhook_id }))());

  server.tool('delete_credit_threshold',
    'Delete one of the agent\'s credit-utilization thresholds by id (from list_credit_thresholds).',
    {
      id: z.number().int().positive().describe('Threshold subscription id.'),
    },
    async ({ id }) => wrap(async () => {
      await client.deleteCreditThreshold(id);
      return { ok: true, id };
    })());

  server.tool('estimate_x402_cost',
    'Preflight an x402-protected URL and return its USDC cost without paying. Reflects against the calling agent\'s available credit and session spend-limit so you can decide gating in one round-trip. Use BEFORE proxy/fetch.',
    {
      url: z.string().url().describe('Target URL to preflight.'),
      method: z.string().regex(/^[A-Z]{3,7}$/).optional().describe('HTTP method (default GET).'),
    },
    async ({ url, method }) => wrap(() => client.estimateX402Cost({ url, method }))());
}
