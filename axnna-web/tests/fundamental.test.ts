import { describe, it, expect, vi, afterEach } from 'vitest';
import { FundamentalEngine } from '../src/engine/FundamentalEngine';
import { EconomicEvent, FreeEconomicCalendarProvider } from '../src/providers/FundamentalProvider';

describe('FundamentalEngine', () => {
  const engine = new FundamentalEngine();

  const createEvent = (
    id: string,
    event: string,
    currency: string,
    importance: 'LOW' | 'MEDIUM' | 'HIGH',
    timestamp: string,
    estimate: string | null = null,
    actual: string | null = null
  ): EconomicEvent => ({
    id,
    country: 'US', // default
    currency,
    event,
    timestamp,
    importance,
    estimate,
    actual,
    previous: null,
    source: 'test'
  });

  it('calculates EXTREME event risk for upcoming high impact event within 15 minutes', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const upcoming = createEvent('1', 'Core CPI m/m', 'USD', 'HIGH', '2026-10-06T12:10:00Z');
    
    const context = engine.evaluateContext('EURUSD', [upcoming], now);
    
    expect(context.eventRisk).toBe('EXTREME');
    expect(context.upcomingHighImpactEvent?.id).toBe('1');
  });

  it('calculates fundamental bias for EURUSD given strong US CPI', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    
    // US CPI is stronger than expected (actual > estimate)
    const pastUsdEvent = createEvent('2', 'Core CPI m/m', 'USD', 'HIGH', '2026-10-06T10:00:00Z', '0.2', '0.5');
    
    const context = engine.evaluateContext('EURUSD', [pastUsdEvent], now);
    
    // Strong US data is BEARISH for EURUSD -> Score should be negative
    expect(context.fundamentalScore).toBeLessThan(0);
    expect(context.macroRegime).toBe('HAWKISH');
  });

  it('calculates confluence correctly', () => {
    // Strongly bullish EURUSD context
    const now = new Date('2026-10-06T12:00:00Z');
    const weakUsdEvent = createEvent('3', 'Core CPI m/m', 'USD', 'HIGH', '2026-10-06T10:00:00Z', '2.0', '0.1'); // US data weak -> EURUSD bullish
    const context = engine.evaluateContext('EURUSD', [weakUsdEvent], now);

    expect(context.fundamentalScore).toBeGreaterThan(0);

    const confluenceLong = engine.getConfluence(context, 'LONG');
    expect(['STRONG ALIGNMENT', 'MODERATE ALIGNMENT']).toContain(confluenceLong);

    const confluenceShort = engine.getConfluence(context, 'SHORT');
    expect(confluenceShort).toBe('CONFLICT');
  });

  it('blocks setups (HIGH EVENT RISK) if event is imminent', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const imminentUsdEvent = createEvent('4', 'NFP', 'USD', 'HIGH', '2026-10-06T12:05:00Z'); 
    const context = engine.evaluateContext('GBPUSD', [imminentUsdEvent], now);

    const confluence = engine.getConfluence(context, 'LONG');
    expect(confluence).toBe('HIGH EVENT RISK');
  });
});

describe('FreeEconomicCalendarProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes biquote free calendar payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 'mql5:101',
          time: '2026-11-17T13:30:00Z',
          countryCode: 'US',
          currency: 'USD',
          name: 'Core CPI m/m',
          importance: 'high',
          actual: 0.3,
          forecast: 0.2,
          previous: 0.1,
          source: 'mql5',
        },
        {
          id: 'mql5:102',
          time: '2026-11-17T14:00:00Z',
          countryCode: 'US',
          currency: 'USD',
          name: 'Minor Notice',
          importance: 'none',
          actual: null,
          forecast: null,
          previous: null,
        }
      ])
    }));

    const provider = new FreeEconomicCalendarProvider();
    const events = await provider.fetchUpcomingEvents('USD,EUR', 'today', 'tomorrow');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'mql5:101',
      country: 'US',
      currency: 'USD',
      event: 'Core CPI m/m',
      importance: 'HIGH',
      estimate: '0.2',
      previous: '0.1',
      actual: '0.3',
      source: 'mql5',
    });
  });

  it('falls back to FairEconomy feed when primary fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          {
            title: 'Non-Farm Employment Change',
            country: 'USD',
            date: '2026-11-17T08:30:00-05:00',
            impact: 'High',
            forecast: '180K',
            previous: '150K',
          },
          {
            title: 'Bank Holiday',
            country: 'JPY',
            date: '2026-11-17T00:00:00-05:00',
            impact: 'Holiday',
            forecast: '',
            previous: '',
          }
        ])
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new FreeEconomicCalendarProvider();
    const events = await provider.fetchUpcomingEvents('USD,JPY', 'today', 'tomorrow');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      currency: 'USD',
      event: 'Non-Farm Employment Change',
      importance: 'HIGH',
      estimate: '180K',
      previous: '150K',
      actual: null,
      source: 'faireconomy',
    });
  });
});
