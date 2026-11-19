import { InternalCandle, IMarketDataProvider } from '../core-engine/MarketData';

const PLACEHOLDER_KEYS = new Set(['mock_key', 'your_twelvedata_key_here', 'your_tiingo_key_here']);

function normalizeApiKey(apiKey: string, missingError: string): string {
  const normalized = (apiKey || '').trim();
  if (!normalized || PLACEHOLDER_KEYS.has(normalized)) {
    throw new Error(missingError);
  }
  return normalized;
}

function getTimeframeMs(timeframe: string, contextLabel: string): number {
  if (timeframe === '5M') return 5 * 60 * 1000;
  if (timeframe === '1H') return 60 * 60 * 1000;
  throw new Error(`Unsupported timeframe for ${contextLabel}: ${timeframe}`);
}

function throwForHttpStatus(response: Response): void {
  if (response.status === 429) {
    throw new Error('Rate limit exceeded (HTTP 429)');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Authentication failure (HTTP Error ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
  }
}

function isNonRetriableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('Authentication failure') || msg.includes('Unsupported');
}

interface TwelveDataCandleRow {
  datetime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
}

interface TwelveDataResponse {
  status?: string;
  code?: number;
  message?: string;
  values?: TwelveDataCandleRow[];
}

function mapTwelveDataRows(
  rows: TwelveDataCandleRow[],
  instrument: string,
  timeframe: string,
  timeframeMs: number,
  nowMs: number
): InternalCandle[] {
  return rows.map((v) => {
    if (!v || typeof v.datetime !== 'string') {
      throw new Error('Malformed provider response: candle missing datetime');
    }
    const dateStr = `${v.datetime.replace(' ', 'T')}Z`;
    const timestamp = new Date(dateStr).getTime();
    if (isNaN(timestamp)) {
      throw new Error(`Malformed provider response: invalid datetime ${v.datetime}`);
    }
    return {
      symbol: instrument,
      timeframe,
      timestamp,
      open: parseFloat(String(v.open)),
      high: parseFloat(String(v.high)),
      low: parseFloat(String(v.low)),
      close: parseFloat(String(v.close)),
      isCompleted: nowMs >= timestamp + timeframeMs,
      priceBasis: 'provider_ohlc_unspecified',
    };
  });
}

export class TwelveDataMarketProvider implements IMarketDataProvider {
  name = 'twelvedata';
  private _apiKey: string;
  private _baseUrl = 'https://api.twelvedata.com/time_series';

  constructor(apiKey: string) {
    this._apiKey = normalizeApiKey(apiKey, 'TwelveData API key is required');
  }

  getProviderName(): string {
    return this.name;
  }

  private symbolMap: Record<string, string> = {
    EURUSD: 'EUR/USD',
    GBPUSD: 'GBP/USD',
    USDJPY: 'USD/JPY',
    XAUUSD: 'XAU/USD',
  };

  async fetchCandles(instrument: string, timeframe: string, limit: number): Promise<InternalCandle[]> {
    const symbol = this.symbolMap[instrument];
    if (!symbol) throw new Error(`Unsupported instrument: ${instrument}`);

    const timeframeMs = getTimeframeMs(timeframe, 'completion check');
    const interval = timeframe === '5M' ? '5min' : '1h';
    const url = `${this._baseUrl}?symbol=${symbol}&interval=${interval}&outputsize=${limit}&apikey=${this._apiKey}&timezone=UTC&format=JSON`;

    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        throwForHttpStatus(response);

        const data = (await response.json()) as TwelveDataResponse;
        if (data.status === 'error') {
          if (data.code === 401 || data.code === 403) {
            throw new Error(`Authentication failure (Provider Code ${data.code}): ${data.message}`);
          }
          throw new Error(`Provider Error (Code ${data.code}): ${data.message}`);
        }

        if (!data.values || !Array.isArray(data.values)) {
          throw new Error('Malformed provider response: missing values array');
        }

        return mapTwelveDataRows(data.values, instrument, timeframe, timeframeMs, Date.now());
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (isNonRetriableError(lastError)) break;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    throw new Error(`Failed to fetch candles after ${maxAttempts} attempts. Last error: ${lastError?.message}`);
  }

