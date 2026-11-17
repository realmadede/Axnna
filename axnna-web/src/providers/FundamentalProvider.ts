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

const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: 'US',
  EUR: 'EU',
  GBP: 'GB',
  JPY: 'JP',
};

function mapImportance(raw?: string | null): 'LOW' | 'MEDIUM' | 'HIGH' {
  const val = (raw || '').toLowerCase();
  if (val === 'high') return 'HIGH';
  if (val === 'medium') return 'MEDIUM';
  return 'LOW';
}

function toNullableString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

/**
 * Free-tier economic calendar provider requiring zero API keys.
 * Primary: biquote.io MQL5 calendar feed (includes actual, forecast, previous).
 * Fallback: FairEconomy weekly ForexFactory JSON feed.
 */
export class FreeEconomicCalendarProvider implements FundamentalDataProvider {
  name = 'biquote';
  private biquoteUrl = 'https://biquote.io/api/calendar';
  private fairEconomyUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

  async fetchUpcomingEvents(currency: string, _fromDate: string, _toDate: string): Promise<EconomicEvent[]> {
    const requestedCurrencies = currency
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);

    const countries = requestedCurrencies
      .map(c => CURRENCY_TO_COUNTRY[c])
      .filter(Boolean)
      .join(',') || 'US,EU,GB,JP';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${this.biquoteUrl}?countries=${countries}`, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data: unknown = await res.json();
        if (!Array.isArray(data)) return [];
        return this.normalizeBiquote(data);
      }
    } catch {
      // Fall through to FairEconomy backup
    }

    return await this.fetchFairEconomyFallback(requestedCurrencies);
  }

  private normalizeBiquote(rows: any[]): EconomicEvent[] {
    const events: EconomicEvent[] = [];
    for (const row of rows) {
      if (!row?.name || !row?.time || !row?.currency) continue;
      if ((row.importance || '').toLowerCase() === 'none') continue;

      const parsedDate = new Date(row.time);
      if (isNaN(parsedDate.getTime())) continue;

      events.push({
        id: String(row.id || row.eventId || `${row.currency}_${row.name}_${parsedDate.toISOString()}`),
        country: String(row.countryCode || row.currency),
        currency: String(row.currency).toUpperCase(),
        event: String(row.name),
        timestamp: parsedDate.toISOString(),
        importance: mapImportance(row.importance),
        estimate: toNullableString(row.forecast),
        previous: toNullableString(row.previous ?? row.revisedPrevious),
        actual: toNullableString(row.actual),
        source: String(row.source || 'biquote'),
      });
    }
    return events;
  }

  private async fetchFairEconomyFallback(currencies: string[]): Promise<EconomicEvent[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(this.fairEconomyUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Free calendar fallback failed with HTTP ${res.status}`);
    }

    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];

    const allowAll = currencies.length === 0 || currencies.includes('ALL');
    const events: EconomicEvent[] = [];

    for (const row of data as any[]) {
      const ccy = String(row?.country || '').toUpperCase();
      if (!ccy || (!allowAll && !currencies.includes(ccy))) continue;
      if (!row?.title || !row?.date) continue;
      const impact = String(row.impact || '').toLowerCase();
      if (impact === 'holiday' || impact === 'non-economic') continue;

      const parsedDate = new Date(row.date);
      if (isNaN(parsedDate.getTime())) continue;

      events.push({
        id: `ff_${ccy}_${row.title}_${parsedDate.toISOString()}`,
        country: ccy,
        currency: ccy,
        event: String(row.title),
        timestamp: parsedDate.toISOString(),
        importance: mapImportance(row.impact),
        estimate: toNullableString(row.forecast),
        previous: toNullableString(row.previous),
        actual: null,
        source: 'faireconomy',
      });
    }

    return events;
  }
}
