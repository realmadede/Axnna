# Cloudflare Architecture & Security Model

Axnna combines a React + TypeScript + Vite SPA with a Cloudflare Worker (`axnna-web/src/worker.ts`) and Cloudflare D1 database.

## Current Topology & Stage Status

* **Unified Cloudflare Worker + Static Assets:** `axnna-web/wrangler.toml` serves Vite static outputs (`./dist`) via the `ASSETS` binding (`not_found_handling = "single-page-application"`, `run_worker_first = true`) directly from `axnna-web/src/worker.ts`. Unmatched `/api` and `/api/*` requests return JSON `404`, non-API SPA routes (including `/apiary`) pass to `ASSETS`, and missing `/assets/*` or static-extension files (`.js`, `.css`, `.png`, `.svg`, `.ico`, `.json`, `.woff2`, `.map`, etc.) return `404` rather than serving `index.html`.
* **Environment Separation:** `wrangler.toml` defines local dev (`ENVIRONMENT = "development"`), `[env.staging]` (`axnna-staging`), and `[env.production]` (`axnna` / `axnna.madede.workers.dev`) with explicit `ALLOWED_ORIGINS` and dual cron triggers (`"*/5 * * * *"`, `"0 21 * * *"`). Remote D1 `database_id` placeholders (`REPLACE_WITH_*`) remain guarded by `.github/workflows/cd.yml` until live Cloudflare account provisioning.
* **Stage D.2 End-to-End Pipeline:** `Market Data -> Technical Analysis -> Fundamental Context -> Signal -> Independent Risk Gate (fail-closed) -> Telegram Alert + Persisted Paper Trade -> Observability & Admin Review`. Real-money broker execution does not exist (`SIMULATION_ONLY`).
* **Accounting & Lifecycle Separation:** `signals.status` strictly preserves qualification/alert delivery history (`ALERT_ELIGIBLE`, `ALERTED`, `REJECTED`), while simulated execution lives exclusively in `paper_trades` (`PENDING_ENTRY` -> `ACTIVE_TRADE` -> `TARGET_HIT` / `STOP_HIT` / `EXPIRED` / `INVALIDATED`) with atomic `D1 batch` balance reconciliation (`current_balance = starting_balance + SUM(closed net_pnl)`) and exit-chronology (`exit_timestamp ASC`) equity curve & drawdown metrics.
* **External Prerequisites Still Required for Live Rollout:** Remote Cloudflare D1 provisioning (`wrangler d1 create`), remote secret upload, `wrangler deploy`, and live Telegram `setWebhook` registration remain blocked until explicit deployment credentials/authorization are provided.

## API Authorization Matrix

| Route | Method | Access | Authentication / Protection |
| :--- | :--- | :--- | :--- |
| `/api/status` | `GET` | Public | Sanitized subsystem + instrument health summary (`evaluateSystemHealth`); zero secrets or private rows |
| `/api/feedback` | `POST` | Public | Category/length validation, honeypot field, SHA-256 IP rate limit (`3/hour`), stored in `contact_submissions` |
| `/api/analytics/event` | `POST` | Public | First-party cookie-free telemetry (`analytics_events`) with strict enum validation and UA classification |
| `/api/fundamentals/:instrument` | `GET` | Public | Validated against supported instruments (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`) |
| `/api/telegram/session` | `POST` | Public | Creates short-lived (10m) UUID pairing token |
| `/api/telegram/session/:token` | `GET` | Public | Returns session status (`PENDING`, `CONNECTED`, `EXPIRED`, `NOT_FOUND`) |
| `/api/telegram/webhook` | `POST` | Telegram Webhook | Constant-time `X-Telegram-Bot-Api-Secret-Token` validation against `TELEGRAM_WEBHOOK_SECRET` (fails closed `503` if unset) |
| `/api/auth/config` | `GET`, `POST` | Public / Admin Login | `POST` verifies `ADMIN_PASSPHRASE`, enforces D1 brute-force lockout (`admin_login_attempts`), issues HMAC-SHA256 `HttpOnly` cookie signed with `ADMIN_SESSION_SECRET` |
| `/api/auth/config/logout` | `POST` | Admin | Requires Origin + `X-Requested-With: AxnnaAdmin`; revokes token `nonce` in `revoked_admin_sessions` and clears cookie |
| `/api/config/overview` | `GET` | Admin-only | Returns health, market/calendar state, signals, risk decisions, `paperTrading` simulation portfolio, deliveries, `7/30/90`-day analytics, security events, contact inbox, and boolean secret status |
| `/api/config/*` | `GET`, `POST` | Admin-only | Valid signed `axnna_admin_session` cookie (not revoked, matching `admin_session_version`); `POST` also enforces Origin and `X-Requested-With: AxnnaAdmin` (includes `/deliveries/:id/retry`, `/security/:id/resolve`, `/contact/:id/status`, `/paper/account`) |
| `/api/signals`, `/api/markets`, `/api/calendar` | `GET` | Admin-only | Valid signed `axnna_admin_session` cookie (`401` when unauthenticated) |
| `/api/dev/backtest` | `POST` | Dev / Admin | Constant-time `Authorization: Bearer <BACKTEST_SECRET>`, `instrument` / `timeframe` allowlist, integer `limit` bounded to `100..400`, date validation |

## CORS Policy

* `buildCorsHeaders` checks `Origin` against the request origin, `ALLOWED_ORIGINS`, and local dev hosts (`localhost` / `127.0.0.1` only when serving locally).
* Wildcard `Access-Control-Allow-Origin: *` is never used; `Access-Control-Allow-Credentials: true` is emitted only for explicitly allowlisted origins.

## Admin Session & Security Controls

* Passphrases are verified in constant time via SHA-256 digests (`constantTimeSecretMatch`).
* Session signing requires a dedicated `ADMIN_SESSION_SECRET` (no fallback to `ADMIN_PASSPHRASE`).
* Failed logins are tracked per client IP in D1 `admin_login_attempts` (5 failed attempts within 15 minutes triggers a 15-minute `429` lockout).
* Individual sessions are revoked server-side on logout (`revoked_admin_sessions`), and all sessions can be invalidated globally by incrementing `system_config.admin_session_version` or rotating `ADMIN_SESSION_SECRET`.

## Database Migration 0007 Model

* `signals` supports both setup-processing statuses (`DETECTED`, `QUALIFIED`, `REJECTED`, `EXPIRED`, `ALERT_ELIGIBLE`, `ALERTED`) and downstream trade-lifecycle statuses (`PENDING_ENTRY`, `ACTIVE_TRADE`, `TARGET_HIT`, `STOP_HIT`, `INVALIDATED`), with nullable `entry`, `structural_stop`, `structural_target`, and `structural_rr` for rejected or pre-entry setups.
* `notification_deliveries` supports `PENDING`, `SENT`, `FAILED`, `RETRY_SCHEDULED`, `PERMANENT_FAILURE`, and `EXHAUSTED`, with `last_error`, `last_http_status`, and `next_retry_at`.
