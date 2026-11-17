# Axnna Unified Cloudflare Architecture

## Architectural Decision: Unified Worker + Static Assets

Axnna uses a **single unified Cloudflare Worker with Workers Static Assets** configured in `axnna-web/wrangler.toml`:

- Worker entry point: `src/worker.ts`
- Static bundle directory: `./dist` (built by Vite via `npm run build`)
- Assets binding: `ASSETS`
- SPA routing: `not_found_handling = "single-page-application"`
- Worker-first execution: `run_worker_first = true`

Previous deployment fragments attempted to deploy `./dist` to a separate Cloudflare Pages project (`pages.dev`) without running Worker `/api/*` routes on the same origin. Unifying static assets inside the Worker eliminates split-origin cookie/CORS mismatches and ensures `SameSite=Strict` admin session cookies, `/api/status`, `/api/feedback`, `/api/analytics/event`, `/api/telegram/*`, and `/api/config/*` share a single origin (`axnna.madede.workers.dev` in production, `axnna-staging.madede.workers.dev` in staging).

## Request Routing Contract

When a request arrives at the Worker (`src/worker.ts`):

1. **`/api/*` requests**: Handled directly by the Worker router.
   - Public endpoints:
     - `GET /api/status` (sanitized overall + subsystem status)
     - `POST /api/feedback` (contact & feedback submission with validation, honeypot check, and 3/hour hashed-IP rate limit)
     - `POST /api/analytics/event` (first-party cookie-free telemetry event ingestion)
     - `POST /api/telegram/session` and `GET /api/telegram/session/:token`
     - `POST /api/telegram/webhook` (authenticated via `X-Telegram-Bot-Api-Secret-Token`)
     - `GET /api/fundamentals/:instrument`
   - Protected / secret-gated endpoints:
     - `POST /api/auth/config`, `GET /api/auth/config/status`, `POST /api/auth/config/logout`
     - `GET|POST /api/config/*` (cookie auth + brute-force lockout + `Origin` allowlist + `X-Requested-With: AxnnaAdmin`)
     - `GET /api/signals`, `GET /api/markets`, `GET /api/calendar` (admin session auth)
     - `POST /api/dev/backtest` (`Authorization: Bearer <BACKTEST_SECRET>`)
   - Unmatched `/api/*` routes explicitly return `404` JSON (`{"error":"Not Found"}`) and never fall through to the SPA shell.
2. **Non-`/api/*` requests**:
   - Delegated to `env.ASSETS.fetch(request)`.
   - Static asset paths serve matching files from `./dist` or return `404` if a missing asset file is requested.
   - SPA page routes (`/`, `/about`, `/strategies`, `/faq`, `/status`, `/contact`, `/privacy`, `/terms`, `/connect-telegram`, `/config`) serve `index.html` cleanly under `single-page-application` handling.

## Scheduled Cron Triggers

Configured identically across base, `[env.staging]`, and `[env.production]`:

- `*/5 * * * *`: Runs `worker.runSynchronization(env, 'CRON_SYNC')`:
  1. Fetches upcoming macro events via `FreeEconomicCalendarProvider` (no paid API key required) and updates `economic_events` + `provider_health_state`.
  2. Fetches `5M` and `1H` candles for `EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD` via `TwelveDataMarketProvider`, validates completed candles only, stores in `market_candles`, updates `market_data_state` + `provider_health_state`.
  3. Runs incremental `StrategyEngine` evaluation per instrument, records signals in `signals` + `strategy_state`, checks risk gating (`HIGH EVENT RISK`), and delivers Telegram alerts respecting `global_notifications_enabled` and `strategies.active_status`.
  4. Retries eligible `RETRY_SCHEDULED` deliveries up to `MAX_DELIVERY_ATTEMPTS`.
  5. Records execution outcome in `scheduled_job_runs`.
- `0 21 * * *`: Runs `runDailyRecap(env)` (21:00 UTC daily summary across connected subscribers with `daily_recap_deliveries` idempotency).
