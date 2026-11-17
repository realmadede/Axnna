import fs from 'node:fs';
import path from 'node:path';
import { TwelveDataMarketProvider } from '../src/providers/MarketProvider';

/**
 * Manual live-provider verification script (run via `npm run test:live`).
 * Excluded from automated CI so unit tests never depend on external network or secrets.
 */
async function main() {
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

  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) {
    throw new Error('TWELVEDATA_API_KEY not found in environment or .dev.vars');
  }

  const provider = new TwelveDataMarketProvider(key);
  const candles = await provider.fetchCandles('EURUSD', '5M', 2);
  console.log(`Fetched ${candles.length} live EURUSD 5M candles.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