  async fetchCandlesChunked(instrument: string, timeframe: string, totalLimit: number): Promise<InternalCandle[]> {
    let allCandles: InternalCandle[] = [];
    let currentEndDate: Date | undefined;
    const chunkSize = 5000;
    const timeframeMs = getTimeframeMs(timeframe, 'chunked fetch');
    const symbol = this.symbolMap[instrument];
    if (!symbol) throw new Error(`Unsupported instrument: ${instrument}`);
    const interval = timeframe === '5M' ? '5min' : '1h';

    while (allCandles.length < totalLimit) {
      const fetchSize = Math.min(chunkSize, totalLimit - allCandles.length);
      let url = `${this._baseUrl}?symbol=${symbol}&interval=${interval}&outputsize=${fetchSize}&apikey=${this._apiKey}&timezone=UTC&format=JSON`;
      if (currentEndDate) {
        const endDateStr = currentEndDate.toISOString().replace('T', ' ').substring(0, 19);
        url += `&end_date=${endDateStr}`;
      }

      let success = false;
      let lastError: Error | null = null;

      for (let attempts = 1; attempts <= 3 && !success; attempts++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);

          throwForHttpStatus(response);

          const data = (await response.json()) as TwelveDataResponse;
          if (data.status === 'error') {
            if (data.code === 401 || data.code === 403) {
              throw new Error(`Authentication failure (Provider Code ${data.code}): ${data.message}`);
            }
            throw new Error(data.message || 'Provider error');
          }
          if (!data.values || !Array.isArray(data.values) || data.values.length === 0) {
            return allCandles;
          }

          const chunkCandles = mapTwelveDataRows(data.values, instrument, timeframe, timeframeMs, Date.now());
          allCandles = [...allCandles, ...chunkCandles];
          const oldestTimestamp = chunkCandles[chunkCandles.length - 1].timestamp;
          currentEndDate = new Date(oldestTimestamp - timeframeMs);
          success = true;

          if (allCandles.length < totalLimit) {
            await new Promise((r) => setTimeout(r, 8000));
          }
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (isNonRetriableError(lastError)) throw lastError;
          if (attempts < 3) {
            const backoffMs = lastError.message.includes('429') ? 60000 : attempts * 5000;
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }
      }

      if (!success) {
        throw new Error(`Failed chunked fetch after 3 attempts: ${lastError?.message || 'Unknown error'}`);
      }
    }

    return allCandles;
  }
}

interface TiingoCandleRow {
  date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
}

export class TiingoMarketProvider implements IMarketDataProvider {
  name = 'tiingo';
  private _apiKey: string;
  private _baseUrl = 'https://api.tiingo.com/tiingo/fx';

  constructor(apiKey: string) {
    this._apiKey = normalizeApiKey(apiKey, 'Tiingo API key is required');
  }

  getProviderName(): string {
    return this.name;
  }

  private symbolMap: Record<string, string> = {
    EURUSD: 'eurusd',
    GBPUSD: 'gbpusd',
    USDJPY: 'usdjpy',
    XAUUSD: 'xauusd',
  };

  async fetchCandles(instrument: string, timeframe: string, limit: number): Promise<InternalCandle[]> {
    const ticker = this.symbolMap[instrument];
    if (!ticker) throw new Error(`Unsupported instrument: ${instrument}`);

    const timeframeMs = getTimeframeMs(timeframe, 'completion check');
    const resampleFreq = timeframe === '5M' ? '5min' : '1hour';

    // Bound lookback to preserve Tiingo free tier 1 GB/month bandwidth while surviving weekend closes
    const lookbackMs = Math.max(limit * timeframeMs + 56 * 3_600_000, 72 * 3_600_000);
    const startDate = new Date(Date.now() - lookbackMs).toISOString().slice(0, 10);
    const url = `${this._baseUrl}/${ticker}/prices?startDate=${startDate}&resampleFreq=${resampleFreq}`;

    const maxAttempts = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Token ${this._apiKey}`,
          },
        });
        clearTimeout(timeout);

        throwForHttpStatus(response);

        const data = (await response.json()) as unknown;
        if (!Array.isArray(data)) {
          throw new Error('Malformed provider response: expected array of candles');
        }

        const nowMs = Date.now();
        const sliceStart = limit > 0 && data.length > limit ? data.length - limit : 0;
        const rows = (data as TiingoCandleRow[]).slice(sliceStart);

        return rows.map((v) => {
          if (!v || typeof v.date !== 'string') {
            throw new Error('Malformed provider response: candle missing date');
          }
          const timestamp = new Date(v.date).getTime();
          if (isNaN(timestamp)) {
            throw new Error(`Malformed provider response: invalid date ${v.date}`);
          }
          return {
            symbol: instrument,
            timeframe,
            timestamp,
            open: Number(v.open),
            high: Number(v.high),
            low: Number(v.low),
            close: Number(v.close),
            isCompleted: nowMs >= timestamp + timeframeMs,
            priceBasis: 'provider_ohlc_unspecified',
          };
        });
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (isNonRetriableError(lastError)) break;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    throw new Error(`Failed to fetch Tiingo candles after ${maxAttempts} attempts. Last error: ${lastError?.message}`);
  }
}
