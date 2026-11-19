# Axnna Deployment Runbook (Cloudflare Workers + D1 + Telegram)

Axnna is deployed as a unified Cloudflare Worker + Static Assets bundle (`axnna-web/wrangler.toml`), with production live at `https://axnna.madede.workers.dev` and automated CD configured in `.github/workflows/cd.yml`.

## 1. Architecture & Free-Tier Market Data Budgeting

Axnna operates entirely within free-tier Cloudflare Workers/D1 and market data limits using a split cron schedule:

- `*/15 * * * *` (`CRON_SYNC`, `mode: '5M_AND_STRATEGY'`):
  - `5M` candle fetch across 4 pairs (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`): `4 * 4 * 24 = 384` requests/24h on active weekdays.
  - `1H` fallback check: skipped during normal operation when `1H` bars in D1 are `< 2h` old.
  - Economic calendar refresh (`FreeEconomicCalendarProvider` via `biquote.io` / FairEconomy fallback): skipped when `ECONOMIC_CALENDAR` health is `< 25m` old; requires zero API keys.
- `2 * * * *` (`CRON_1H_SYNC`, `mode: '1H_ONLY'`):
  - `1H` candle fetch across 4 pairs once per hour: `4 * 24 = 96` requests/24h on active weekdays.
- `0 21 * * *`:
  - 21:00 UTC daily Telegram recap + operational table pruning.
- **Total active weekday requests:** `384 + 96 = 480` TwelveData calls per 24 hours (safely below TwelveData's `800/day` and `8/min` free-tier ceiling), with automatic weekend skip during FX market close (Fri 22:00 UTC to Sun 22:00 UTC) and automatic `TiingoMarketProvider` failover (`50/hr`, `1,000/day` Starter tier) when configured.

## 2. Pre-Deployment Verification Gates

Run from `axnna-web/` prior to pushing or manual deploy:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
CI=1 npm test
```

## 3. Secrets Setup (`wrangler secret put`)

Inside `axnna-web/`, set required secrets for `--env production` (or `--env staging`):

```bash
npx wrangler secret put TWELVEDATA_API_KEY --env production
npx wrangler secret put TIINGO_API_KEY --env production
npx wrangler secret put TELEGRAM_BOT_TOKEN --env production
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
npx wrangler secret put BACKTEST_SECRET --env production
npx wrangler secret put ACTOR_HASH_SECRET --env production
```

## 4. Deploy & Telegram Webhook Registration

Push to `main` triggers `.github/workflows/cd.yml`, which applies `DB` migrations and runs `npx wrangler deploy --env production`. To deploy manually from `axnna-web/`:

```bash
npx wrangler d1 migrations apply DB --remote --env production
npx wrangler deploy --env production
```

After deploying (or rotating `TELEGRAM_WEBHOOK_SECRET`), ensure Telegram's webhook points to the Worker with the matching secret header:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://axnna.madede.workers.dev/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## 5. Post-Deploy Smoke Tests

Verify public endpoints and SPA routing (expected read-only responses):

```bash
curl -sS https://axnna.madede.workers.dev/api/status
curl -sS https://axnna.madede.workers.dev/api/performance
curl -sS https://axnna.madede.workers.dev/api/fundamentals/EURUSD
curl -i -sS https://axnna.madede.workers.dev/api/unknown | head -n 10        # Expect HTTP 404 JSON
curl -i -sS https://axnna.madede.workers.dev/assets/missing.js | head -n 10 # Expect HTTP 404 text, never index.html
```

Visit `https://axnna.madede.workers.dev/connect-telegram` to confirm pairing, already-connected detection, and disconnection (`/disconnect` command or **Disconnect Telegram** button), and `https://axnna.madede.workers.dev/strategies` to inspect the live Read-Only Forward Track Record.

## 6. Rollback Procedure

1. Disable deliveries immediately if needed via remote D1:
   ```bash
   npx wrangler d1 execute DB --remote --env production --command "UPDATE system_config SET value = 'false', updated_at = CURRENT_TIMESTAMP WHERE key = 'global_notifications_enabled';"
   ```
2. Roll back Worker deployment to the prior version:
   ```bash
   npx wrangler rollback --env production
   ```
3. Re-enable notifications once verified:
   ```bash
   npx wrangler d1 execute DB --remote --env production --command "UPDATE system_config SET value = 'true', updated_at = CURRENT_TIMESTAMP WHERE key = 'global_notifications_enabled';"
   ```
