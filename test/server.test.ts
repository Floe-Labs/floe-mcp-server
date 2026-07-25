import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMcpServer } from '../src/server.js';
import { FloeApiClient } from '../src/client.js';
import { clearDocsCache, LLMS_TXT_URL } from '../src/docs.js';

// Offline smoke tests for the tool surface: registration counts, keyless
// gating, read_only/features scope filtering, and error-payload shape.
// These are the release gate — main auto-deploys the hosted endpoint.

const BASE = 'http://api.test';
const AGENT_KEY = 'floe_' + 'a'.repeat(64);
const DEV_KEY = 'floe_live_devkey';

const KEYLESS_TOOLS = ['get_markets', 'check_x402_url', 'search_floe_docs'];
const REMOVED_TOOLS = ['get_market_details', 'get_liquidation_quote'];
const ADDED_TOOLS = [
  'create_agent', 'list_agents', 'get_agent', 'pause_agent', 'resume_agent', 'close_agent',
  'create_agent_key', 'rotate_agent_key', 'revoke_agent_key', 'set_agent_key_budget',
  'get_funding_instructions', 'get_balances', 'get_activity', 'get_usage_summary',
  'x402_forecast', 'x402_pay', 'create_webhook', 'list_webhooks', 'test_webhook',
  'open_credit_line', 'get_credit_line_bounds', 'search_floe_docs', 'check_x402_url',
];
const WRITE_TOOLS = [
  'create_lend_intent', 'create_borrow_intent', 'create_counter_intent', 'repay_loan',
  'add_collateral', 'withdraw_collateral', 'liquidate_loan', 'revoke_intent', 'approve_token',
  'broadcast_transaction',
  'set_spend_limit', 'clear_spend_limit', 'register_credit_threshold', 'delete_credit_threshold',
  'set_allowlist_mode', 'add_allowlist_entry', 'remove_allowlist_entry',
  'create_agent', 'pause_agent', 'resume_agent', 'close_agent',
  'create_agent_key', 'rotate_agent_key', 'revoke_agent_key', 'set_agent_key_budget',
  'open_credit_line', 'x402_pay', 'create_webhook', 'test_webhook',
];

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let calls: RecordedCall[];

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(respond?: (url: string) => Response | undefined) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    return respond?.(String(url)) ?? jsonRes({ ok: true });
  }));
}

// Telemetry fire-and-forget calls are part of every tool invocation with a
// key — filter them out when asserting on the backend traffic itself.
const apiCalls = () => calls.filter((c) => !c.url.includes('/v1/events/tool-call'));

function makeServer(key?: string, filter?: { readOnly?: boolean; features?: string[] }) {
  return createMcpServer(new FloeApiClient(BASE, key), filter) as any;
}

const toolNames = (server: any): string[] => Object.keys(server._registeredTools);

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const tool = server._registeredTools[name];
  if (!tool) throw new Error(`tool not registered: ${name}`);
  const result = await tool.handler(args, {});
  return { result, payload: JSON.parse(result.content[0].text) };
}

// The MCP SDK validates args against the registered zod shape before the
// handler runs, so callTool() (which invokes the handler directly) skips it.
// Use this to assert on the schema itself.
function parseArgs(server: any, name: string, args: Record<string, unknown>) {
  const tool = server._registeredTools[name];
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return z.object(tool.inputSchema.shape ?? tool.inputSchema).safeParse(args);
}

