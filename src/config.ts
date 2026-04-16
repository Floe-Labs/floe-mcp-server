export interface AppConfig {
  apiKey: string;
  apiBaseUrl: string;
}

export function loadConfig(): AppConfig {
  const apiKey = process.env.FLOE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'FLOE_API_KEY is required. Get one at https://dev-dashboard.floelabs.xyz\n' +
      'Set it as: FLOE_API_KEY=floe_live_...',
    );
  }

  return {
    apiKey,
    apiBaseUrl: process.env.FLOE_API_BASE_URL ?? 'https://credit-api.floelabs.xyz',
  };
}
