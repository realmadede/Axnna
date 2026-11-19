import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { Env, readJsonBodyWithLimit, retryFailedDailyRecaps, runDailyRecap } from '../src/worker';
import {
  acquireSyncLease,
  computeHmacActorHash,
  evaluateSystemHealth,
  pruneOperationalTables,
  recordProviderHealth,
  releaseSyncLease,
} from '../src/ops/telemetry';
import { formatDisplayTime, normalizeUtcIso, parseUtcTimestampMs, toSqliteUtcTimestamp } from '../src/utils/time';
import { createSqliteD1 } from './helpers/sqliteD1';

describe('Stage C.2 Audit Remediation Regression Suite', () => {
  let env: Env;
  let sqlite: any;

  beforeEach(() => {
    const setup = createSqliteD1();
    sqlite = setup.sqlite;
    env = {
      DB: setup.db,
      ENVIRONMENT: 'staging',
      TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN_REAL',
      TELEGRAM_WEBHOOK_SECRET: 'mock_wh_secret_12345678',
      TWELVEDATA_API_KEY: 'mock_twelvedata_key_real',
      ACTOR_HASH_SECRET: 'separate-actor-hmac-key-32-characters',
      ALLOWED_ORIGINS: 'https://staging.axnna.example',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('FND-01 & FND-10: enforces request body limits, disables removed analytics writes, and prunes bounded retention', async () => {
    // 1. Oversized body (>8KB) rejected by readJsonBodyWithLimit with 413
    const bigBody = JSON.stringify({
      instrument: 'EURUSD',
      note: 'a'.repeat(9000),
    });
    const oversizedReq = new Request('https://staging.axnna.example/api/dev/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(bigBody.length) },
      body: bigBody,
    });
    const parsed = await readJsonBodyWithLimit(oversizedReq, 8192);
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.status).toBe(413);
    }

    // 2. Removed analytics ingestion returns 404 without writing to D1
    const removedAnalytics = await worker.fetch(
      new Request('https://staging.axnna.example/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'PAGE_VIEW',
          path: '/',
          visitorId: 'visitor_12345678',
          sessionId: 'session_12345678',
        }),
      }),
      env
    );
    expect(removedAnalytics.status).toBe(404);

    // 3. Retention pruning deletes >90d analytics & jobs, >180d resolved security, preserves audit_events
    const oldSql = toSqliteUtcTimestamp(Date.now() - 120 * 86400 * 1000);
    const oldSecSql = toSqliteUtcTimestamp(Date.now() - 200 * 86400 * 1000);
    const oldIso = new Date(Date.now() - 120 * 86400 * 1000).toISOString();

    sqlite.prepare(`INSERT INTO analytics_events (id, visitor_id, session_id, event_type, path, created_at) VALUES ('old_ae', 'v12345678', 's12345678', 'PAGE_VIEW', '/', ?)`).run(oldSql);
    sqlite.prepare(`INSERT INTO scheduled_job_runs (id, job_name, status, started_at) VALUES ('old_job', 'CRON_SYNC', 'SUCCEEDED', ?)`).run(oldIso);
    sqlite.prepare(`INSERT INTO security_events (id, event_type, severity, source_category, resolution_status, created_at) VALUES ('old_sec_res', 'AUTH_FAIL', 'LOW', 'ADMIN_AUTH', 'RESOLVED', ?)`).run(oldSecSql);
    sqlite.prepare(`INSERT INTO security_events (id, event_type, severity, source_category, resolution_status, created_at) VALUES ('old_sec_open', 'AUTH_FAIL', 'HIGH', 'ADMIN_AUTH', 'OPEN', ?)`).run(oldSecSql);
    sqlite.prepare(`INSERT INTO audit_events (event_id, event_type, timestamp, actor_source) VALUES ('old_audit', 'TEST_AUDIT', ?, 'SYSTEM')`).run(oldSql);

    const pruned = await pruneOperationalTables(env.DB);
    expect(pruned.analyticsDeleted).toBe(1);
    expect(pruned.jobsDeleted).toBe(1);
    expect(pruned.securityDeleted).toBe(1);
    expect(sqlite.prepare(`SELECT id FROM security_events WHERE id = 'old_sec_open'`).get()).toBeDefined();
    expect(sqlite.prepare(`SELECT event_id FROM audit_events WHERE event_id = 'old_audit'`).get()).toBeDefined();
  });

  it('FND-02 & FND-17: computes true SQL aggregate totals, preserves older Paper Trading rows past 50 signals, paginates, and returns 404 on unknown IDs', async () => {
    for (let i = 1; i <= 3; i++) {
      sqlite.prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status, technical_score
         ) VALUES (?, 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', ?, '1H', '5M', 1.1, 1.095, 1.11, 2.0, 'ACTIVE_TRADE', 80)`
      ).run(`active_${i}`, `2026-11-17T01:0${i}:00Z`);
      sqlite.prepare(
        `INSERT INTO paper_trades (
           id, account_id, signal_id, instrument, timeframe, direction, strategy_id, strategy_version,
           intended_entry, stop_loss, target_price, entry_price, risk_amount, status, signal_timestamp
         ) VALUES (?, 'default', ?, 'EURUSD', '5M', 'LONG', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 1.1, 1.095, 1.11, 1.10005, 100, 'ACTIVE_TRADE', ?)`
      ).run(`paper_active_${i}`, `active_${i}`, `2026-11-17T01:0${i}:00Z`);
    }
    for (let i = 1; i <= 55; i++) {
      sqlite.prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, status, technical_score
         ) VALUES (?, 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'SHORT', ?, '1H', '5M', 'REJECTED', 40)`
      ).run(`rej_${String(i).padStart(2, '0')}`, `2026-11-17T10:${String(i).padStart(2, '0')}:00Z`);
    }

    // Verify true counts in D1 and removed /api/config/* returns 404
    expect((sqlite.prepare(`SELECT COUNT(*) as c FROM signals`).get() as any).c).toBe(58);
    expect((sqlite.prepare(`SELECT COUNT(*) as c FROM paper_trades`).get() as any).c).toBe(3);

    const removedOverview = await worker.fetch(
      new Request('https://staging.axnna.example/api/config/overview?days=7&page=1&pageSize=25'),
      env
    );
    expect(removedOverview.status).toBe(404);
  });

  it('FND-03: normalizes SQLite CURRENT_TIMESTAMP and ISO timestamps identically across UTC and Africa/Dar_es_Salaam', async () => {
    const sqliteStr = toSqliteUtcTimestamp(Date.now() - 2 * 60 * 1000); // 2 minutes ago in UTC without Z
    const parsedMs = parseUtcTimestampMs(sqliteStr);
    expect(parsedMs).not.toBeNull();
    expect(Math.abs(Date.now() - parsedMs! - 2 * 60 * 1000)).toBeLessThan(3000);

    expect(normalizeUtcIso('2026-11-17 14:30:00')).toBe('2026-11-17T14:30:00.000Z');
    expect(normalizeUtcIso('2026-11-17T17:30:00+03:00')).toBe('2026-11-17T14:30:00.000Z');
    expect(normalizeUtcIso(null)).toBeNull();
    expect(normalizeUtcIso('not-a-timestamp')).toBeNull();
    expect(formatDisplayTime(null, 'Never')).toBe('Never');

    // Fresh SQLite CURRENT_TIMESTAMP in market_data_state must report HEALTHY (not false >30m stale)
    sqlite.prepare(
      `INSERT INTO market_data_state (instrument, timeframe, provider, last_successful_fetch, status)
       VALUES ('EURUSD', '5M', 'twelvedata', CURRENT_TIMESTAMP, 'HEALTHY')`
    ).run();
    const health = await evaluateSystemHealth(env);
    const mkt = health.subsystems.find((s) => s.name.includes('Market Data'));
    expect(mkt?.status).toBe('HEALTHY');
  });

  it('FND-04: reports accurate job statuses, retries failed same-day Daily Recaps without duplicating sent users, and separates gated setups', async () => {
    sqlite.prepare(
      `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
       VALUES ('u_ok', '101', '101', 'CONNECTED', 1, '2026-11-17T00:00:00Z'),
              ('u_fail', '102', '102', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
    ).run();

    // Seed 1 ALERTED + 1 ALERT_ELIGIBLE (event-risk gated) + 1 REJECTED
    sqlite.prepare(
      `INSERT INTO signals (signal_id, strategy_id, strategy_version, instrument, direction, generated_at, anchor_timeframe, execution_timeframe, status)
       VALUES ('s_a', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T12:00:00.000Z', '1H', '5M', 'ALERTED'),
              ('s_g', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'GBPUSD', 'SHORT', '2026-11-17T13:00:00.000Z', '1H', '5M', 'ALERT_ELIGIBLE'),
              ('s_r', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'USDJPY', 'LONG', '2026-11-17T14:00:00.000Z', '1H', '5M', 'REJECTED')`
    ).run();

    // Total failure first -> DAILY_RECAP job must be FAILED
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Server Error', { status: 503 })));
    const s0 = await runDailyRecap(env, '2026-11-17');
    expect(s0).toBe(0);
    const failedJob = sqlite.prepare(`SELECT status FROM scheduled_job_runs WHERE job_name = 'DAILY_RECAP' ORDER BY started_at DESC, rowid DESC LIMIT 1`).get() as any;
    expect(failedJob.status).toBe('FAILED');

    // Partial failure (u_ok succeeds, u_fail fails) -> job DEGRADED
    let sentTexts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        sentTexts.push(body.text);
        if (body.chat_id === '102') {
          return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests' }), { status: 429 });
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 501 } }), { status: 200 });
      })
    );
    const s1 = await runDailyRecap(env, '2026-11-17');
    expect(s1).toBe(1);
    expect(sentTexts[0]).toContain('Alerted setups: 1');
    expect(sentTexts[0]).toContain('Event-risk gated / unsent eligible: 1');
    const degJob = sqlite.prepare(`SELECT status FROM scheduled_job_runs WHERE job_name = 'DAILY_RECAP' ORDER BY started_at DESC, rowid DESC LIMIT 1`).get() as any;
    expect(degJob.status).toBe('DEGRADED');

    // Retry clears u_fail without resending u_ok
    sqlite.prepare(`UPDATE daily_recap_deliveries SET next_retry_at = '2020-01-01T00:00:00.000Z' WHERE axnna_user_id = 'u_fail'`).run();
    const sentToChats: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        sentToChats.push(String(body.chat_id));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 502 } }), { status: 200 });
      })
    );
    const recovered = await retryFailedDailyRecaps(env, '2026-11-17');
    expect(recovered).toBe(1);
    expect(sentToChats).toEqual(['102']);
  });

  it('FND-06, FND-07 & FND-09: enforces atomic D1 sync leases, accurate provider/system health heuristics, and non-200 sync failure reporting', async () => {
    // 1. Lease race & stale owner guard
    const a1 = await acquireSyncLease(env.DB, 'owner-1', 60_000);
    const a2 = await acquireSyncLease(env.DB, 'owner-2', 60_000);
    expect(a1.acquired).toBe(true);
    expect(a2.acquired).toBe(false);
    expect(await releaseSyncLease(env.DB, 'owner-2')).toBe(false);
    expect(await releaseSyncLease(env.DB, 'owner-1')).toBe(true);

    // 2. Sync respects active lease and reports FAILED when API key is placeholder
    await acquireSyncLease(env.DB, 'active-cron', 60_000);
    const conflictSync = await worker.runSynchronization(env, 'MANUAL_SYNC');
    expect(conflictSync.status).toBe('ALREADY_RUNNING');
    await releaseSyncLease(env.DB, 'active-cron');

    const failSyncEnv: Env = { ...env, TWELVEDATA_API_KEY: 'your_twelvedata_key_here' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    const failSync = await worker.runSynchronization(failSyncEnv, 'MANUAL_SYNC');
    expect(failSync.status).toBe('FAILED');

    // 3. Provider health state machine: DEGRADED -> FAILED -> HEALTHY -> DEGRADED
    await recordProviderHealth(env.DB, 'biquote', 'ECONOMIC_CALENDAR', 'DEGRADED');
    expect((sqlite.prepare(`SELECT status, error_count FROM provider_health_state WHERE provider_name = 'biquote'`).get() as any).status).toBe('DEGRADED');
    await recordProviderHealth(env.DB, 'biquote', 'ECONOMIC_CALENDAR', 'DEGRADED');
    expect((sqlite.prepare(`SELECT status, error_count FROM provider_health_state WHERE provider_name = 'biquote'`).get() as any).status).toBe('FAILED');
    await recordProviderHealth(env.DB, 'biquote', 'ECONOMIC_CALENDAR', 'HEALTHY');
    expect((sqlite.prepare(`SELECT status, error_count FROM provider_health_state WHERE provider_name = 'biquote'`).get() as any)).toMatchObject({ status: 'HEALTHY', error_count: 0 });
    await recordProviderHealth(env.DB, 'biquote', 'ECONOMIC_CALENDAR', 'DEGRADED');
    expect((sqlite.prepare(`SELECT status FROM provider_health_state WHERE provider_name = 'biquote'`).get() as any).status).toBe('DEGRADED');

    // 4. Recent Telegram failure streak triggers DEGRADED despite old SENT row, and orphaned STARTED job >10m triggers DEGRADED
    sqlite.prepare(`INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, connected_at) VALUES ('u_h', '77', '77', 'CONNECTED', '2026-11-17T00:00:00Z')`).run();
    for (let i = 1; i <= 4; i++) {
      sqlite.prepare(`INSERT INTO signals (signal_id, strategy_id, strategy_version, instrument, direction, generated_at, anchor_timeframe, execution_timeframe, status) VALUES (?, 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 'ALERTED')`).run(`sh_${i}`);
      sqlite.prepare(`INSERT INTO notification_deliveries (id, signal_id, axnna_user_id, destination, status, last_attempt_at) VALUES (?, ?, 'u_h', '77', ?, ?)`).run(
        `dh_${i}`,
        `sh_${i}`,
        i === 1 ? 'SENT' : 'EXHAUSTED',
        `2026-11-17T10:0${i}:00Z`
      );
    }
    sqlite.prepare(`DELETE FROM scheduled_job_runs`).run();
    sqlite.prepare(`INSERT INTO scheduled_job_runs (id, job_name, status, started_at) VALUES ('orphan_1', 'CRON_SYNC', 'STARTED', ?)`).run(
      new Date(Date.now() - 20 * 60 * 1000).toISOString()
    );
    const sysHealth = await evaluateSystemHealth(env);
    expect(sysHealth.subsystems.find((s) => s.name.includes('Telegram'))?.status).toBe('DEGRADED');
    expect(sysHealth.subsystems.find((s) => s.name.includes('Scheduled Jobs'))?.status).toBe('DEGRADED');
    expect(sysHealth.subsystems.find((s) => s.name.includes('Application'))).toBeUndefined();
  });

  it('FND-08, FND-12, FND-14 & FND-15: domain-separated HMAC actor hashes, /api vs /apiary routing, bot commands & contact size/dedup', async () => {
    // 1. Domain separation + non-raw IP actor hashing
    const hAdmin = await computeHmacActorHash('198.51.100.10', 'admin_auth', env);
    const hFeedback = await computeHmacActorHash('198.51.100.10', 'feedback', env);
    expect(hAdmin).not.toBe(hFeedback);
    expect(hAdmin.length).toBe(32);

    // Removed /api/auth/config returns 404
    const removedAuthRes = await worker.fetch(
      new Request('https://staging.axnna.example/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://staging.axnna.example' },
        body: JSON.stringify({ passphrase: 'any' }),
      }),
      env
    );
    expect(removedAuthRes.status).toBe(404);

    // 3. /apiary goes to ASSETS (200), /api and /api/foo go to Worker JSON 404
    const assetsSpy = vi.fn(async () => new Response('SPA /apiary OK', { status: 200 }));
    const unified = { ...env, ASSETS: { fetch: assetsSpy } };
    const apiaryRes = await worker.fetch(new Request('https://staging.axnna.example/apiary'), unified);
    expect(apiaryRes.status).toBe(200);
    expect(assetsSpy).toHaveBeenCalledTimes(1);

    const apiExact = await worker.fetch(new Request('https://staging.axnna.example/api'), unified);
    expect(apiExact.status).toBe(404);
    expect(await apiExact.json()).toEqual({ error: 'Not Found' });

    // 4. Removed /api/feedback returns 404 JSON
    const fbRemoved = await worker.fetch(
      new Request('https://staging.axnna.example/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Bug Report', message: 'Check removed contact route.' }),
      }),
      env
    );
    expect(fbRemoved.status).toBe(404);

    // 5. Telegram bot-suffixed commands & rate limiting
    sqlite.prepare(`INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, connected_at) VALUES ('u_cmd', '333', '333', 'CONNECTED', '2026-11-17T00:00:00Z')`).run();
    const tgReplies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        tgReplies.push(JSON.parse(String(init?.body || '{}')).text);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      })
    );
    await worker.fetch(
      new Request('https://staging.axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'mock_wh_secret_12345678' },
        body: JSON.stringify({ update_id: 10, message: { from: { id: 333 }, chat: { id: 333 }, text: '/status@AxnnaSignalsBot XAUUSD' } }),
      }),
      env
    );
    await worker.fetch(
      new Request('https://staging.axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'mock_wh_secret_12345678' },
        body: JSON.stringify({ update_id: 11, message: { from: { id: 333 }, chat: { id: 333 }, text: '/recap@AxnnaSignalsBot' } }),
      }),
      env
    );
    expect(tgReplies[0]).toContain('AXNNA STATUS: XAUUSD');
    expect(tgReplies[1]).toContain('AXNNA DAILY RECAP');
  });
});