beforeEach(() => {
  stubFetch();
  clearDocsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('tool surface', () => {
  it('registers exactly 65 tools', () => {
    expect(toolNames(makeServer(AGENT_KEY))).toHaveLength(65);
  });

  it('does not register the removed tools', () => {
    const names = toolNames(makeServer(AGENT_KEY));
    for (const removed of REMOVED_TOOLS) expect(names).not.toContain(removed);
  });

  it('registers all 23 contract-added tools', () => {
    const names = toolNames(makeServer(DEV_KEY));
    for (const added of ADDED_TOOLS) expect(names).toContain(added);
  });

  it('declares the required key type in every description', () => {
    const server = makeServer(DEV_KEY);
    for (const name of toolNames(server)) {
      const description: string = server._registeredTools[name].description;
      expect(
        /No API key required|Requires an agent key \(floe_\.\.\.\)|Requires a developer key \(floe_live_\.\.\.\)|Requires any Floe API key/.test(description),
        `${name} must declare its key requirement`,
      ).toBe(true);
    }
  });
});

describe('scope filtering', () => {
  it('read_only=true registers only non-mutating tools', () => {
    const names = toolNames(makeServer(AGENT_KEY, { readOnly: true }));
    expect(names).toHaveLength(36);
    for (const writeTool of WRITE_TOOLS) expect(names).not.toContain(writeTool);
    expect(names).toContain('get_markets');
    expect(names).toContain('get_credit_remaining');
    expect(names).toContain('x402_forecast');
  });

  it('features=spend,pricing registers only those capability groups', () => {
    const names = toolNames(makeServer(AGENT_KEY, { features: ['spend', 'pricing'] }));
    expect(names).toHaveLength(19); // 14 spend + 5 pricing
    expect(names).toContain('get_credit_remaining');
    expect(names).toContain('set_spend_limit');
    expect(names).toContain('estimate_x402_cost');
    expect(names).toContain('x402_forecast');
    expect(names).not.toContain('get_markets'); // lending
    expect(names).not.toContain('x402_pay'); // payments
    expect(names).not.toContain('create_agent'); // lifecycle
  });

  it('read_only combines with features', () => {
    const names = toolNames(makeServer(AGENT_KEY, { readOnly: true, features: ['payments', 'docs'] }));
    expect(names).toEqual(['search_floe_docs']); // x402_pay is a write
  });

  it('unknown feature names match nothing', () => {
    expect(toolNames(makeServer(AGENT_KEY, { features: ['nope'] }))).toHaveLength(0);
  });
});

describe('keyless tier', () => {
  it('key-gated tools return a structured AUTH_REQUIRED error naming the key type and the dashboard', async () => {
    const server = makeServer(undefined);
    const { result, payload } = await callTool(server, 'get_credit_remaining');
    expect(result.isError).toBe(true);
    expect(payload.error).toBe('AUTH_REQUIRED');
    expect(payload.status).toBe(401);
    expect(payload.message).toContain('agent key (floe_...)');
    expect(payload.next).toContain('dev-dashboard.floelabs.xyz');
    expect(apiCalls()).toHaveLength(0); // short-circuited before any HTTP

    const dev = await callTool(server, 'create_agent', { name: 'bot' });
    expect(dev.payload.error).toBe('AUTH_REQUIRED');
    expect(dev.payload.message).toContain('developer key (floe_live_...)');
  });

  it('get_markets works keyless and sends no Authorization header', async () => {
    stubFetch(() => jsonRes({ markets: [] }));
    const { payload } = await callTool(makeServer(undefined), 'get_markets');
    expect(payload).toEqual({ markets: [] });
    expect(calls).toHaveLength(1); // telemetry skipped without a key
    expect(calls[0].headers['Authorization']).toBeUndefined();
  });

  it('check_x402_url works keyless', async () => {
    stubFetch(() => jsonRes({ x402: false, status: 200 }));
    const { payload } = await callTool(makeServer(undefined), 'check_x402_url', { url: 'https://v.test/api' });
    expect(payload).toEqual({ x402: false, status: 200 });
    expect(calls[0].url).toBe(`${BASE}/v1/proxy/check?url=https%3A%2F%2Fv.test%2Fapi`);
  });

  it('search_floe_docs works keyless against the llms.txt index', async () => {
    const llms = [
      '# Floe',
      '## For developers',
      '- [Spend Controls](https://docs.test/spend-controls): Session and vendor spend caps',
      '- [Webhooks](https://docs.test/webhooks): Push notifications for credit events',
    ].join('\n');
    stubFetch((url) => (url === LLMS_TXT_URL ? new Response(llms, { status: 200 }) : undefined));
    const { payload } = await callTool(makeServer(undefined), 'search_floe_docs', { query: 'spend caps', limit: 10 });
    expect(payload.totalEntries).toBe(2);
    expect(payload.source).toBe(LLMS_TXT_URL);
    expect(payload.matches).toEqual([{
      section: 'For developers',
      title: 'Spend Controls',
      url: 'https://docs.test/spend-controls',
      description: 'Session and vendor spend caps',
    }]);
  });

  // The real llms.txt has NO descriptions — bare `- [Title](url)` bullets —
  // so requiring every term to hit would answer "spend limit" with nothing.
  it('search_floe_docs ranks partial matches instead of returning nothing', async () => {
    const llms = [
      '## Floe Docs',
      '- [Agent Wallet](https://docs.test/wallet)',
      '- [Spend Controls](https://docs.test/spend-controls)',
      '- [Session Spend Limit](https://docs.test/spend-limit)',
    ].join('\n');
    stubFetch((url) => (url === LLMS_TXT_URL ? new Response(llms, { status: 200 }) : undefined));
    const { payload } = await callTool(makeServer(undefined), 'search_floe_docs', { query: 'spend limit', limit: 10 });
    // Both terms hit "Session Spend Limit"; only "spend" hits "Spend Controls".
    expect(payload.matches.map((m: { title: string }) => m.title))
      .toEqual(['Session Spend Limit', 'Spend Controls']);
  });
});

describe('error payloads', () => {
  it('preserves the backend HTTP status in the tool error payload', async () => {
    stubFetch((url) => (url.includes('/v1/agents/credit-remaining') ? jsonRes({ error: 'rate_limit_exceeded', message: 'slow down' }, 429) : undefined));
    const { result, payload } = await callTool(makeServer(AGENT_KEY), 'get_credit_remaining');
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ error: 'rate_limit_exceeded', status: 429, message: 'slow down' });
  });

  it('401 with a developer key on an agent tool hints at the wrong key type', async () => {
    stubFetch((url) => (url.includes('/v1/agents/credit-remaining') ? jsonRes({ error: 'Unauthorized', message: 'Invalid API key' }, 401) : undefined));
    const { payload } = await callTool(makeServer(DEV_KEY), 'get_credit_remaining');
    expect(payload.status).toBe(401);
    expect(payload.next).toContain('Wrong key type');
    expect(payload.next).toContain('agent key (floe_...)');
  });

  it('401 with an agent key on a developer tool hints at the wrong key type', async () => {
    stubFetch((url) => (url.includes('/v1/developer/agents') ? jsonRes({ error: 'Unauthorized' }, 401) : undefined));
    const { payload } = await callTool(makeServer(AGENT_KEY), 'list_agents');
    expect(payload.status).toBe(401);
    expect(payload.next).toContain('developer key (floe_live_...)');
  });

  it('local cross-field validation fails before any HTTP call', async () => {
    const { result, payload } = await callTool(makeServer(AGENT_KEY), 'add_allowlist_entry', {
      kind: 'vendor', match_key: 'not-an-address', limit_raw: '1000000',
    });
    expect(result.isError).toBe(true);
    expect(payload.error).toBe('INVALID_ARGUMENT');
    expect(apiCalls()).toHaveLength(0);
  });

  it('create_webhook rejects incoherent scope/scope_value pairs locally', async () => {
    const server = makeServer(DEV_KEY);
    const withValue = await callTool(server, 'create_webhook', {
      url: 'https://x.test/h', events: ['loan.repaid'], scope: 'global', scope_value: '0xabc',
    });
    expect(withValue.payload.error).toBe('INVALID_ARGUMENT');

    const missingValue = await callTool(server, 'create_webhook', {
      url: 'https://x.test/h', events: ['loan.repaid'], scope: 'wallet',
    });
    expect(missingValue.payload.error).toBe('INVALID_ARGUMENT');
    expect(apiCalls()).toHaveLength(0);

    await callTool(server, 'create_webhook', {
      url: 'https://x.test/h', events: ['agent.created'], scope: 'global',
    });
    expect(apiCalls()).toHaveLength(1);
  });
});

