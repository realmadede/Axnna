import { InternalCandle, IMarketDataProvider } from '../core-engine/MarketData';

export class TwelveDataMarketProvider implements IMarketDataProvider {
  name = 'twelvedata';
  private _apiKey: string;
  private _baseUrl = 'https://api.twelvedata.com/time_series';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("TwelveData API key is required");
    }
    this._apiKey = apiKey;
  }

  getProviderName(): string {
    return this.name;
  }

  private symbolMap: Record<string, string> = {
    'EURUSD': 'EUR/USD',
    'GBPUSD': 'GBP/USD',
    'USDJPY': 'USD/JPY',
    'XAUUSD': 'XAU/USD'
  };

  async fetchCandles(instrument: string, timeframe: string, limit: number): Promise<InternalCandle[]> {
    const symbol = this.symbolMap[instrument];
    if (!symbol) throw new Error(`Unsupported instrument: ${instrument}`);
    
    // Twelve Data specific intervals
    const interval = timeframe === '5M' ? '5min' : timeframe === '1H' ? '1h' : timeframe;
    const timeframeMs = timeframe === '5M' ? 5 * 60 * 1000 : timeframe === '1H' ? 60 * 60 * 1000 : 0;
    
    if (timeframeMs === 0) {
      throw new Error(`Unsupported timeframe for completion check: ${timeframe}`);
    }

    const url = `${this._baseUrl}?symbol=${symbol}&interval=${interval}&outputsize=${limit}&apikey=${this._apiKey}&timezone=UTC&format=JSON`;

    // Implement bounded retries for transient errors
    let attempt = 0;
    const maxAttempts = 3;
    let lastError: Error | null = null;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000); // 8 second timeout
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.status === 429) {
          // Rate limit hit
          throw new Error(`Rate limit exceeded (HTTP 429)`);
        }

        if (response.status === 401 || response.status === 403) {
           throw new Error(`Authentication failure (HTTP Error ${response.status})`);
        }
        if (!response.ok) {
           throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
        }

        const data: any = await response.json();

        if (data.status === 'error') {
           // Provider error payload
           if (data.code === 401 || data.code === 403) {
             throw new Error(`Authentication failure (Provider Code ${data.code}): ${data.message}`);
           }
           throw new Error(`Provider Error (Code ${data.code}): ${data.message}`);
        }

        if (!data.values || !Array.isArray(data.values)) {
          throw new Error('Malformed provider response: missing values array');
        }

        const now = Date.now();
        const candles: InternalCandle[] = data.values.map((v: any) => {
          // TwelveData dates are in exchange timezone normally. If we request standard, we need to be careful.
          // Twelve Data returns datetime as a string like "2021-09-16 13:55:00". By default this is UTC if we specify `timezone=UTC`.
          // Let's add `&timezone=UTC` to the URL. (Wait, let's just parse it as UTC).
          const dateStr = v.datetime.replace(' ', 'T') + 'Z'; 
          const timestamp = new Date(dateStr).getTime();

          // A candle is completed if the current time is strictly greater than or equal to the start of the next candle
          const isCompleted = now >= (timestamp + timeframeMs);

          return {
            symbol: instrument, // Use our internal identifier
            timeframe,
            timestamp,
            open: parseFloat(v.open),
            high: parseFloat(v.high),
            low: parseFloat(v.low),
            close: parseFloat(v.close),
            isCompleted,
            priceBasis: 'provider_ohlc_unspecified' // Twelve Data /time_series doesn't definitively document bid vs midpoint for standard queries
          };
        });

        // Values come ordered descending (newest first). We don't sort here, MarketDataValidator handles normalization and sorting.
        return candles;

      } catch (err: any) {
        lastError = err;
        
        // Don't retry authentication errors or explicit provider configuration errors
        if (err.message.includes('Authentication failure') || err.message.includes('Unsupported')) {
          break; 
        }

        if (attempt < maxAttempts) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    throw new Error(`Failed to fetch candles after ${maxAttempts} attempts. Last error: ${lastError?.message}`);
  }

  async fetchCandlesChunked(instrument: string, timeframe: string, totalLimit: number): Promise<InternalCandle[]> {
    let allCandles: InternalCandle[] = [];
    let currentEndDate: Date | undefined = undefined;
    const chunkSize = 5000;
    
    while (allCandles.length < totalLimit) {
        const fetchSize = Math.min(chunkSize, totalLimit - allCandles.length);
        const symbol = this.symbolMap[instrument] || instrument;
        
        const interval = timeframe === '5M' ? '5min' : timeframe === '1H' ? '1h' : timeframe;
        let url = `${this._baseUrl}?symbol=${symbol}&interval=${interval}&outputsize=${fetchSize}&apikey=${this._apiKey}`;
        if (currentEndDate) {
            // Format as YYYY-MM-DD HH:MM:SS in UTC for Twelve Data
            const iso = currentEndDate.toISOString();
            const end_date = iso.replace('T', ' ').substring(0, 19);
            url += `&end_date=${end_date}`;
        }
        
        let attempts = 0;
        let success = false;
        
        while (attempts < 3 && !success) {
            attempts++;
            try {
                const response = await fetch(url);
                if (response.status === 429) {
                    await new Promise(r => setTimeout(r, 60000));
                    continue;
                }
                if (response.status === 401 || response.status === 403) {
                    throw new Error(`Authentication failure (HTTP Error ${response.status})`);
                }
                if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
                
                const data: any = await response.json();
                if (data.status === 'error') throw new Error(data.message);
                if (!data.values || data.values.length === 0) {
                    // No more historical data available
                    return allCandles;
                }
                
                const now = Date.now();
                const timeframeMs = timeframe === '5M' ? 5*60*1000 : 60*60*1000;
                
                const chunkCandles: InternalCandle[] = data.values.map((v: any) => {
                    const dateStr = v.datetime.replace(' ', 'T') + 'Z'; 
                    const timestamp = new Date(dateStr).getTime();
                    return {
                        symbol: instrument,
                        timeframe,
                        timestamp,
                        open: parseFloat(v.open),
                        high: parseFloat(v.high),
                        low: parseFloat(v.low),
                        close: parseFloat(v.close),
                        isCompleted: now >= (timestamp + timeframeMs),
                        priceBasis: 'provider_ohlc_unspecified'
                    };
                });
                
                allCandles = [...allCandles, ...chunkCandles];
                
                // Prepare for next chunk (next end_date is the oldest timestamp we got)
                const oldestTimestamp = chunkCandles[chunkCandles.length - 1].timestamp;
                currentEndDate = new Date(oldestTimestamp - timeframeMs);
                success = true;
                
                // Add a small delay to avoid triggering rate limits aggressively
                await new Promise(r => setTimeout(r, 8000));
            } catch (err: any) {
                if (err.message.includes('Authentication failure')) throw err;
                if (attempts >= 3) throw err;
                await new Promise(r => setTimeout(r, attempts * 5000));
            }
        }
    }
    
    return allCandles;
  }
}
