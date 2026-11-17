import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MarketDataValidator, InternalCandle } from '../src/core-engine/MarketData';
import { FundamentalEngine } from '../src/engine/FundamentalEngine';
import worker, { Env } from '../src/worker';
import { createSqliteD1 } from './helpers/sqliteD1';

describe('Market Data Validation & Normalization', () => {
  it('sorts chronologically, filters forming candles, and preserves UTC timestamps', () => {
    const raw: Partial<InternalCandle>[] = [
      { symbol: 'EURUSD', timeframe: '5M', timestamp: 2000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
      { symbol: 'EURUSD', timeframe: '5M', timestamp: 3000, open: 1.11, high: 1.13, low: 1.10, close: 1.12, isCompleted: false, priceBasis: 'provider_ohlc_unspecified' },
      { symbol: 'EURUSD', timeframe: '5M', timestamp: 1000, open: 1.09, high: 1.11, low: 1.08, close: 1.10, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
    ];
    const res = MarketDataValidator.validateAndNormalize(raw);
    expect(res.valid).toBe(true);
    expect(res.candles.map((c) => c.timestamp)).toEqual([1000, 2000]);
  });

  it('rejects impossible OHLC relationships and duplicate timestamps', () => {
    const badOhlc = MarketDataValidator.validateAndNormalize([
      { symbol: 'EURUSD', timeframe: '5M', timestamp: 1000, open: 1.1, high: 1.05, low: 1.09, close: 1.1, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
    ]);
    expect(badOhlc.valid).toBe(false);

    const dup = MarketDataValidator.validateAndNormalize([
      { symbol: 'EURUSD', timeframe: '5M', timestamp: 1000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
      { symbol: 'EURUSD', timeframe: '5M', timestamp: 1000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
    ]);
    expect(dup.valid).toBe(false);
    expect(dup.error).toContain('Duplicate');
  });
});

describe('Macro Exposure, Caching & Fail-Closed Synchronization', () => {
  let env: Env;
  let sqlite: any;

  beforeEach(() => {
    const setup = createSqliteD1();
    sqlite = setup.sqlite;
    env = {
      DB: setup.db,
      TELEGRAM_BOT_TOKEN: '123:TEST',
      TWELVEDATA_API_KEY: '',
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps USD events across EURUSD, GBPUSD, USDJPY, and XAUUSD without mutating unrelated pairs', () => {
    const engine = new FundamentalEngine();
    const now = new Date('2026-11-17T12:00:00Z');
    const events = [
      {
        id: 'ev1',
        country: 'US',
        currency: 'USD',
        event: 'Non-Farm Payrolls',
        timestamp: '2026-11-17T12:10:00Z',
        importance: 'HIGH' as const,
        estimate: '180K',
        previous: '150K',
        actual: null,
        source: 'biquote',
      },
    ];

    for (const pair of ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']) {
      const ctx = engine.evaluateContext(pair, events, now);
      expect(ctx.eventRisk).toBe('EXTREME');
      expect(engine.getConfluence(ctx, 'LONG')).toBe('HIGH EVENT RISK');
    }

    const unrelated = engine.evaluateContext('EURGBP', events, now);
    expect(unrelated.eventRisk).toBe('NONE');
  });

  it('fails closed when TWELVEDATA_API_KEY is missing and preserves stale D1 state timestamps', async () => {
    sqlite
      .prepare(
        `INSERT INTO market_data_state (instrument, timeframe, provider, last_completed_candle, last_successful_fetch, status, error_count)
         VALUES ('EURUSD', '5M', 'twelvedata', '2026-11-17T11:55:00Z', '2026-11-17T11:56:00Z', 'HEALTHY', 0)`
      )
      .run();

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('biquote.io')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'mql5:1',
              time: '2026-11-17T15:00:00Z',
              countryCode: 'US',
              currency: 'USD',
              name: 'Retail Sales m/m',
              importance: 'high',
              actual: null,
              forecast: 0.3,
              previous: 0.2,
              source: 'mql5',
            },
          ],
        } as any;
      }
      throw new Error(`Unexpected external call to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await worker.runSynchronization(env);

    // TwelveData was never called; only economic calendar was fetched
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('biquote.io');

    // Economic calendar cached in D1
    const cached = sqlite.prepare(`SELECT event, currency FROM economic_events WHERE id = 'mql5:1'`).get() as any;
    expect(cached).toEqual({ event: 'Retail Sales m/m', currency: 'USD' });

    // Stale timestamps preserved, status marked FAILED, error_count incremented
    const state = sqlite
      .prepare(`SELECT status, error_count, last_completed_candle, last_successful_fetch FROM market_data_state WHERE instrument = 'EURUSD' AND timeframe = '5M'`)
      .get() as any;
    expect(state).toEqual({
      status: 'FAILED',
      error_count: 1,
      last_completed_candle: '2026-11-17T11:55:00Z',
      last_successful_fetch: '2026-11-17T11:56:00Z',
    });
  });

  it('handles economic calendar outage without crashing technical market synchronization', async () => {
    env.TWELVEDATA_API_KEY = 'valid_td_key';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('biquote.io') || url.includes('faireconomy')) {
        return { ok: false, status: 503 } as any;
      }
      return { ok: true, status: 200, json: async () => ({ status: 'ok', values: [] }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(worker.runSynchronization(env)).resolves.not.toThrow();
    const state = sqlite
      .prepare(`SELECT status FROM market_data_state WHERE instrument = 'EURUSD' AND timeframe = '5M'`)
      .get() as any;
    expect(state.status).toBe('FAILED');
  });
});
