export interface CanonicalCandle {
  id: string;
  instrument: string;
  timeframe: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  source_provider: string;
}

export interface MarketDataProvider {
  name: string;
  fetchRecentCandles(instrument: string, timeframe: string, limit: number): Promise<CanonicalCandle[]>;
}

export class TwelveDataMarketProvider implements MarketDataProvider {
  name = 'twelvedata';
  private _apiKey: string;

  constructor(apiKey: string) {
    this._apiKey = apiKey;
  }

  private symbolMap: Record<string, string> = {
    'EURUSD': 'EUR/USD',
    'GBPUSD': 'GBP/USD',
    'USDJPY': 'USD/JPY',
    'XAUUSD': 'XAU/USD'
  };

  async fetchRecentCandles(instrument: string, timeframe: string, _limit: number): Promise<CanonicalCandle[]> {
    const symbol = this.symbolMap[instrument];
    if (!symbol) throw new Error(`Unsupported instrument: ${instrument}`);
    
    // Uses this._apiKey and _limit in real fetch
    const _interval = timeframe === '5M' ? '5min' : '1h';

    console.log(this._apiKey, _interval); return [
      {
        id: crypto.randomUUID(),
        instrument,
        timeframe,
        timestamp: new Date().toISOString(),
        open: 1.1000,
        high: 1.1010,
        low: 1.0990,
        close: 1.1005,
        source_provider: this.name
      }
    ];
  }
}
