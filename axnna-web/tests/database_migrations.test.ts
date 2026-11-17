import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';

describe('D1 Migrations & Signal Lifecycle Integration', () => {
  it('preserves existing signals and notification_deliveries across migration 0007', async () => {
    const { sqlite } = createSqliteD1('0006');

    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, connected_at)
         VALUES ('user_legacy', '9001', '9001', 'CONNECTED', '2026-10-01T00:00:00Z')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr,
           status, market_context, explanation, technical_score, rejection_reason, evidence_payload
         ) VALUES (
           'sig_legacy', 'AXNNA_V1_LIQUIDITY_FVG', '4', 'EURUSD', 'LONG', '2026-10-01T00:00:00Z',
           '1H', '5M', 1.1000, 1.0950, 1.1100, 2.0,
           'PENDING_ENTRY', '{"macro":"LOW"}', 'legacy note', 75, NULL, '{"fvg":true}'
         )`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO notification_deliveries (id, signal_id, axnna_user_id, destination, status, attempt_count)
         VALUES ('nd_legacy', 'sig_legacy', 'user_legacy', '9001', 'SENT', 1)`
      )
      .run();

    const migration0007 = fs.readFileSync(
      path.resolve(__dirname, '../migrations/0007_stage_b_integrity.sql'),
      'utf8'
    );
    sqlite.exec(migration0007);

    const preservedSignal = sqlite
      .prepare(`SELECT signal_id, status, market_context, technical_score, evidence_payload FROM signals WHERE signal_id = 'sig_legacy'`)
      .get() as any;
    expect(preservedSignal).toMatchObject({
      signal_id: 'sig_legacy',
      status: 'PENDING_ENTRY',
      market_context: '{"macro":"LOW"}',
      technical_score: 75,
      evidence_payload: '{"fvg":true}',
    });

    const preservedDelivery = sqlite
      .prepare(`SELECT id, status, attempt_count FROM notification_deliveries WHERE id = 'nd_legacy'`)
      .get() as any;
    expect(preservedDelivery).toMatchObject({ id: 'nd_legacy', status: 'SENT', attempt_count: 1 });

    const fkErrors = sqlite.prepare('PRAGMA foreign_key_check').all();
    expect(fkErrors).toHaveLength(0);
  });

  it('supports setup and trade lifecycle statuses, nullable prices, and rejects invalid statuses', async () => {
    const { db, sqlite } = createSqliteD1();

    const validStatuses = [
      'DETECTED',
      'QUALIFIED',
      'REJECTED',
      'EXPIRED',
      'ALERT_ELIGIBLE',
      'ALERTED',
      'PENDING_ENTRY',
      'ACTIVE_TRADE',
      'TARGET_HIT',
      'STOP_HIT',
      'INVALIDATED',
    ];

    for (const status of validStatuses) {
      await db
        .prepare(
          `INSERT INTO signals (
             signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
             anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status
           ) VALUES (?, 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', NULL, NULL, NULL, NULL, ?)`
        )
        .bind(`sig_${status}`, status)
        .run();
    }

    const countRow = sqlite.prepare(`SELECT COUNT(*) as cnt FROM signals`).get() as any;
    expect(countRow.cnt).toBe(validStatuses.length);

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO signals (
             signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
             anchor_timeframe, execution_timeframe, status
           ) VALUES ('sig_invalid', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 'INVALID_ENUM')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/);

    // Duplicate primary key prevented
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO signals (
             signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
             anchor_timeframe, execution_timeframe, status
           ) VALUES ('sig_ALERT_ELIGIBLE', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 'ALERTED')`
        )
        .run()
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces notification_deliveries status constraints, unique signal+user+channel, and strategy_state persistence', async () => {
    const { db, sqlite } = createSqliteD1();

    await db
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, connected_at)
         VALUES ('u1', '123', '456', 'CONNECTED', '2026-11-17T00:00:00Z')`
      )
      .run();
    await db
      .prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, status
         ) VALUES ('sig_1', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 'ALERT_ELIGIBLE')`
      )
      .run();

    await db
      .prepare(
        `INSERT INTO notification_deliveries (id, signal_id, axnna_user_id, channel, destination, status, attempt_count, last_error, last_http_status, next_retry_at)
         VALUES ('nd1', 'sig_1', 'u1', 'TELEGRAM', '456', 'RETRY_SCHEDULED', 1, 'HTTP 429', 429, '2026-11-17T00:05:00Z')`
      )
      .run();

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO notification_deliveries (id, signal_id, axnna_user_id, channel, destination, status)
           VALUES ('nd2', 'sig_1', 'u1', 'TELEGRAM', '456', 'SENT')`
        )
        .run()
    ).toThrow(/UNIQUE constraint failed/);

    await db
      .prepare(
        `INSERT INTO strategy_state (instrument, strategy_id, strategy_version, last_processed_5m_timestamp, state_payload)
         VALUES ('EURUSD', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', '2026-11-17T01:00:00Z', '{"schemaVersion":1}')`
      )
      .run();

    const stateRow = await db
      .prepare(`SELECT state_payload FROM strategy_state WHERE instrument = 'EURUSD'`)
      .first<{ state_payload: string }>();
    expect(stateRow?.state_payload).toBe('{"schemaVersion":1}');
  });

  it('provisions Stage C operational tables and constraints in migration 0008', async () => {
    const { db, sqlite } = createSqliteD1();

    await db
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, connected_at)
         VALUES ('u_recap', '999', '999', 'CONNECTED', '2026-11-17T00:00:00Z')`
      )
      .run();

    await db
      .prepare(
        `INSERT INTO analytics_events (id, visitor_id, session_id, event_type, path, device_category, browser_category, country_code)
         VALUES ('ae_1', 'vis_1', 'sess_1', 'PAGE_VIEW', '/status', 'desktop', 'Chromium', 'KE')`
      )
      .run();

    await db
      .prepare(
        `INSERT INTO security_events (id, event_type, severity, source_category, actor_id, resource, details, resolution_status)
         VALUES ('se_1', 'AUTH_FAIL', 'MEDIUM', 'ADMIN_AUTH', 'hash123', '/api/config/login', 'Bad passphrase', 'OPEN')`
      )
      .run();

    await db
      .prepare(
        `INSERT INTO scheduled_job_runs (id, job_name, status, started_at, finished_at, duration_ms, summary)
         VALUES ('jr_1', 'CRON_5M', 'SUCCEEDED', '2026-11-17T00:00:00Z', '2026-11-17T00:00:02Z', 2000, 'Synced 4 pairs')`
      )
      .run();

    await db
      .prepare(
        `INSERT INTO contact_submissions (id, category, message, contact_info, client_hash, status)
         VALUES ('cs_1', 'Bug Report', 'Chart lag on mobile', 'user@example.com', 'ch_1', 'NEW')`
      )
      .run();

    await db
      .prepare(
        `INSERT INTO daily_recap_deliveries (id, recap_date, axnna_user_id, status, provider_message_id)
         VALUES ('dr_1', '2026-11-17', 'u_recap', 'SENT', 'tg_42')`
      )
      .run();

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO daily_recap_deliveries (id, recap_date, axnna_user_id, status)
           VALUES ('dr_2', '2026-11-17', 'u_recap', 'SENT')`
        )
        .run()
    ).toThrow(/UNIQUE constraint failed/);

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO security_events (id, event_type, severity, source_category)
           VALUES ('se_bad', 'AUTH_FAIL', 'EXTREME', 'ADMIN_AUTH')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/);

    const fkErrors = sqlite.prepare('PRAGMA foreign_key_check').all();
    expect(fkErrors).toHaveLength(0);
  });

  it('upgrades safely from migration 0008 to 0009, cleaning legacy raw IPs and adding Stage C.2 tables/columns', async () => {
    const { sqlite } = createSqliteD1('0008');

    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, connected_at)
         VALUES ('u_0008', '888', '888', 'CONNECTED', '2026-11-17T00:00:00Z')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO daily_recap_deliveries (id, recap_date, axnna_user_id, status)
         VALUES ('dr_0008', '2026-11-17', 'u_0008', 'FAILED')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO admin_login_attempts (client_key, failed_count)
         VALUES ('203.0.113.50', 2), ('abcdef0123456789abcdef0123456789', 3)`
      )
      .run();

    const migration0009 = fs.readFileSync(
      path.resolve(__dirname, '../migrations/0009_stage_c2_remediation.sql'),
      'utf8'
    );
    sqlite.exec(migration0009);

    const preservedRecap = sqlite
      .prepare(`SELECT id, status, attempt_count FROM daily_recap_deliveries WHERE id = 'dr_0008'`)
      .get() as any;
    expect(preservedRecap).toMatchObject({ id: 'dr_0008', status: 'FAILED', attempt_count: 1 });

    const attempts = sqlite.prepare(`SELECT client_key FROM admin_login_attempts`).all() as any[];
    expect(attempts).toEqual([{ client_key: 'abcdef0123456789abcdef0123456789' }]);

    sqlite
      .prepare(
        `INSERT INTO sync_leases (lock_name, owner_id, acquired_at, expires_at)
         VALUES ('CRON_OR_MANUAL_SYNC', 'owner_a', '2026-11-17T00:00:00Z', '2026-11-17T00:10:00Z')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO rate_limit_counters (bucket_key, window_start, count)
         VALUES ('analytics:abc', '2026-11-17 12:00:00', 1)`
      )
      .run();

    const fkErrors = sqlite.prepare('PRAGMA foreign_key_check').all();
    expect(fkErrors).toHaveLength(0);
  });

  it('upgrades safely from migration 0009 to 0010, creating paper_accounts, paper_trades, and risk_decisions with constraints', async () => {
    const { sqlite } = createSqliteD1('0009');

    const migration0010 = fs.readFileSync(
      path.resolve(__dirname, '../migrations/0010_stage_d_risk_and_paper_trading.sql'),
      'utf8'
    );
    sqlite.exec(migration0010);

    const account = sqlite.prepare(`SELECT id, starting_balance, current_balance, risk_per_trade_percent FROM paper_accounts WHERE id = 'default'`).get() as any;
    expect(account).toMatchObject({ id: 'default', starting_balance: 10000, current_balance: 10000, risk_per_trade_percent: 1.0 });

    sqlite
      .prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status
         ) VALUES ('sig_m10', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 1.1, 1.095, 1.11, 2.0, 'ALERT_ELIGIBLE')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO risk_decisions (id, signal_id, instrument, direction, strategy_version, technical_score, event_risk, decision, reason_code)
         VALUES ('rd_1', 'sig_m10', 'EURUSD', 'LONG', 'technical-v1', 80, 'LOW', 'APPROVED', 'RISK_APPROVED')`
      )
      .run();

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO risk_decisions (id, signal_id, instrument, direction, strategy_version, technical_score, event_risk, decision, reason_code)
           VALUES ('rd_2', 'sig_m10', 'EURUSD', 'LONG', 'technical-v1', 80, 'LOW', 'APPROVED', 'RISK_APPROVED')`
        )
        .run()
    ).toThrow(/UNIQUE constraint failed/);

    sqlite
      .prepare(
        `INSERT INTO paper_trades (
           id, account_id, signal_id, instrument, direction, strategy_id, strategy_version,
           intended_entry, stop_loss, target_price, status, outcome, signal_timestamp
         ) VALUES ('pt_1', 'default', 'sig_m10', 'EURUSD', 'LONG', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 1.1, 1.095, 1.11, 'PENDING_ENTRY', NULL, '2026-11-17T00:00:00Z')`
      )
      .run();

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO paper_trades (
             id, account_id, signal_id, instrument, direction, strategy_id, strategy_version,
             intended_entry, stop_loss, target_price, status, outcome, signal_timestamp
           ) VALUES ('pt_2', 'default', 'sig_m10', 'EURUSD', 'LONG', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 1.1, 1.095, 1.11, 'PENDING_ENTRY', NULL, '2026-11-17T00:00:00Z')`
        )
        .run()
    ).toThrow(/UNIQUE constraint failed/);

    const fkErrors = sqlite.prepare('PRAGMA foreign_key_check').all();
    expect(fkErrors).toHaveLength(0);
  });

  it('upgrades safely from migration 0010 to 0011, adding SENDING lock states and restoring overwritten signal alert statuses', async () => {
    const { sqlite } = createSqliteD1('0010');

    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, connected_at)
         VALUES ('u_m11', '777', '777', 'CONNECTED', '2026-11-17T00:00:00Z')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status
         ) VALUES
           ('sig_closed_alerted', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 1.1, 1.095, 1.11, 2.0, 'TARGET_HIT'),
           ('sig_closed_no_deliv', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'SHORT', '2026-11-17T00:05:00Z', '1H', '5M', 1.1, 1.105, 1.09, 2.0, 'ACTIVE_TRADE')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO notification_deliveries (id, signal_id, axnna_user_id, channel, destination, status, attempt_count)
         VALUES ('nd_m11', 'sig_closed_alerted', 'u_m11', 'TELEGRAM', '777', 'SENT', 1)`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO paper_trades (
           id, account_id, signal_id, instrument, direction, strategy_id, strategy_version,
           intended_entry, stop_loss, target_price, status, outcome, signal_timestamp
         ) VALUES
           ('pt_m11_1', 'default', 'sig_closed_alerted', 'EURUSD', 'LONG', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 1.1, 1.095, 1.11, 'TARGET_HIT', 'WIN', '2026-11-17T00:00:00Z'),
           ('pt_m11_2', 'default', 'sig_closed_no_deliv', 'EURUSD', 'SHORT', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 1.1, 1.105, 1.09, 'ACTIVE_TRADE', NULL, '2026-11-17T00:05:00Z')`
      )
      .run();

    const migration0011 = fs.readFileSync(
      path.resolve(__dirname, '../migrations/0011_stage_d2_release_integrity.sql'),
      'utf8'
    );
    sqlite.exec(migration0011);

    expect((sqlite.prepare(`SELECT status FROM signals WHERE signal_id = 'sig_closed_alerted'`).get() as any).status).toBe('ALERTED');
    expect((sqlite.prepare(`SELECT status FROM signals WHERE signal_id = 'sig_closed_no_deliv'`).get() as any).status).toBe('ALERT_ELIGIBLE');

    sqlite
      .prepare(
        `INSERT INTO notification_deliveries (id, signal_id, axnna_user_id, channel, destination, status, attempt_count)
         VALUES ('nd_m11_send', 'sig_closed_no_deliv', 'u_m11', 'TELEGRAM', '777', 'SENDING', 1)`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO daily_recap_deliveries (id, recap_date, axnna_user_id, status)
         VALUES ('dr_m11_send', '2026-11-17', 'u_m11', 'SENDING')`
      )
      .run();

    const fkErrors = sqlite.prepare('PRAGMA foreign_key_check').all();
    expect(fkErrors).toHaveLength(0);
  });
});
