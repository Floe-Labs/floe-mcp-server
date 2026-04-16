/**
 * FloeApiClient — thin HTTP client for the Floe Credit API.
 * Replaces the entire ServiceContainer from the thick MCP server.
 */
export class FloeApiClient {
  private static DEFAULT_TIMEOUT_MS = 30_000;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private timeoutMs: number = FloeApiClient.DEFAULT_TIMEOUT_MS,
  ) {}

  private async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
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

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = { message: text }; }
      throw new ApiError(res.status, parsed?.error ?? `HTTP ${res.status}`, parsed?.message ?? text);
    }

    return res.json() as Promise<T>;
  }

  private get<T = any>(path: string) { return this.request<T>('GET', path); }
  private post<T = any>(path: string, body: unknown) { return this.request<T>('POST', path, body); }

  // ── Read ──────────────────────────────────────────────────────────
  getMarkets() { return this.get('/v1/markets'); }
  getMarketRates() { return this.get('/v1/status/markets'); }
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
