# Axnna Development Workflow

This document outlines the local development, database, testing, and repository workflow for Axnna.

## 1. Local Development Environment

Axnna is organized as a single repository containing the React/Vite frontend and the Cloudflare Worker backend under `axnna-web/`.

### Frontend (Vite SPA)
```bash
cd axnna-web
npm install
npm run dev
```

### Backend (Cloudflare Worker & Local D1)
```bash
cd axnna-web
npx wrangler dev src/worker.ts --local
```

Local Worker secrets are read by Wrangler from `axnna-web/.dev.vars` (never from root `.env`). See `.env.example` for the full list of variables.

## 2. Environment Variable Inventory

| Variable | Purpose | Required | Applicability | Consumer | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TWELVEDATA_API_KEY` | TwelveData candle ingestion (`5M`, `1H`) | Yes | Dev, Staging, Prod | Worker (`runSynchronization`, `/api/dev/backtest`) | Secret |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API `sendMessage` alerts | Yes (for delivery) | Dev, Staging, Prod | Worker (`deliverTelegramAlerts`, `retryScheduledDeliveries`) | Secret |
| `TELEGRAM_WEBHOOK_SECRET` | Validates `X-Telegram-Bot-Api-Secret-Token` on webhook | Yes | Dev, Staging, Prod | Worker (`handleTelegramWebhook`) | Secret |
| `ADMIN_PASSPHRASE` | Admin login passphrase for `/config` | Yes (for admin) | Dev, Staging, Prod | Worker (`handleAdminRoutes`) | Secret |
| `ADMIN_SESSION_SECRET` | Dedicated HMAC-SHA256 cookie signing key | Yes (for admin) | Dev, Staging, Prod | Worker (`handleAdminRoutes`) | Secret |
| `BACKTEST_SECRET` | Bearer token protecting `POST /api/dev/backtest` | Optional | Dev, Staging | Worker (`handleBacktestRun`) | Secret |
| `ALLOWED_ORIGINS` | Comma-separated extra CORS origins | Optional | Staging, Prod | Worker (`buildCorsHeaders`, `isAllowedAdminOrigin`) | Config |
| `FINNHUB_API_KEY` | Legacy optional field (calendar now uses keyless feed) | No | Legacy/Optional | Unused by default | Secret |

Note: Remote staging/production secrets, remote D1 provisioning, and live Cloudflare deployment are documented in `docs/deployment/` and remain gated until explicit Stage D deployment authorization.

## 3. Database (D1) Workflow

Migrations live in `axnna-web/migrations/` (`0001` through `0011`).

```bash
cd axnna-web
npx wrangler d1 migrations apply DB --local
```

Migration `0007_stage_b_integrity.sql` updates `signals` and `notification_deliveries` and adds `admin_login_attempts` and `revoked_admin_sessions`. Migration `0008_stage_c_operations.sql` adds `analytics_events`, `security_events`, `scheduled_job_runs`, `contact_submissions`, and `daily_recap_deliveries`. Migration `0009_stage_c2_remediation.sql` adds `sync_leases`, `rate_limit_counters`, daily recap retry columns, retention indexes, and cleans legacy unhashed `admin_login_attempts` keys. Migration `0010_stage_d_risk_and_paper_trading.sql` adds `paper_accounts`, `paper_trades`, and `risk_decisions`. Migration `0011_stage_d2_release_integrity.sql` adds `'SENDING'` atomic delivery/recap claim states, repairs overwritten signal alert history, and adds exit-chronology & economic-event indexes.

## 4. Automated Checks & Testing

```bash
cd axnna-web
npm run typecheck
npm run lint
npm test
npm run build
```

For manual live TwelveData connectivity verification (excluded from CI):

```bash
cd axnna-web
npm run test:live
```

## 5. Branching & Git Hygiene

* **Branch structure:** `main` is the single local development branch, tracking `origin/main`.
* Remote branch `origin/phase-7-work` (`43862cb`) has an identical tree to `origin/main` (`791ebde`, squash-merged in PR #1) and contains no unique unmerged changes; remote deletion is deferred until authorized.
* Generated build outputs (`dist/`, `.wrangler/`, `tsconfig.tsbuildinfo`) and local secret files (`.env`, `.dev.vars`) are gitignored and must never be committed.
