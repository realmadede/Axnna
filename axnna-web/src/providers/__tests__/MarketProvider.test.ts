import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TiingoMarketProvider, TwelveDataMarketProvider } from '../MarketProvider';
import { MarketDataValidator } from '../../core-engine/MarketData';

describe('TwelveDataMarketProvider', () => {
  let provider: TwelveDataMarketProvider;

  beforeEach(() => {
    provider = new TwelveDataMarketProvider('fake_api_key');
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('rejects missing, whitespace, or placeholder API keys', () => {
    expect(() => new TwelveDataMarketProvider('')).toThrow('TwelveData API key is required');
    expect(() => new TwelveDataMarketProvider('   ')).toThrow('TwelveData API key is required');
    expect(() => new TwelveDataMarketProvider('mock_key')).toThrow('TwelveData API key is required');
    expect(() => new TwelveDataMarketProvider('your_twelvedata_key_here')).toThrow('TwelveData API key is required');
  });

  it('successfully fetches and normalizes completed candles', async () => {
    const mockNow = new Date('2023-01-01T14:10:00Z').getTime();
    vi.setSystemTime(mockNow);

    const mockResponse = {
      status: 'ok',
      values: [
        { datetime: '2023-01-01 14:05:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' },
        { datetime: '2023-01-01 14:00:00', open: '1.0', high: '1.1', low: '0.9', close: '1.05' },
      ],
    };

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const candles = await provider.fetchCandles('EURUSD', '5M', 2);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(candles).toHaveLength(2);
    expect(candles[0].isCompleted).toBe(true);
    expect(candles[1].isCompleted).toBe(true);
    expect(candles[0].open).toBe(1.1);
    expect(candles[0].timestamp).toBe(new Date('2023-01-01T14:05:00Z').getTime());
  });

  it('marks forming candles as incomplete and filters them via MarketDataValidator', async () => {
    const mockNow = new Date('2023-01-01T14:08:00Z').getTime();
    vi.setSystemTime(mockNow);

    const mockResponse = {
      status: 'ok',
      values: [
        { datetime: '2023-01-01 14:05:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' },
        { datetime: '2023-01-01 14:00:00', open: '1.0', high: '1.1', low: '0.9', close: '1.05' },
      ],
    };

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const candles = await provider.fetchCandles('EURUSD', '5M', 2);
    expect(candles[0].isCompleted).toBe(false);
    expect(candles[1].isCompleted).toBe(true);

    const validated = MarketDataValidator.validateAndNormalize(candles);
    expect(validated.valid).toBe(true);
    expect(validated.candles).toHaveLength(1);
  });

  it('throws instantly on HTTP 401, HTTP 403, and provider code 401 without retries', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });
    await expect(provider.fetchCandles('EURUSD', '5M', 2)).rejects.toThrow('Authentication failure (HTTP Error 401)');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    (globalThis.fetch as any).mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' });
    await expect(provider.fetchCandles('EURUSD', '5M', 2)).rejects.toThrow('Authentication failure (HTTP Error 403)');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'error', code: 401, message: 'apikey is invalid' }),
    });
    await expect(provider.fetchCandles('EURUSD', '5M', 2)).rejects.toThrow('Authentication failure (Provider Code 401)');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on rate limiting (HTTP 429) and handles network timeout errors', async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          values: [{ datetime: '2023-01-01 14:00:00', open: '1', high: '2', low: '0.5', close: '1.5' }],
        }),
      });

    const fetchPromise = provider.fetchCandles('EURUSD', '5M', 1);
    await vi.runAllTimersAsync();

    const candles = await fetchPromise;
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(candles).toHaveLength(1);
  });

  it('throws after max retries for transient HTTP 500, invalid JSON, and malformed candle fields', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const p1 = provider.fetchCandles('EURUSD', '5M', 1);
    p1.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p1).rejects.toThrow('Failed to fetch candles after 3 attempts');

    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    const p2 = provider.fetchCandles('EURUSD', '5M', 1);
    p2.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p2).rejects.toThrow('Failed to fetch candles after 3 attempts');

    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', values: [{ open: '1.1' }] }),
    });
    const p3 = provider.fetchCandles('EURUSD', '5M', 1);
    p3.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p3).rejects.toThrow('candle missing datetime');
  });

  it('handles empty responses, duplicate timestamps, and out-of-order candles through validator', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', values: [] }),
    });
    const emptyCandles = await provider.fetchCandles('EURUSD', '5M', 5);
    expect(emptyCandles).toEqual([]);
    expect(MarketDataValidator.validateAndNormalize(emptyCandles).valid).toBe(false);

    vi.setSystemTime(new Date('2023-01-01T15:00:00Z').getTime());
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        values: [
          { datetime: '2023-01-01 14:00:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' },
          { datetime: '2023-01-01 14:05:00', open: '1.15', high: '1.25', low: '1.05', close: '1.2' },
        ],
      }),
    });
    const outOfOrder = await provider.fetchCandles('EURUSD', '5M', 2);
    const normalized = MarketDataValidator.validateAndNormalize(outOfOrder);
    expect(normalized.valid).toBe(true);
    expect(normalized.candles[0].timestamp).toBeLessThan(normalized.candles[1].timestamp);

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        values: [
          { datetime: '2023-01-01 14:00:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' },
          { datetime: '2023-01-01 14:00:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' },
        ],
      }),
    });
    const dupCandles = await provider.fetchCandles('EURUSD', '5M', 2);
    expect(MarketDataValidator.validateAndNormalize(dupCandles).valid).toBe(false);
  });

  it('supports chunked historical fetching, partial responses, and throws on exhausted chunked 429 retries', async () => {
    vi.setSystemTime(new Date('2023-01-10T00:00:00Z').getTime());

    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          values: Array.from({ length: 5000 }, (_, idx) => ({
            datetime: new Date(Date.UTC(2023, 0, 9, 0, 0, 0) - idx * 300000).toISOString().replace('T', ' ').slice(0, 19),
            open: '1.1',
            high: '1.2',
            low: '1.0',
            close: '1.15',
          })),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          values: [], // partial historical end
        }),
      });

    const chunkPromise = provider.fetchCandlesChunked('EURUSD', '5M', 6000);
    await vi.runAllTimersAsync();
    const all = await chunkPromise;
    expect(all).toHaveLength(5000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // Exhausted 429 throws explicitly instead of looping or returning silently
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' });
    const failChunkPromise = provider.fetchCandlesChunked('EURUSD', '5M', 100);
    failChunkPromise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(failChunkPromise).rejects.toThrow('Failed chunked fetch after 3 attempts');
  });
});

