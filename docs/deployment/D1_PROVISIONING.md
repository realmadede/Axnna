# Cloudflare D1 Database Provisioning & Migration Guide

Axnna uses Cloudflare D1 (SQLite) bound as `DB`. Production uses `axnna_db_production` (`70a35528-d8e7-4e54-9e0e-763ea0a26ad1`), while local development and CI tests use Wrangler local D1 and Node's built-in `node:sqlite`.

## Migration Inventory (`axnna-web/migrations/`)

1. `0001_initial_schema.sql`: Core `axnna_users`, `signals`, `notification_deliveries`, `audit_events`, `telegram_connection_sessions`.
2. `0002_market_intelligence.sql`: `economic_events`, `fundamental_observations`, `central_bank_events`, `news_items`, `provider_health_state`, plus `market_context`/`explanation` on `signals`.
3. `0003_data_ingestion.sql`: `market_candles` (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD` across `1H` and `5M`), `market_data_state`, and lookup indexes.
4. `0004_strategy_engine.sql`: Strategy registry seed (`AXNNA_V1_LIQUIDITY_FVG`) and incremental `strategy_state` table.
5. `0005_strategy_engine_core.sql`: Adds `technical_score`, `rejection_reason`, and `evidence_payload` columns on `signals`.
6. `0006_system_config_seed.sql`: Seeds `system_config` defaults (`global_notifications_enabled = 'true'`).
7. `0007_stage_b_integrity.sql`: Expanded `signals` status lifecycle, delivery attempt/retry columns, unique constraint `(signal_id, axnna_user_id, channel)`, legacy `admin_*` columns/tables.
8. `0008_stage_c_operations.sql`: Operational telemetry & delivery tables (`security_events`, `scheduled_job_runs`, `daily_recap_deliveries`, `idx_audit_events_timestamp`, plus legacy telemetry tables kept inert in schema).
9. `0009_stage_c2_remediation.sql`: Forward-only remediation additions:
   - `sync_leases` (atomic D1 lock preventing overlapping sync runs)
   - `rate_limit_counters` (D1-backed sliding counters for pairing sessions and Telegram bot commands)
   - Retry metadata (`attempt_count`, `last_error`, `next_retry_at`) and `idx_daily_recap_retry` on `daily_recap_deliveries`
   - Retention pruning indexes
10. `0010_stage_d_risk_and_paper_trading.sql`: Independent Risk Gate & persisted Paper Trading tables:
    - `paper_accounts` (`'default'` seeded with `starting_balance = 10000.0`, `risk_per_trade_percent = 1.0`)
    - `paper_trades` (`UNIQUE(signal_id)`, `PENDING_ENTRY` -> `ACTIVE_TRADE` -> `TARGET_HIT` / `STOP_HIT` / `EXPIRED` / `INVALIDATED` lifecycle)
    - `risk_decisions` (`UNIQUE(signal_id)`, `'APPROVED'` / `'REJECTED'`, `reason_code`, `event_risk`, `confluence`)
11. `0011_stage_d2_release_integrity.sql`: Atomic delivery claims and timeline indexes:
    - Adds atomic `'SENDING'` claim status to `notification_deliveries` and `daily_recap_deliveries`
    - Repairs any `signals.status` overwritten by paper-trade statuses back to `'ALERTED'` / `'ALERT_ELIGIBLE'`
    - Adds `idx_paper_trades_exit_chronology` (`exit_timestamp ASC, id ASC`) and `idx_economic_events_timestamp`

## Local Migration Validation

Inside `axnna-web/`:

```bash
npx wrangler d1 migrations list DB --local
npx wrangler d1 migrations apply DB --local
```

## Remote D1 Commands (Staging / Production)

Production D1 (`axnna_db_production`, `database_id = "70a35528-d8e7-4e54-9e0e-763ea0a26ad1"`) is already configured in `axnna-web/wrangler.toml`, and CD automatically applies pending migrations on deploy.

To provision `[env.staging]` manually:

1. Create the staging database:
   ```bash
   npx wrangler d1 create axnna_db_staging
   ```
2. Replace `REPLACE_WITH_STAGING_D1_DATABASE_ID` in `axnna-web/wrangler.toml` under `[[env.staging.d1_databases]]`.
3. Apply & verify migrations:
   ```bash
   npx wrangler d1 migrations apply DB --remote --env staging
   npx wrangler d1 migrations list DB --remote --env production
   ```
