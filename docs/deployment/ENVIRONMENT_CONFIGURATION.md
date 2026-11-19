# Environment Configuration Guide

Axnna separates local development, staging, and production configurations inside `axnna-web/wrangler.toml`.

## Cloudflare Environments

| Setting | Local Dev | Staging (`--env staging`) | Production (`--env production`) |
| :--- | :--- | :--- | :--- |
| Worker Name | `axnna-web` | `axnna-staging` | `axnna` (`axnna.madede.workers.dev`) |
| `ENVIRONMENT` | `development` | `staging` | `production` |
| `ALLOWED_ORIGINS` | Implicit local/same-origin | `https://axnna-staging.madede.workers.dev` | `https://axnna.madede.workers.dev` |
| D1 Database (`DB`) | `axnna_db` (`local-db-id`) | `axnna_db_staging` (`REPLACE_WITH_STAGING_D1_DATABASE_ID`) | `axnna_db_production` (`70a35528-d8e7-4e54-9e0e-763ea0a26ad1`) |
| Cron Triggers | `["*/15 * * * *", "2 * * * *", "0 21 * * *"]` | `[]` (disabled so staging does not double quota usage) | `["*/15 * * * *", "2 * * * *", "0 21 * * *"]` |

## Required Secrets & Non-Sensitive Vars

| Name | Type | Fail-Closed Behavior | Notes |
| :--- | :--- | :--- | :--- |
| `TWELVEDATA_API_KEY` | Secret | Marks `MARKET_DATA` `FAILED` without outgoing requests unless `TIINGO_API_KEY` fallback is set | Primary `5M`/`1H` OHLCV feed (`TwelveDataMarketProvider`) |
| `TIINGO_API_KEY` | Secret (Recommended) | Optional fallback | Automatic failover (`TiingoMarketProvider`) if TwelveData hits rate limits or errors |
| `TELEGRAM_BOT_TOKEN` | Secret | Fails delivery safely and logs error | Bot token from BotFather (`@AxnnaSignalsBot`) |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | `POST /api/telegram/webhook` returns `503` when unset | Constant-time matched against `X-Telegram-Bot-Api-Secret-Token` |
| `BACKTEST_SECRET` | Secret | `POST /api/dev/backtest` returns `503` when unset | Bearer auth for on-demand backtests |
| `ACTOR_HASH_SECRET` | Secret (Optional) | Falls back to deterministic SHA-256 over client IP if unset | Used to HMAC-hash client IPs before D1 rate-limit storage |
| `ENVIRONMENT` | Var (`wrangler.toml`) | Defaults to local dev origin rules when omitted | Set to `staging` or `production` |
| `ALLOWED_ORIGINS` | Var (`wrangler.toml`) | Disallows cross-origin credentialed requests when unset | Exact HTTPS origin list |
| `FINNHUB_API_KEY` | Optional / Legacy | Unused | `FreeEconomicCalendarProvider` uses keyless `biquote.io` + FairEconomy feeds |

## Local `.dev.vars` Template

Create `axnna-web/.dev.vars` (gitignored, never commit) when running `npx wrangler dev`:

```ini
TWELVEDATA_API_KEY=your_twelvedata_key
TIINGO_API_KEY=your_tiingo_token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_SECRET=generate_64_hex_random_secret
BACKTEST_SECRET=generate_64_hex_random_secret
ACTOR_HASH_SECRET=generate_64_hex_random_secret
```