describe('TiingoMarketProvider', () => {
  let provider: TiingoMarketProvider;

  beforeEach(() => {
    provider = new TiingoMarketProvider('fake_tiingo_token');
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('rejects missing, whitespace, or placeholder API keys', () => {
    expect(() => new TiingoMarketProvider('')).toThrow('Tiingo API key is required');
    expect(() => new TiingoMarketProvider('   ')).toThrow('Tiingo API key is required');
    expect(() => new TiingoMarketProvider('mock_key')).toThrow('Tiingo API key is required');
    expect(() => new TiingoMarketProvider('your_tiingo_key_here')).toThrow('Tiingo API key is required');
  });

  it('fetches XAUUSD 1H and EURUSD 5M bars with Token auth header and bounded limit', async () => {
    const mockNow = new Date('2026-11-17T12:08:00.000Z').getTime();
    vi.setSystemTime(mockNow);

    const tiingoRows = [
      { date: '2026-11-17T11:55:00.000Z', open: 1.09, high: 1.092, low: 1.089, close: 1.091 },
      { date: '2026-11-17T12:00:00.000Z', open: 1.091, high: 1.093, low: 1.09, close: 1.092 },
      { date: '2026-11-17T12:05:00.000Z', open: 1.092, high: 1.094, low: 1.091, close: 1.093 },
    ];

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => tiingoRows,
    });

    const candles = await provider.fetchCandles('EURUSD', '5M', 2);
    expect(candles).toHaveLength(2);
    expect(candles[0].isCompleted).toBe(true);
    expect(candles[1].isCompleted).toBe(false);
    expect(candles[0].timestamp).toBe(new Date('2026-11-17T12:00:00.000Z').getTime());

    const [calledUrl, init] = (globalThis.fetch as any).mock.calls[0];
    expect(calledUrl).toContain('https://api.tiingo.com/tiingo/fx/eurusd/prices?startDate=');
    expect(calledUrl).toContain('resampleFreq=5min');
    expect(init.headers.Authorization).toBe('Token fake_tiingo_token');

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ date: '2026-11-17T10:00:00.000Z', open: 2610, high: 2615, low: 2608, close: 2612 }],
    });
    const xau = await provider.fetchCandles('XAUUSD', '1H', 10);
    expect(xau).toHaveLength(1);
    expect((globalThis.fetch as any).mock.calls[1][0]).toContain('/tiingo/fx/xauusd/prices');
    expect((globalThis.fetch as any).mock.calls[1][0]).toContain('resampleFreq=1hour');
  });

  it('does not retry authentication failures', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(provider.fetchCandles('GBPUSD', '5M', 10)).rejects.toThrow('Authentication failure (HTTP Error 401)');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
