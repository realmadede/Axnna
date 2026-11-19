# Axnna Development & Deployment Workflow

This document outlines the active development, verification, and Cloudflare deployment workflow for Axnna (`axnna-web/`).

## 1. Repository & Branch Policy

- Keep `main` as the single active branch (`origin/main`).
- Never commit `.env`, `.dev.vars`, `*.sqlite`, or API tokens.
- Keep commit messages, code, and docs free of emojis.

## 2. Environment Variables & Secrets

Local Worker development reads secrets from `axnna-web/.dev.vars` (gitignored). Remote environments (`[env.production]` and `[env.staging]` in `axnna-web/wrangler.toml`) store secrets via `wrangler secret put`:

| Secret / Var | Required | Purpose |
| :--- | :--- | :--- |
| `TWELVEDATA_API_KEY` | Yes | Primary OHLCV market data (`TwelveDataMarketProvider`). Fails closed if missing or placeholder. |
| `TIINGO_API_KEY` | Recommended | Automatic fallback OHLCV provider (`TiingoMarketProvider`) if TwelveData hits `429` or auth/upstream failure. |
| `TELEGRAM_BOT_TOKEN` | Yes (for alerts/webhook) | Telegram Bot API token for `/connect-telegram` pairing, bot commands, signals, and daily recaps. |
| `TELEGRAM_WEBHOOK_SECRET` | Yes (for webhook) | Shared secret checked in constant time against `X-Telegram-Bot-Api-Secret-Token` (`503` if unset). |
| `BACKTEST_SECRET` | Yes (for backtest API) | Bearer token authorizing `POST /api/dev/backtest` (`503` if unset). |
| `ACTOR_HASH_SECRET` | Optional (HMAC key) | Optional HMAC secret for `tg_session` and webhook actor rate-limit hashing. |
| `ALLOWED_ORIGINS` | Configured in `wrangler.toml` | Comma-separated allowlist for CORS responses (`https://axnna.madede.workers.dev` in production). |
| `FINNHUB_API_KEY` | Optional / Legacy | Unused by `FreeEconomicCalendarProvider`; economic calendar runs keylessly via `biquote.io` + FairEconomy fallback. |

## 3. Local Development

Inside `axnna-web/`:

1. Install dependencies & initialize local D1 migrations:
   ```bash
   npm ci
   npm run db:init
   ```
2. Run verification checks before any commit:
   ```bash
   npm run typecheck
   npm run lint
   npm run build
   CI=1 npm test
   ```
   - `npm test` runs Vitest using Node's built-in `node:sqlite` harness (`tests/`) with zero Cloudflare runtime or external API dependencies required.
3. Optional local Worker & frontend preview:
   ```bash
   npm run dev                 # Frontend dev server (Vite)
   npx wrangler dev --local    # Full Worker + D1 + Assets local runtime (after creating .dev.vars)
   ```

## 4. CI/CD Automation (`.github/workflows/`)

- **CI (`.github/workflows/ci.yml`):** Triggers on push/PR to `main` using Node.js 24 (`actions/checkout@v5`, `actions/setup-node@v6`). Runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` inside `axnna-web`.
- **CD (`.github/workflows/cd.yml`):** Triggers on push to `main` or manual `workflow_dispatch` (`production` or `staging`). Re-runs `typecheck`, `lint`, `build`, and `npm test`, asserts that `axnna-web/wrangler.toml` has a valid remote `database_id` (not `REPLACE_WITH_*`) for the target environment, applies remote D1 migrations (`npx wrangler d1 migrations apply DB --remote --env "$TARGET_ENV"`), and deploys the unified Worker + Static Assets bundle (`npx wrangler deploy --env "$TARGET_ENV"`).
- Required GitHub secrets for CD: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
