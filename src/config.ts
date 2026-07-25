export interface AppConfig {
  apiKey?: string;
  apiBaseUrl: string;
}

// FLOE_API_KEY is deliberately OPTIONAL. In HTTP mode the per-request
// Bearer header is the identity, so requiring a process-wide key at boot
// was a needless bootstrap blocker for hosting. In stdio mode a keyless
// session still gets the public tools (get_markets, check_x402_url,
// search_floe_docs); every key-gated tool returns a structured
// AUTH_REQUIRED error pointing at https://dev-dashboard.floelabs.xyz
// instead of the process refusing to start.
export function loadConfig(): AppConfig {
  return {
    apiKey: process.env.FLOE_API_KEY || undefined,
    apiBaseUrl: process.env.FLOE_API_BASE_URL ?? 'https://credit-api.floelabs.xyz',
  };
}
