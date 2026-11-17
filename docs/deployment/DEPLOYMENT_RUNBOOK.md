# Axnna Deployment Runbook

> Note: Stage D.2 remediation, local migrations (`0001`–`0011`), fail-closed Risk Gate persistence, Paper Trading financial integrity (`SIMULATION ONLY`), atomic delivery locks, and Wrangler dry-run builds are complete and locally verified. Live Cloudflare deployment (`wrangler deploy`), remote D1 provisioning (`wrangler d1 create`), remote secret upload, and live Telegram webhook registration remain gated until explicit authorization.

## Pre-Deployment Checklist

1. Confirm clean Git state on `main` (no `.env`, `.dev.vars`, or local `.sqlite` files tracked).
2. Inside `axnna-web/`, verify all checks pass:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```
3. Confirm the target environment's `database_id` in `axnna-web/wrangler.toml` (`[env.staging]` or `[env.production]`) has replaced its `REPLACE_WITH_*` placeholder (staging deploys do not require production's UUID to be populated first).
4. Configure GitHub Environments (`staging` and `production` with required reviewers on `production`) plus environment-scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` before running `.github/workflows/cd.yml`.
5. Confirm all required Cloudflare Worker secrets exist in the target environment (`TWELVEDATA_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_PASSPHRASE`, `ADMIN_SESSION_SECRET`, `BACKTEST_SECRET`, and optional `ACTOR_HASH_SECRET`). Note that Daily Recap executes at `21:00 UTC` (`0 21 * * *`) alongside bounded operational retention pruning.

## Staging Deployment Steps

```bash
cd axnna-web
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npx wrangler d1 migrations apply DB --remote --env staging
npx wrangler deploy --env staging
```

Register Telegram staging webhook:
```bash
curl -X POST "https://api.telegram.org/bot<STAGING_TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://axnna-staging.madede.workers.dev/api/telegram/webhook","secret_token":"<STAGING_TELEGRAM_WEBHOOK_SECRET>"}'
```

## Production Deployment Steps (`axnna.madede.workers.dev`)

```bash
cd axnna-web
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npx wrangler d1 migrations apply DB --remote --env production
npx wrangler deploy --env production
```

Register Telegram production webhook:
```bash
curl -X POST "https://api.telegram.org/bot<PROD_TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://axnna.madede.workers.dev/api/telegram/webhook","secret_token":"<PROD_TELEGRAM_WEBHOOK_SECRET>"}'
```

## Post-Deployment Verification

1. `GET https://axnna.madede.workers.dev/` returns `200` HTML landing page.
2. `GET https://axnna.madede.workers.dev/status` returns `200` SPA page; `GET /api/status` returns JSON with `overallStatus`.
3. `GET https://axnna.madede.workers.dev/api/unknown-route` returns `404` JSON `{"error":"Not Found"}`.
4. Sign in at `/config` -> check **System Health**, **Market Data**, **Signals** (including **Risk Gate Decisions**), and **Paper Trading** (`SIMULATION ONLY (NO REAL MONEY)`) tabs -> trigger **Sync Now** -> confirm `scheduled_job_runs`, `provider_health_state`, `risk_decisions`, and `paper_trades` populate cleanly.
5. Verify `/api/telegram/webhook` rejects missing/invalid `X-Telegram-Bot-Api-Secret-Token` with `401` and records an entry in the Admin **Security** tab.
6. Test Telegram `/connect-telegram` pairing, `/status EURUSD`, and `/recap`.

## Backup, Recovery & Cost Controls

* Take a logical D1 export prior to any schema upgrade or incident triage: `npx wrangler d1 export DB --remote --env <staging|production> --output backup.sql`.
* No autonomous remote backup cron exists in Stage D; exports remain operator-triggered until production SLA requirements define RPO/RTO automation.
* Keep Cloudflare Worker usage bounded via `sync_leases` (10m `MARKET_SYNC` lock, plus 5m `DAILY_RECAP` lease) and bounded retention pruning (`pruneOperationalTables`, including `economic_events` > 90 days, during the `21:00 UTC` schedule). TwelveData requests stay bounded via `5M` fetches (`4` pairs x `12` cycles/hr = `48` calls/hr) plus mid-hour `1H` cache skips (`4` pairs x `1` fetch/hr = `4` calls/hr), totaling `~52` calls/hour (`~1,248` calls/24h max, requiring a paid TwelveData tier above the 800/day free plan; `/api/dev/backtest` also validates pip cost overrides in `0..50` around calibrated pair defaults).

## Rollback Procedure

1. Roll back Worker deployment to previous version via Cloudflare dashboard or `npx wrangler rollback --env production`.
2. If an operational toggle or delivery issue occurs without a code regression:
   - Open `/config` -> **Config & Inbox** -> disable `global_notifications_enabled` kill-switch or set strategy `AXNNA_V1_LIQUIDITY_FVG` to `DISABLED`.
3. D1 migrations are forward-only; never drop tables during an incident without taking an export first (`npx wrangler d1 export DB --remote --env production`).