describe('input schemas match the backend contract', () => {
  // These enums are validated server-side (400 on anything else), so a
  // free-string schema would let an agent build a guaranteed-failing call.
  it('get_activity type accepts only real ActivityEventType values, as a CSV', async () => {
    const server = makeServer(DEV_KEY);
    expect(parseArgs(server, 'get_activity', { type: ['proxy'] }).success).toBe(false);
    expect(parseArgs(server, 'get_activity', { type: ['x402_call', 'transfer_deposit'] }).success).toBe(true);
    expect(parseArgs(server, 'get_activity', { limit: 200 }).success).toBe(false); // backend clamps at 100

    await callTool(server, 'get_activity', { type: ['x402_call', 'onramp_sweep'] });
    expect(apiCalls()[0].url).toBe(`${BASE}/v1/developer/activity?type=x402_call%2Conramp_sweep`);
  });

  it('get_usage_summary window accepts only the four supported windows', () => {
    const server = makeServer(DEV_KEY);
    expect(parseArgs(server, 'get_usage_summary', { window: '1d' }).success).toBe(false);
    for (const window of ['24h', '7d', '30d', 'all']) {
      expect(parseArgs(server, 'get_usage_summary', { window }).success).toBe(true);
    }
  });

  it('create_agent defaults the delegation fields the API requires', () => {
    const parsed = parseArgs(makeServer(DEV_KEY), 'create_agent', { name: 'research bot' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ max_rate_bps: 1500, expiry_seconds: 7776000 });
  });

  it('x402_pay rejects non-http(s) URLs before any spend', () => {
    const server = makeServer(AGENT_KEY);
    expect(parseArgs(server, 'x402_pay', { url: 'file:///etc/passwd' }).success).toBe(false);
    expect(parseArgs(server, 'x402_pay', { url: 'https://v.test/api' }).success).toBe(true);
  });
});

