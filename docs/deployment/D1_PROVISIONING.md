# Cloudflare D1 Database Provisioning & Migration Guide

Axnna uses Cloudflare D1 (SQLite) bound as `DB`. No remote databases have been provisioned in Stage C; all schema changes have been verified locally using Wrangler local D1 and Vitest with `node:sqlite`.

## Migration Inventory (`axnna-web/migrations/`)

1. `0001_initial_schema.sql`: Core `axnna_users`, `signals`, `notification_deliveries`, `audit_events`, `telegram_connection_sessions`.
2. `0002_market_intelligence.sql`: `economic_events`, `fundamental_observations`, `central_bank_events`, `news_items`, `provider_health_state`, plus `market_context`/`explanation` on `signals`.
3. `0003_data_ingestion.sql`: `market_candles` (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD` across `1H` and `5M`) and lookup indexes.
4. `0004_strategy_engine.sql`: Strategy registry seed (`AXNNA_V1_LIQUIDITY_FVG`) and incremental `strategy_state` table.
5. `0005_strategy_engine_core.sql`: Adds `technical_score`, `rejection_reason`, and `evidence_payload` columns on `signals`.
6. `0006_system_config_seed.sql`: Seeds default `global_notifications_enabled = 'true'`.
7. `0007_stage_b_integrity.sql`: Expanded `signals` status lifecycle (`DETECTED` through `INVALIDATED`), delivery attempt/retry columns, unique constraint `(signal_id, axnna_user_id, channel)`, `admin_login_attempts`, `admin_session_version`.
8. `0008_stage_c_operations.sql`: Operational telemetry & product tables:
   - `analytics_events` (visitor/session IDs, event types, referrer hostname, device/browser category, country code)
   - `security_events` (auth failures, CSRF rejections, webhook anomalies, rate limits, resolution workflow)
   - `scheduled_job_runs` (cron / manual sync execution duration, outcome, summary)
   - `contact_submissions` (feedback category, message, optional contact, hashed actor IP, triage status)
   - `daily_recap_deliveries` (`UNIQUE(recap_date, axnna_user_id)` idempotency)
   - `idx_audit_events_timestamp` index on `audit_events(timestamp DESC)`
9. `0009_stage_c2_remediation.sql`: Forward-only remediation additions:
   - `sync_leases` (atomic D1 synchronization lock preventing CRON/manual overlap)
   - `rate_limit_counters` (D1-backed sliding counters for analytics ingestion and Telegram command throttling)
   - Retry metadata (`attempt_count`, `last_error`, `next_retry_at`) and `idx_daily_recap_retry` on `daily_recap_deliveries`
   - Retention pruning indexes and cleanup of legacy unhashed `admin_login_attempts.client_key` rows
10. `0010_stage_d_risk_and_paper_trading.sql`: Stage D independent Risk Gate & persisted Paper Trading tables:
   - `paper_accounts` (`'default'` seeded with `starting_balance = 10000.0`, `risk_per_trade_percent = 1.0`)
   - `paper_trades` (`UNIQUE(signal_id)`, conservative `PENDING_ENTRY` -> `ACTIVE_TRADE` -> `TARGET_HIT` / `STOP_HIT` / `EXPIRED` / `INVALIDATED` lifecycle)
   - `risk_decisions` (`UNIQUE(signal_id)`, `'APPROVED'` / `'REJECTED'`, `reason_code`, `event_risk`, `confluence`)
11. `0011_stage_d2_release_integrity.sql`: Stage D.2 release-integrity additions:
   - Adds atomic `'SENDING'` claim status to `notification_deliveries` and `daily_recap_deliveries`
   - Repairs any `signals.status` overwritten by paper-trade statuses back to `'ALERTED'` / `'ALERT_ELIGIBLE'` so alert history remains intact
   - Adds `idx_paper_trades_exit_chronology` (`exit_timestamp ASC, id ASC`) and `idx_economic_events_timestamp`

## Local Migration Validation

Inside `axnna-web/`:

```bash
npx wrangler d1 migrations list DB --local
npx wrangler d1 migrations apply DB --local
```

## Staging & Production Provisioning (Execute Only When Authorized for Stage D)

1. Create remote D1 databases:
   ```bash
   npx wrangler d1 create axnna_db_staging
   npx wrangler d1 create axnna_db_production
   ```
2. Copy each returned `database_id` UUID into `axnna-web/wrangler.toml`:
   - `REPLACE_WITH_STAGING_D1_DATABASE_ID` under `[[env.staging.d1_databases]]`
   - `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID` under `[[env.production.d1_databases]]`
3. Apply migrations before first deploy:
   ```bash
   npx wrangler d1 migrations apply DB --remote --env staging
   npx wrangler d1 migrations apply DB --remote --env production
   ```
4. Verify applied migrations:
   ```bash
   npx wrangler d1 migrations list DB --remote --env staging
   npx wrangler d1 migrations list DB --remote --env production
   ```
