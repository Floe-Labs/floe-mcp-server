import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloeApiClient, ApiError } from '../src/client.js';
import { VERSION } from '../src/version.js';

// Offline: every test stubs global fetch and records the calls the client
// makes. These tests pin the tool → backend path mapping so a route typo
// can't ship (main auto-deploys the hosted endpoint).

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

let calls: RecordedCall[];

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function stubFetch(respond?: (url: string) => Response | undefined) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined,
    });
    return respond?.(String(url)) ?? jsonRes({ ok: true });
  }));
}

const BASE = 'http://api.test';

describe('FloeApiClient request plumbing', () => {
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it('sends User-Agent floe-mcp/<version> on every request', async () => {
    const client = new FloeApiClient(BASE, 'floe_live_key');
    await client.getMarkets();
    expect(calls[0].headers['User-Agent']).toBe(`floe-mcp/${VERSION}`);
  });

  it('sends Authorization when a key is present and omits it when keyless', async () => {
    await new FloeApiClient(BASE, 'floe_live_key').getMarkets();
    expect(calls[0].headers['Authorization']).toBe('Bearer floe_live_key');

    await new FloeApiClient(BASE).getMarkets();
    expect(calls[1].headers['Authorization']).toBeUndefined();
  });

  it('classifies key kind from the prefix', () => {
    expect(new FloeApiClient(BASE).keyKind).toBe('none');
    expect(new FloeApiClient(BASE, 'floe_live_abc').keyKind).toBe('dev');
    expect(new FloeApiClient(BASE, 'floe_' + 'a'.repeat(64)).keyKind).toBe('agent');
    expect(new FloeApiClient(BASE, 'sk-whatever').keyKind).toBe('unknown');
  });

  it('preserves the HTTP status and error code on failures', async () => {
    stubFetch(() => jsonRes({ error: 'insufficient_balance', message: 'Top up first' }, 402));
    const client = new FloeApiClient(BASE, 'floe_' + 'a'.repeat(64));
    await expect(client.getCreditRemaining()).rejects.toMatchObject({
      status: 402,
      code: 'insufficient_balance',
      message: 'Top up first',
    });
    await expect(client.getCreditRemaining()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('FloeApiClient path mapping — WS2 lifecycle tools', () => {
  let client: FloeApiClient;

  beforeEach(() => {
    stubFetch();
    client = new FloeApiClient(BASE, 'floe_live_key');
  });
  afterEach(() => vi.unstubAllGlobals());

  const last = () => calls[calls.length - 1];

  const cases: Array<[string, () => Promise<unknown>, string, string]> = [
    ['createAgent', () => client.createAgent({ name: 'bot', maxRateBps: 1500, expirySeconds: 7776000 }),
      'POST', '/v1/developer/agents'],
    ['listAgents', () => client.listAgents(), 'GET', '/v1/developer/agents'],
    ['getAgent', () => client.getAgent('7'), 'GET', '/v1/developer/agents/7'],
    ['setAgentStatus', () => client.setAgentStatus('7', { status: 'suspended' }),
      'PATCH', '/v1/developer/agents/7/status'],
    ['closeAgent', () => client.closeAgent('7'), 'POST', '/v1/developer/agents/7/close'],
    ['createAgentKey', () => client.createAgentKey('7', { label: 'ci' }),
      'POST', '/v1/developer/agents/7/keys'],
    ['rotateAgentKey', () => client.rotateAgentKey('7', 3),
      'POST', '/v1/developer/agents/7/keys/3/rotate'],
    ['revokeAgentKey', () => client.revokeAgentKey('7', 3),
      'DELETE', '/v1/developer/agents/7/keys/3'],
    ['setAgentKeyBudget', () => client.setAgentKeyBudget('7', 3, { budgetRaw: '5000000' }),
      'PUT', '/v1/developer/agents/7/keys/3/budget'],
    ['getAgentFunding', () => client.getAgentFunding('7'), 'GET', '/v1/developer/agents/7/funding'],
    ['getBalances', () => client.getBalances(), 'GET', '/v1/developer/balances'],
    ['getActivity', () => client.getActivity(), 'GET', '/v1/developer/activity'],
    ['getUsageSummary', () => client.getUsageSummary(), 'GET', '/v1/developer/analytics/summary'],
    ['createWebhook', () => client.createWebhook({ url: 'https://x.test/h', events: ['loan.repaid'], scope: 'global' }),
      'POST', '/v1/developer/webhooks'],
    ['listWebhooks', () => client.listWebhooks(), 'GET', '/v1/developer/webhooks'],
    ['listWebhookEvents', () => client.listWebhookEvents(), 'GET', '/v1/developer/webhooks/events'],
    ['getWebhook', () => client.getWebhook(4), 'GET', '/v1/developer/webhooks/4'],
    ['updateWebhook', () => client.updateWebhook(4, { active: false }), 'PATCH', '/v1/developer/webhooks/4'],
    ['deleteWebhook', () => client.deleteWebhook(4), 'DELETE', '/v1/developer/webhooks/4'],
    ['testWebhook', () => client.testWebhook(4), 'POST', '/v1/developer/webhooks/4/test'],
    ['rotateWebhookSecret', () => client.rotateWebhookSecret(4), 'POST', '/v1/developer/webhooks/4/rotate-secret'],
    ['retryWebhookDelivery', () => client.retryWebhookDelivery(4, 'a1b2c3'), 'POST', '/v1/developer/webhooks/4/deliveries/a1b2c3/retry'],
    ['listWebhookDeliveries', () => client.listWebhookDeliveries(), 'GET', '/v1/developer/webhook-deliveries'],
    ['getWebhookDelivery', () => client.getWebhookDelivery('a1b2c3'), 'GET', '/v1/developer/webhook-deliveries/a1b2c3'],
    ['openCreditLine', () => client.openCreditLine('7', { depositRaw: '10000000' }),
      'POST', '/v1/developer/agents/7/open-credit-line'],
    ['getCreditLineBounds', () => client.getCreditLineBounds('7'),
      'GET', '/v1/developer/agents/7/credit-line-bounds'],
    ['forecastX402', () => client.forecastX402({ items: [{ url: 'https://v.test/api' }] }),
      'POST', '/v1/x402/forecast'],
    ['proxyFetch', () => client.proxyFetch({ url: 'https://v.test/api' }), 'POST', '/v1/proxy/fetch'],
    ['emitOutcome', () => client.emitOutcome({
      taskId: 'call-8821', outcomeKind: 'meeting_booked', idempotencyKey: 'call-8821:meeting_booked',
    }), 'POST', '/v1/agents/outcomes'],
    ['listOutcomes', () => client.listOutcomes(), 'GET', '/v1/developer/outcomes'],
    ['getOutcome', () => client.getOutcome('oev_00112233445566aa'),
      'GET', '/v1/developer/outcomes/oev_00112233445566aa'],
  ];

  for (const [name, run, method, path] of cases) {
    it(`${name} → ${method} ${path}`, async () => {
      await run();
      expect(last().method).toBe(method);
      expect(last().url).toBe(`${BASE}${path}`);
    });
  }

  it('checkX402Url → GET /v1/proxy/check with url-encoded query', async () => {
    await client.checkX402Url('https://v.test/api?a=1');
    expect(last().method).toBe('GET');
    expect(last().url).toBe(`${BASE}/v1/proxy/check?url=https%3A%2F%2Fv.test%2Fapi%3Fa%3D1`);
  });

  it('emitOutcome POSTs the claim body verbatim', async () => {
    await client.emitOutcome({
      taskId: 'call-8821',
      outcomeKind: 'meeting_booked',
      idempotencyKey: 'call-8821:meeting_booked',
      quantity: 2,
      externalSystem: 'hubspot',
      externalRef: 'DEAL-9',
    });
    expect(last().method).toBe('POST');
    expect(JSON.parse(String(last().body))).toEqual({
      taskId: 'call-8821',
      outcomeKind: 'meeting_booked',
      idempotencyKey: 'call-8821:meeting_booked',
      quantity: 2,
      externalSystem: 'hubspot',
      // Stored verbatim — equality on (system, ref) is what proves two claims
      // are one fact, so the client must not normalise it.
      externalRef: 'DEAL-9',
    });
  });

  it('listOutcomes serializes every filter the route honours, and nothing else', async () => {
    await client.listOutcomes({
      since: '2026-09-01T00:00:00Z',
      until: '2026-09-21T00:00:00Z',
      taskId: 'call-8821',
      interactionId: 'int_00112233445566bb',
      customerId: 'acme',
      campaignId: 'q3-outbound',
      outcomeKind: 'meeting_booked',
      // The route parses `status` as a comma-separated subset, so it is joined
      // here rather than repeated as multiple params.
      status: ['reported', 'confirmed'],
      source: 'agent',
      limit: 25,
      cursor: 'opaque',
    });
    const url = new URL(last().url);
    expect(url.pathname).toBe('/v1/developer/outcomes');
    expect(url.searchParams.get('taskId')).toBe('call-8821');
    expect(url.searchParams.get('interactionId')).toBe('int_00112233445566bb');
    expect(url.searchParams.get('customerId')).toBe('acme');
    expect(url.searchParams.get('campaignId')).toBe('q3-outbound');
    expect(url.searchParams.get('outcomeKind')).toBe('meeting_booked');
    expect(url.searchParams.get('status')).toBe('reported,confirmed');
    expect(url.searchParams.get('source')).toBe('agent');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('opaque');
    // `vendor` / `agentId` are NOT accepted by this route. The outcomes query
    // builder is deliberately separate from actualsQuery for exactly that
    // reason — a silently ignored filter is worse than an absent one.
    expect(url.searchParams.has('vendor')).toBe(false);
    expect(url.searchParams.has('agentId')).toBe(false);
  });

  it('getOutcome url-encodes the claim id it is given', async () => {
    await client.getOutcome('oev_00112233445566aa');
    expect(last().url).toBe(`${BASE}/v1/developer/outcomes/oev_00112233445566aa`);
  });

  it('listWebhookDeliveries serializes filters into the query string', async () => {
    await client.listWebhookDeliveries({
      endpoint: 4, event: 'call.ended', agent: '0x' + 'a'.repeat(40),
      status: 'failed', from: '2026-08-01T00:00:00Z', id: 'sess-1', limit: 25,
    });
    expect(last().url).toBe(
      `${BASE}/v1/developer/webhook-deliveries?endpoint=4&event=call.ended&agent=0x${'a'.repeat(40)}&status=failed&from=2026-08-01T00%3A00%3A00Z&id=sess-1&limit=25`,
    );
  });

  it('getActivity/getUsageSummary serialize filters into the query string', async () => {
    await client.getActivity({ agentId: '7', limit: 10, type: 'proxy' });
    expect(last().url).toBe(`${BASE}/v1/developer/activity?agentId=7&type=proxy&limit=10`);
    await client.getUsageSummary({ window: '30d', agentId: '7' });
    expect(last().url).toBe(`${BASE}/v1/developer/analytics/summary?window=30d&agentId=7`);
  });

  it('getCoverageScore routes agent-scoped vs fleet-wide and serializes days', async () => {
    await client.getCoverageScore({ agentId: '7', days: 30 });
    expect(last().url).toBe(`${BASE}/v1/developer/agents/7/coverage?days=30`);
    await client.getCoverageScore({ days: 7 });
    expect(last().url).toBe(`${BASE}/v1/developer/coverage?days=7`);
    await client.getCoverageScore();
    expect(last().url).toBe(`${BASE}/v1/developer/coverage`);
  });

  it('forecastX402 maps task_id → taskId in the request body', async () => {
    await client.forecastX402({ items: [{ url: 'https://v.test/api', count: 3, taskId: 'research' }] });
    expect(JSON.parse(last().body!)).toEqual({
      items: [{ url: 'https://v.test/api', count: 3, taskId: 'research' }],
    });
  });
});

describe('FloeApiClient.proxyFetch (x402_pay backend)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the Idempotency-Key header when provided', async () => {
    stubFetch();
    const client = new FloeApiClient(BASE, 'floe_' + 'a'.repeat(64));
    await client.proxyFetch({ url: 'https://v.test/api', method: 'POST', body: '{}' }, 'retry-1');
    expect(calls[0].headers['Idempotency-Key']).toBe('retry-1');

    await client.proxyFetch({ url: 'https://v.test/api' });
    expect(calls[1].headers['Idempotency-Key']).toBeUndefined();
  });

  it('returns status + X-Floe-* headers + parsed body on success', async () => {
    stubFetch(() => jsonRes({ result: 42 }, 200, { 'X-Floe-Budget-Advisory': 'near_limit=false' }));
    const client = new FloeApiClient(BASE, 'floe_' + 'a'.repeat(64));
    const res = await client.proxyFetch({ url: 'https://v.test/api' });
    expect(res).toEqual({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-floe-budget-advisory': 'near_limit=false',
      },
      body: { result: 42 },
    });
  });

  it('keeps a non-JSON vendor body as raw text', async () => {
    stubFetch(() => new Response('plain text receipt', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const client = new FloeApiClient(BASE, 'floe_' + 'a'.repeat(64));
    const res = await client.proxyFetch({ url: 'https://v.test/api' });
    expect(res.body).toBe('plain text receipt');
  });

  it('throws ApiError with the proxy status on failure', async () => {
    stubFetch(() => jsonRes({ error: 'wrong_credential_type', message: 'agent key required' }, 401));
    const client = new FloeApiClient(BASE, 'floe_live_key');
    await expect(client.proxyFetch({ url: 'https://v.test/api' })).rejects.toMatchObject({
      status: 401,
      code: 'wrong_credential_type',
    });
  });
});
