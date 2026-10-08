export interface InternalCandle {
  symbol: string;
  timeframe: string;
  timestamp: number; // Use Unix epoch milliseconds for easy comparison
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  isCompleted: boolean;
  priceBasis: 'provider_ohlc_unspecified' | 'midpoint' | 'bid' | 'ask' | 'trade' | 'unknown';
}

export class DataQualityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataQualityError';
  }
}

export interface MarketDataValidatorResult {
  valid: boolean;
  candles: InternalCandle[];
  error?: string;
}

export class MarketDataValidator {
  /**
   * Normalizes and validates candles.
   * Ensures chronologically ordered, no duplicates, no missing/impossible OHLC, and removes forming candles.
   */
  static validateAndNormalize(
    rawCandles: Partial<InternalCandle>[]
  ): MarketDataValidatorResult {
    if (!rawCandles || rawCandles.length === 0) {
      return { valid: false, candles: [], error: 'No candles provided' };
    }

    const processed: InternalCandle[] = [];
    const seenTimestamps = new Set<number>();

    // Basic structural and OHLC validation
    for (const raw of rawCandles) {
      if (
        raw.symbol === undefined ||
        raw.timeframe === undefined ||
        raw.timestamp === undefined ||
        raw.open === undefined ||
        raw.high === undefined ||
        raw.low === undefined ||
        raw.close === undefined ||
        raw.isCompleted === undefined
      ) {
        return { valid: false, candles: [], error: 'Malformed candle data missing required fields' };
      }

      if (
        isNaN(raw.open) || isNaN(raw.high) || isNaN(raw.low) || isNaN(raw.close) ||
        raw.open <= 0 || raw.high <= 0 || raw.low <= 0 || raw.close <= 0
      ) {
        return { valid: false, candles: [], error: 'Invalid OHLC values (zero or negative)' };
      }

      if (raw.high < raw.low || raw.high < Math.max(raw.open, raw.close) || raw.low > Math.min(raw.open, raw.close)) {
        return { valid: false, candles: [], error: 'Impossible OHLC relationships detected' };
      }

      if (!raw.isCompleted) {
        // Skip currently forming candles explicitly
        continue;
      }

      if (seenTimestamps.has(raw.timestamp)) {
        return { valid: false, candles: [], error: 'Duplicate candles detected' };
      }

      seenTimestamps.add(raw.timestamp);
      processed.push(raw as InternalCandle);
    }

    // Sort chronologically
    processed.sort((a, b) => a.timestamp - b.timestamp);

    if (processed.length === 0) {
      return { valid: false, candles: [], error: 'No completed candles available for analysis' };
    }

    return { valid: true, candles: processed };
  }
}

export interface IMarketDataProvider {
  getProviderName(): string;
  fetchCandles(symbol: string, timeframe: string, limit: number): Promise<InternalCandle[]>;
}