describe('new tool wiring', () => {
  it('x402_pay posts to /v1/proxy/fetch with the Idempotency-Key header', async () => {
    await callTool(makeServer(AGENT_KEY), 'x402_pay', {
      url: 'https://v.test/api', method: 'POST', body: '{"q":1}', idempotency_key: 'retry-9',
    });
    const [call] = apiCalls();
    expect(call.method).toBe('POST');
    expect(call.url).toBe(`${BASE}/v1/proxy/fetch`);
    expect(call.headers['Idempotency-Key']).toBe('retry-9');
  });

  it('pause_agent / resume_agent PATCH the status route with the right status', async () => {
    const server = makeServer(DEV_KEY);
    await callTool(server, 'pause_agent', { agent_id: '7' });
    expect(apiCalls()[0]).toMatchObject({ method: 'PATCH', url: `${BASE}/v1/developer/agents/7/status` });

    await callTool(server, 'resume_agent', { agent_id: '7' });
    expect(apiCalls()[1]).toMatchObject({ method: 'PATCH', url: `${BASE}/v1/developer/agents/7/status` });
  });

  it('get_funding_instructions falls back to the agent detail when /funding 404s', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/developer/agents/7/funding')) return jsonRes({ error: 'not_found' }, 404);
      if (url.endsWith('/v1/developer/agents/7')) {
        return jsonRes({ agent: { privyWalletAddress: '0x' + '1'.repeat(40) } });
      }
      return undefined;
    });
    const { payload } = await callTool(makeServer(DEV_KEY), 'get_funding_instructions', { agent_id: '7' });
    expect(payload).toMatchObject({
      agentId: '7',
      depositAddress: '0x' + '1'.repeat(40),
      chainId: 8453,
      asset: 'USDC',
    });
  });

  it('get_funding_instructions passes the funding endpoint response through when it exists', async () => {
    stubFetch((url) => (url.endsWith('/funding') ? jsonRes({ depositAddress: '0xabc', chainId: 8453 }) : undefined));
    const { payload } = await callTool(makeServer(DEV_KEY), 'get_funding_instructions', { agent_id: '7' });
    expect(payload).toEqual({ depositAddress: '0xabc', chainId: 8453 });
    expect(apiCalls()).toHaveLength(1);
  });
});
