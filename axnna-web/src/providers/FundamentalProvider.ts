export interface EconomicEvent {
  id: string;
  country: string;
  currency: string;
  event: string;
  timestamp: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  estimate: string | null;
  previous: string | null;
  actual: string | null;
  source: string;
}

export interface FundamentalDataProvider {
  name: string;
  fetchUpcomingEvents(currency: string, fromDate: string, toDate: string): Promise<EconomicEvent[]>;
}

export class FinnhubFundamentalProvider implements FundamentalDataProvider {
  name = 'finnhub';
  private _apiKey: string;

  constructor(apiKey: string) {
    this._apiKey = apiKey;
  }

  async fetchUpcomingEvents(_currency: string, _fromDate: string, _toDate: string): Promise<EconomicEvent[]> {
    console.log(this._apiKey, _currency, _fromDate, _toDate); return [
      {
        id: crypto.randomUUID(),
        country: 'US',
        currency: 'USD',
        event: 'Core CPI m/m',
        timestamp: new Date().toISOString(),
        importance: 'HIGH',
        estimate: '0.2%',
        previous: '0.1%',
        actual: null,
        source: this.name
      }
    ];
  }
}
