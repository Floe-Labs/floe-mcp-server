import { VERSION } from './version.js';

/**
 * FloeApiClient — thin HTTP client for the Floe Credit API.
 * Replaces the entire ServiceContainer from the thick MCP server.
 */
export class FloeApiClient {
  private static DEFAULT_TIMEOUT_MS = 30_000;

  constructor(
    private baseUrl: string,
    private apiKey?: string,
    private timeoutMs: number = FloeApiClient.DEFAULT_TIMEOUT_MS,
  ) {}

  /** True when the client holds a credential (env key or per-request Bearer). */
  get hasKey(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Which kind of key the client holds, judged from the prefix alone:
   * `floe_live_*` = developer key, any other `floe_*` = agent key. Used
   * only to build wrong-key-type remediation hints on 401/403 — never for
   * authorization decisions (the backend is authoritative).
   */
  get keyKind(): 'agent' | 'dev' | 'unknown' | 'none' {
    if (!this.apiKey) return 'none';
    if (this.apiKey.startsWith('floe_live_')) return 'dev';
    if (this.apiKey.startsWith('floe_')) return 'agent';
    return 'unknown';
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': `floe-mcp/${VERSION}`,
      ...extra,
    };
    // Keyless sessions send no Authorization header at all — the public
    // endpoints (/v1/markets, /v1/proxy/check) accept unauthenticated
    // requests, and everything else 401s server-side as expected.
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  // Low-level fetch shared by request() and proxyFetch(): owns the
  // AbortController/timeout, maps aborts to a structured TIMEOUT error, and
  // pre-reads the body text so callers only differ in how they interpret it.
  private async rawFetch(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ res: Response; text: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(extraHeaders),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ApiError(0, 'TIMEOUT', `Request to ${method} ${path} timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text().catch(() => '');
    return { res, text };
  }

  private httpError(res: Response, text: string): ApiError {
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = { message: text }; }
    return new ApiError(res.status, parsed?.error ?? `HTTP ${res.status}`, parsed?.message ?? text);
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const { res, text } = await this.rawFetch(method, path, body, extraHeaders);
    if (!res.ok) throw this.httpError(res, text);

    // 204 No Content (and any other empty-body success) must not blow up
    // `JSON.parse('')`. Used by `clear_spend_limit` / `delete_credit_threshold`
    // and any future endpoint whose contract says "ack-only".
    if (res.status === 204 || text.trim().length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }

  private get<T = any>(path: string) { return this.request<T>('GET', path); }
  private post<T = any>(path: string, body: unknown) { return this.request<T>('POST', path, body); }

  // ── Read ──────────────────────────────────────────────────────────
  getMarkets() { return this.get('/v1/markets'); }
  getIntents(params: { type?: string; limit?: number; skip?: number }) {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.skip) qs.set('skip', String(params.skip));
    return this.get(`/v1/intents?${qs}`);
  }
  getIntentByHash(hash: string) { return this.get(`/v1/intents/${hash}`); }
  getLoans(params: { wallet: string; limit?: number }) {
    const qs = new URLSearchParams({ wallet: params.wallet });
    if (params.limit) qs.set('limit', String(params.limit));
    return this.get(`/v1/loans?${qs}`);
  }
  getLoanById(id: string) { return this.get(`/v1/loans/${id}`); }
  getLoanHealth(id: string) { return this.get(`/v1/loans/${id}/health`); }
  getPrice(marketId?: string) {
    const qs = marketId ? `?market_id=${marketId}` : '';
    return this.get(`/v1/price${qs}`);
  }
  getBalance(wallet: string, token?: string) {
    const qs = token ? `?token=${token}` : '';
    return this.get(`/v1/balance/${wallet}${qs}`);
  }
  getCreditStatus(loanId: string) { return this.get(`/v1/credit/status/${loanId}`); }
  getCreditOffers(params?: { marketId?: string; minAmount?: string; maxRateBps?: string }) {
    const qs = new URLSearchParams();
    if (params?.marketId) qs.set('marketId', params.marketId);
    if (params?.minAmount) qs.set('minAmount', params.minAmount);
    if (params?.maxRateBps) qs.set('maxRateBps', params.maxRateBps);
    const q = qs.toString();
    return this.get(`/v1/credit/offers${q ? '?' + q : ''}`);
  }

  // ── Transaction Builders ──────────────────────────────────────────
  createLendIntent(body: unknown) { return this.post('/v1/tx/create-lend-intent', body); }
  createBorrowIntent(body: unknown) { return this.post('/v1/tx/create-borrow-intent', body); }
  createCounterIntent(body: unknown) { return this.post('/v1/tx/create-counter-intent', body); }
  repayLoan(body: unknown) { return this.post('/v1/tx/repay', body); }
  addCollateral(body: unknown) { return this.post('/v1/tx/add-collateral', body); }
  withdrawCollateral(body: unknown) { return this.post('/v1/tx/withdraw-collateral', body); }
  liquidateLoan(body: unknown) { return this.post('/v1/tx/liquidate', body); }
  revokeIntent(body: unknown) { return this.post('/v1/tx/revoke-intent', body); }
  approveToken(body: unknown) { return this.post('/v1/tx/approve-token', body); }

  // ── Utility ───────────────────────────────────────────────────────
  simulateTransaction(body: unknown) { return this.post('/v1/tx/simulate', body); }
  broadcastTransaction(body: unknown) { return this.post('/v1/tx/broadcast', body); }
  getTxStatus(hash: string) { return this.get(`/v1/tx/${hash}/status`); }

  // ── Analysis ──────────────────────────────────────────────────────
  checkCompatibility(body: unknown) { return this.post('/v1/analysis/compatibility', body); }
  calculateRisk(body: unknown) { return this.post('/v1/analysis/risk', body); }
  estimateInterest(body: unknown) { return this.post('/v1/analysis/interest', body); }

  // ── Agent Awareness ───────────────────────────────────────────────
  // The 5 primitives let an agent answer "do I have credit?", "is this
  // call worth it?", and "where do I sit in the loan lifecycle?" before
  // committing capital. All require an agent API key (`floe_*`); the
  // calling identity is taken from the bearer token.
  getCreditRemaining() { return this.get('/v1/agents/credit-remaining'); }
  getLoanState() { return this.get('/v1/agents/loan-state'); }
  getSpendLimit() { return this.get('/v1/agents/spend-limit'); }
  setSpendLimit(body: { limitRaw: string }) { return this.request('PUT', '/v1/agents/spend-limit', body); }
  clearSpendLimit() { return this.request('DELETE', '/v1/agents/spend-limit'); }
  listCreditThresholds() { return this.get('/v1/agents/credit-thresholds'); }
  registerCreditThreshold(body: { thresholdBps: number; webhookId?: number }) {
    return this.post('/v1/agents/credit-thresholds', body);
  }
  deleteCreditThreshold(id: number) { return this.request('DELETE', `/v1/agents/credit-thresholds/${id}`); }
  estimateX402Cost(body: { url: string; method?: string }) {
    return this.post('/v1/x402/estimate', body);
  }

  // ── Merchant Allowlist ────────────────────────────────────────────
  // Opt-in, default-deny restriction on which destinations an agent may
  // pay. An allowlist entry is an ordinary capped policy row (kind='api'
  // host, kind='vendor' payee) that doubles as "allowed AND capped". The
  // mode flag toggles which proxy gates enforce them; 'off' (default) =
  // allow any vendor. All require an agent API key (`floe_*`).
  getAllowlistMode() { return this.get('/v1/agents/allowlist-mode'); }
  setAllowlistMode(body: { mode: 'off' | 'host' | 'vendor' | 'both' }) {
    return this.request('PUT', '/v1/agents/allowlist-mode', body);
  }
  addAllowlistEntry(body: {
    kind: 'api' | 'vendor';
    matchKey: string;
    limitRaw: string;
    matchKind?: 'host_exact' | 'host_suffix' | 'recipient';
  }) {
    return this.post('/v1/agents/policies', body);
  }
  removeAllowlistEntry(policyId: number) {
    return this.request('DELETE', `/v1/agents/policies/${policyId}`);
  }
  // GET /v1/agents/policies returns ALL policies (incl. session/task spend
  // rows). Filter to allowlist kinds so the method name is honest and the
  // caller doesn't have to re-filter.
  async listAllowlist() {
    const res = await this.get<{ policies?: Array<{ kind: string }> }>('/v1/agents/policies');
    const policies = (res?.policies ?? []).filter((p) => p.kind === 'api' || p.kind === 'vendor');
    return { ...res, policies };
  }

  // ── Inference gateway (FLO-602) ───────────────────────────────────
  // Keyless pay-as-you-go LLM/voice gateway. `listInferenceModels` is the
  // OpenAI-compatible /v1/models catalog; `estimateInferenceCost` prices a
  // usage vector (no balance/upstream call) so an agent can decide before
  // spending.
  listInferenceModels() { return this.get('/v1/models'); }
  estimateInferenceCost(body: {
    model: string;
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
    characters?: number;
    audio_seconds?: number;
    audio_input_tokens?: number;
    audio_output_tokens?: number;
  }) {
    return this.post('/v1/estimate', body);
  }

  // ── Behavioral telemetry / reputation (FLO-579) ───────────────────
  // Tool-call telemetry: name + timing + ok/error only (no args/results),
  // fire-and-forget from the tool wrapper. Reputation is the unified credit
  // score (TTL-cached server-side) + collateral multiplier.
  logToolCall(body: { tool: string; durationMs: number; ok: boolean; errorCode?: string }) {
    return this.post('/v1/events/tool-call', body);
  }
  getReputation() { return this.get('/v1/agents/reputation'); }

  // ── Developer lifecycle (WS2) ─────────────────────────────────────
  // Everything under /v1/developer/* wants a developer key (`floe_live_*`).
  // A bare dev key resolves to the `owner` role server-side, so key-only
  // bootstrap works end-to-end; agent keys 403 on the role-gated routes.
  createAgent(body: { name: string; borrowLimitRaw?: string; maxRateBps: number; expirySeconds: number }) {
    return this.post('/v1/developer/agents', body);
  }
  listAgents() { return this.get('/v1/developer/agents'); }
  getAgent(agentId: string) { return this.get(`/v1/developer/agents/${agentId}`); }
  setAgentStatus(agentId: string, body: { status: 'active' | 'suspended' }) {
    return this.request('PATCH', `/v1/developer/agents/${agentId}/status`, body);
  }
  closeAgent(agentId: string) { return this.post(`/v1/developer/agents/${agentId}/close`, {}); }
  createAgentKey(agentId: string, body: { label?: string; budgetRaw?: string; windowSeconds?: number }) {
    return this.post(`/v1/developer/agents/${agentId}/keys`, body);
  }
  rotateAgentKey(agentId: string, keyId: number, body?: { label?: string }) {
    return this.post(`/v1/developer/agents/${agentId}/keys/${keyId}/rotate`, body);
  }
  revokeAgentKey(agentId: string, keyId: number) {
    return this.request('DELETE', `/v1/developer/agents/${agentId}/keys/${keyId}`);
  }
  setAgentKeyBudget(agentId: string, keyId: number, body: { budgetRaw: string; windowSeconds?: number }) {
    return this.request('PUT', `/v1/developer/agents/${agentId}/keys/${keyId}/budget`, body);
  }
  // New WS1 endpoint — machine-readable funding instructions. May 404
  // until the API side deploys; the tool falls back to getAgent()'s
  // privyWalletAddress (the deposit address) so the answer stays useful.
  getAgentFunding(agentId: string) { return this.get(`/v1/developer/agents/${agentId}/funding`); }
  getBalances() { return this.get('/v1/developer/balances'); }
  getActivity(params?: {
    agentId?: string;
    type?: string;
    limit?: number;
    since?: string;
    until?: string;
    cursor?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.type) qs.set('type', params.type);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.since) qs.set('since', params.since);
    if (params?.until) qs.set('until', params.until);
    if (params?.cursor) qs.set('cursor', params.cursor);
    const q = qs.toString();
    return this.get(`/v1/developer/activity${q ? '?' + q : ''}`);
  }
  getUsageSummary(params?: { window?: string; agentId?: string }) {
    const qs = new URLSearchParams();
    if (params?.window) qs.set('window', params.window);
    if (params?.agentId) qs.set('agentId', params.agentId);
    const q = qs.toString();
    return this.get(`/v1/developer/analytics/summary${q ? '?' + q : ''}`);
  }
  // Coverage Score — share of known spend Floe can enforce pre-call vs
  // reconciled (off-path) vs dark. Scoped to one agent when `agentId` is
  // given, else the fleet-wide variant. Both live under /v1/developer/*.
  getCoverageScore(params?: { agentId?: string; days?: number }) {
    const qs = new URLSearchParams();
    if (params?.days !== undefined) qs.set('days', String(params.days));
    const q = qs.toString();
    const base = params?.agentId
      ? `/v1/developer/agents/${params.agentId}/coverage`
      : '/v1/developer/coverage';
    return this.get(`${base}${q ? '?' + q : ''}`);
  }
  createWebhook(body: {
    url: string;
    events: string[];
    scope: string;
    scopeValue?: string;
    description?: string;
  }) {
    return this.post('/v1/developer/webhooks', body);
  }
  listWebhooks() { return this.get('/v1/developer/webhooks'); }
  listWebhookEvents() { return this.get('/v1/developer/webhooks/events'); }
  getWebhook(webhookId: number) { return this.get(`/v1/developer/webhooks/${webhookId}`); }
  updateWebhook(webhookId: number, body: {
    url?: string;
    events?: string[];
    active?: boolean;
    description?: string;
  }) {
    return this.request('PATCH', `/v1/developer/webhooks/${webhookId}`, body);
  }
  deleteWebhook(webhookId: number) { return this.request('DELETE', `/v1/developer/webhooks/${webhookId}`); }
  testWebhook(webhookId: number) { return this.post(`/v1/developer/webhooks/${webhookId}/test`, {}); }
  rotateWebhookSecret(webhookId: number) { return this.post(`/v1/developer/webhooks/${webhookId}/rotate-secret`, {}); }
  retryWebhookDelivery(webhookId: number, deliveryId: string) {
    return this.post(`/v1/developer/webhooks/${webhookId}/deliveries/${encodeURIComponent(deliveryId)}/retry`, {});
  }
  listWebhookDeliveries(params?: {
    endpoint?: number;
    event?: string;
    agent?: string;
    status?: string;
    from?: string;
    to?: string;
    id?: string;
    cursor?: string;
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.endpoint !== undefined) qs.set('endpoint', String(params.endpoint));
    if (params?.event) qs.set('event', params.event);
    if (params?.agent) qs.set('agent', params.agent);
    if (params?.status) qs.set('status', params.status);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.id) qs.set('id', params.id);
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return this.get(`/v1/developer/webhook-deliveries${q ? '?' + q : ''}`);
  }
  getWebhookDelivery(deliveryId: string) {
    return this.get(`/v1/developer/webhook-deliveries/${encodeURIComponent(deliveryId)}`);
  }
  openCreditLine(agentId: string, body: { depositRaw: string; maxLtvBps?: number; maxRateBps?: number }) {
    return this.post(`/v1/developer/agents/${agentId}/open-credit-line`, body);
  }
  getCreditLineBounds(agentId: string) {
    return this.get(`/v1/developer/agents/${agentId}/credit-line-bounds`);
  }

  // ── x402 execution ────────────────────────────────────────────────
  // `checkX402Url` is the public (unauthenticated, IP-rate-limited) probe;
  // `forecastX402` batches estimates + policy preflight; `proxyFetch` is
  // the actual paid call — agent key only, Idempotency-Key supported so
  // retries never double-pay (FLO-548).
  checkX402Url(url: string) {
    return this.get(`/v1/proxy/check?${new URLSearchParams({ url })}`);
  }
  forecastX402(body: { items: Array<{ url: string; method?: string; count?: number; taskId?: string }> }) {
    return this.post('/v1/x402/forecast', body);
  }
  async proxyFetch(
    body: { url: string; method?: string; headers?: Record<string, string>; body?: string },
    idempotencyKey?: string,
  ) {
    const { res, text } = await this.rawFetch(
      'POST',
      '/v1/proxy/fetch',
      body,
      idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    );
    if (!res.ok) throw this.httpError(res, text);

    // The proxy passes the vendor response through verbatim — it is NOT
    // guaranteed to be JSON. Surface status + the X-Floe-* metering headers
    // (budget advisory, idempotent-replay marker, cost) alongside the body
    // so the agent sees the settled receipt and the advisory in one result.
    const floeHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k.startsWith('x-floe-') || k === 'content-type') floeHeaders[k] = value;
    });
    let parsedBody: unknown = text;
    try { parsedBody = JSON.parse(text); } catch { /* keep raw text */ }
    return { status: res.status, headers: floeHeaders, body: parsedBody };
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
