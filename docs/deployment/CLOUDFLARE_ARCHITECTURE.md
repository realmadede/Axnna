# Cloudflare Architecture & Security Model

Axnna combines a React + TypeScript + Vite SPA with a unified Cloudflare Worker (`axnna-web/src/worker.ts` + `axnna-web/src/worker/*`) and Cloudflare D1 SQLite (`DB`).

## Runtime Topology

- **Unified Cloudflare Worker + Static Assets:** `axnna-web/wrangler.toml` builds `./dist` (`npm run build`) and binds it as `ASSETS` (`not_found_handling = "single-page-application"`, `run_worker_first = true`).
  - `/api` and `/api/*` unmatched routes return JSON `404 {"error":"Not Found"}`.
  - Requests for missing `/assets/*` or static file extensions (`.js`, `.mjs`, `.css`, `.png`, `.jpg`, `.svg`, `.ico`, `.json`, `.woff2`, `.map`, etc.) return HTTP `404` instead of falling back to `index.html`.
  - Valid client routes (`/`, `/about`, `/strategies`, `/faq`, `/status`, `/contact`, `/connect-telegram`, `/legal/:page`) serve `index.html`.
- **Environment Separation (`axnna-web/wrangler.toml`):**
  - **Local dev:** `ENVIRONMENT = "development"`, `database_id = "local-db-id"`.
  - **Staging (`[env.staging]`):** `axnna-staging`, `ALLOWED_ORIGINS = "https://axnna-staging.madede.workers.dev"`, staging cron triggers disabled (`crons = []`) so staging never doubles TwelveData or D1 usage, and `database_id = "REPLACE_WITH_STAGING_D1_DATABASE_ID"` guarded by CD until provisioned.
  - **Production (`[env.production]`):** Live at `axnna` (`https://axnna.madede.workers.dev`), D1 `axnna_db_production` (`70a35528-d8e7-4e54-9e0e-763ea0a26ad1`), scheduled crons `["*/15 * * * *", "2 * * * *", "0 21 * * *"]`.
- **End-to-End Pipeline (`SIMULATION_ONLY`):**
  `Market Data (TwelveData + Tiingo fallback) & Economic Calendar -> PaperTradingEngine Pre-Evaluation -> StrategyEngine (1H HTF Bias -> 5M Liquidity/Displacement/FVG) -> FundamentalEngine -> Fail-Closed RiskGate -> Telegram Alerts + Persisted Paper Trade -> Daily Recap & Pruning`.
  Real-money broker execution does not exist (`SIMULATION_ONLY`).
- **Accounting & Lifecycle Separation:** `signals.status` strictly preserves qualification/alert delivery history (`ALERT_ELIGIBLE`, `ALERTED`, `REJECTED`), while simulated execution lives in `paper_trades` (`PENDING_ENTRY` -> `ACTIVE_TRADE` -> `TARGET_HIT` / `STOP_HIT` / `EXPIRED` / `INVALIDATED`) with atomic D1 reconciliation (`current_balance = starting_balance + SUM(closed net_pnl)`) and exit-chronology (`exit_timestamp ASC`) equity curve metrics.

## API Authorization Matrix

| Route | Method | Access | Authentication / Protection |
| :--- | :--- | :--- | :--- |
| `/api/status` | `GET` | Public | Sanitized overall status & per-subsystem health (`evaluateSystemHealth`, `Cache-Control: public, max-age=15`); zero secrets or private rows |
| `/api/performance` | `GET` | Public | Read-only aggregate paper trading KPIs, per-instrument & per-score-band (`65-74`, `75-84`, `85+`) breakdown, 0 D1 writes (`Cache-Control: public, max-age=300`) |
| `/api/fundamentals/:instrument` | `GET` | Public | Validates against `EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`; returns cached macro context from `FundamentalEngine` |
| `/api/telegram/session` | `POST` | Public | Creates 10-minute UUID pairing token in `telegram_connection_sessions`; D1 rate-limited (`15/hour` per actor hash) |
| `/api/telegram/session/:token` | `GET` | Public | Returns session status (`PENDING`, `CONNECTED` with optional `alreadyConnected: true`, `DISCONNECTED`, `EXPIRED`, `NOT_FOUND`) |
| `/api/telegram/disconnect` | `POST` | Public | Disconnects a verified pairing session's Telegram chat via matching `sessionToken` (`axnna_users.status = 'DISCONNECTED'`) |
| `/api/telegram/webhook` | `POST` | Telegram Webhook | Constant-time `X-Telegram-Bot-Api-Secret-Token` validation against `TELEGRAM_WEBHOOK_SECRET` (fails closed `503` if unset); enforces `10/5m` command throttling |
| `/api/dev/backtest` | `POST` | Authenticated | Constant-time `Authorization: Bearer <BACKTEST_SECRET>` (`503` if unset); validated instrument/timeframe, bounded `100..400` `1H` bars (`1200..4800` `5M`) |

All other `/api` and `/api/*` endpoints (including legacy removed admin routes) return `404 {"error":"Not Found"}`.

## Scheduled Cron Architecture (`src/worker.ts`)

1. **`*/15 * * * *` (`CRON_SYNC`, `mode: '5M_AND_STRATEGY'`):**
   - Refreshes `FreeEconomicCalendarProvider` when `provider_health_state` is stale (`>= 25m`).
   - Fetches `5M` candles across all 4 pairs (and refreshes `1H` only if D1 `1H` state is missing or older than 2 hours). Skips active fetches during FX weekend closes when recent session bars are cached.
   - Evaluates open `paper_trades`, runs incremental `StrategyEngine` (`>= 65` score), evaluates `RiskGate`, sends Telegram alerts with atomic `SENDING` claim locks, and retries `RETRY_SCHEDULED` alerts / failed daily recaps.
2. **`2 * * * *` (`CRON_1H_SYNC`, `mode: '1H_ONLY'`):**
   - Refreshes `1H` candles across all 4 pairs (`4` requests/hour), skipping weekends when already cached.
3. **`0 21 * * *` (21:00 UTC Daily Recap & Maintenance):**
   - Dispatches idempotent `runDailyRecap(env)` to connected users (`UNIQUE(recap_date, axnna_user_id)`) and runs `pruneOperationalTables(env.DB)`.

## CORS Policy

- `buildCorsHeaders` checks `Origin` against the request origin, `ALLOWED_ORIGINS`, and local dev hosts (`localhost` / `127.0.0.1` only when serving locally).
- Wildcard `Access-Control-Allow-Origin: *` is never used.
