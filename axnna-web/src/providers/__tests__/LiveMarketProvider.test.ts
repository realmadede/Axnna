import { describe, it, expect } from 'vitest';
import { TwelveDataMarketProvider } from '../MarketProvider';
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.dev.vars');
if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
        const [key, ...rest] = line.split('=');
        if (key && rest.length > 0) {
            process.env[key.trim()] = rest.join('=').replace(/^["']|["']$/g, '').trim();
        }
    }
}

describe('LiveMarketProvider Verification', () => {
  it('loads the key from environment, successfully authenticates, and normalizes', async () => {
    const key = process.env.TWELVEDATA_API_KEY;
    expect(key).toBeDefined();
    
    if (key === 'THE_NEW_KEY') {
        console.warn('Skipping live test because key is placeholder');
        return;
    }

    if (!key) throw new Error("Key not found in .dev.vars");

    const provider = new TwelveDataMarketProvider(key);
    
    // Fetch a very small sample to verify authentication and normalization
    const candles = await provider.fetchCandles('EURUSD', '5M', 2);
    
    expect(candles.length).toBeGreaterThan(0);
    expect(candles[0].priceBasis).toBe('provider_ohlc_unspecified');
    expect(candles[0].open).toBeTypeOf('number');
    expect(candles[0].timestamp).toBeTypeOf('number');
  });

  it('produces a safe error without exposing the key when authentication fails', async () => {
    const provider = new TwelveDataMarketProvider('invalid_key_12345');
    
    try {
        await provider.fetchCandles('EURUSD', '5M', 2);
        expect.fail('Should have thrown an authentication error');
    } catch (error: any) {
        expect(error.message).toContain('Authentication failure');
        expect(error.message).not.toContain('invalid_key_12345');
    }
  });
});
