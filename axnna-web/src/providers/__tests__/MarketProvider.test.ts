import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwelveDataMarketProvider } from '../MarketProvider';

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

  it('successfully fetches and normalizes completed candles', async () => {
    const mockNow = new Date('2023-01-01T14:10:00Z').getTime();
    vi.setSystemTime(mockNow);

    const mockResponse = {
      status: 'ok',
      values: [
        { datetime: '2023-01-01 14:05:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' }, // completed
        { datetime: '2023-01-01 14:00:00', open: '1.0', high: '1.1', low: '0.9', close: '1.05' }  // completed
      ]
    };

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const candles = await provider.fetchCandles('EURUSD', '5M', 2);
    
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(candles.length).toBe(2);
    
    // Validates completion logic
    expect(candles[0].isCompleted).toBe(true);
    expect(candles[1].isCompleted).toBe(true);
    
    // Normalization check
    expect(candles[0].open).toBe(1.1);
    expect(candles[0].timestamp).toBe(new Date('2023-01-01T14:05:00Z').getTime());
  });

  it('marks forming candles as incomplete safely', async () => {
    const mockNow = new Date('2023-01-01T14:08:00Z').getTime(); // 14:05 candle is forming, completes at 14:10
    vi.setSystemTime(mockNow);

    const mockResponse = {
      status: 'ok',
      values: [
        { datetime: '2023-01-01 14:05:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' }, // forming!
        { datetime: '2023-01-01 14:00:00', open: '1.0', high: '1.1', low: '0.9', close: '1.05' }  // completed
      ]
    };

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const candles = await provider.fetchCandles('EURUSD', '5M', 2);
    
    expect(candles[0].isCompleted).toBe(false);
    expect(candles[1].isCompleted).toBe(true);
  });

  it('throws instantly on authentication failure without retries', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'error', code: 401, message: 'apikey is invalid' }),
    });

    await expect(provider.fetchCandles('EURUSD', '5M', 2)).rejects.toThrow('Authentication failure (Provider Code 401): apikey is invalid');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on rate limiting (HTTP 429)', async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', values: [{ datetime: '2023-01-01 14:00:00', open: '1', high: '2', low: '0', close: '1' }] }),
      });

    // We don't await immediately to allow timers to advance
    const fetchPromise = provider.fetchCandles('EURUSD', '5M', 1);
    
    // Advance exponential backoffs
    await vi.runAllTimersAsync();
    
    const candles = await fetchPromise;
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(candles.length).toBe(1);
  });

  it('throws after max retries for transient errors', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const fetchPromise = provider.fetchCandles('EURUSD', '5M', 1);
    fetchPromise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(fetchPromise).rejects.toThrow('Failed to fetch candles after 3 attempts');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('handles malformed responses cleanly', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }), // Missing values array
    });

    const fetchPromise = provider.fetchCandles('EURUSD', '5M', 1);
    fetchPromise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(fetchPromise).rejects.toThrow('Failed to fetch candles after 3 attempts');
  });
});
