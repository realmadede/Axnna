export interface SyncActionResult {
  status: 'SUCCEEDED' | 'DEGRADED' | 'FAILED' | 'ALREADY_RUNNING';
  summary?: string;
  error?: string;
}

export interface Env {
  DB: D1Database;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  ENVIRONMENT?: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TWELVEDATA_API_KEY: string;
  TIINGO_API_KEY?: string;
  FINNHUB_API_KEY?: string;
  BACKTEST_SECRET?: string;
  ACTOR_HASH_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

export const SUPPORTED_INSTRUMENTS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'] as const;
export type SupportedInstrument = (typeof SUPPORTED_INSTRUMENTS)[number];

export const SUPPORTED_TIMEFRAMES = ['5M', '1H'] as const;
export type SupportedTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

export const STATIC_FILE_EXT_PATTERN = /\.(?:js|mjs|css|png|jpg|jpeg|webp|ico|svg|json|txt|woff|woff2|map)$/i;

export function isSupportedInstrument(val: string): val is SupportedInstrument {
  return (SUPPORTED_INSTRUMENTS as readonly string[]).includes(val);
}

export function isSupportedTimeframe(val: string): val is SupportedTimeframe {
  return (SUPPORTED_TIMEFRAMES as readonly string[]).includes(val);
}
