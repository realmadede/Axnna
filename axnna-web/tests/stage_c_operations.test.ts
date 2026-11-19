import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { Env, retryScheduledDeliveries, runDailyRecap } from '../src/worker';
import { createSqliteD1 } from './helpers/sqliteD1';

describe('Stage C Unified Routing, Telemetry, Operations & Missing Features', () => {
  let env: Env;
  let sqlite: any;

  beforeEach(() => {
    const setup = createSqliteD1();
    sqlite = setup.sqlite;
    env = {
      DB: setup.db,
      ENVIRONMENT: 'staging',
      TELEGRAM_BOT_TOKEN: 'mock_bot_token',
      TELEGRAM_WEBHOOK_SECRET: 'mock_wh_secret_123',
      TWELVEDATA_API_KEY: 'mock_twelvedata_key',
      ALLOWED_ORIGINS: 'https://staging.axnna.example',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('delegates non-API routes to ASSETS SPA binding and keeps unmatched /api/* returning JSON 404', async () => {
    const assetsFetch = vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname;
      if (path === '/assets/missing-chunk.js') {
        return new Response('Asset not found', { status: 404 });
      }
      return new Response('<html>SPA Shell</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    const unifiedEnv: Env = { ...env, ASSETS: { fetch: assetsFetch } };

    for (const spaPath of ['/', '/status', '/config', '/connect-telegram']) {
      const res = await worker.fetch(new Request(`https://staging.axnna.example${spaPath}`), unifiedEnv);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('SPA Shell');
    }

    const missingAsset = await worker.fetch(
      new Request('https://staging.axnna.example/assets/missing-chunk.js'),
      unifiedEnv
    );
    expect(missingAsset.status).toBe(404);

    const unknownApi = await worker.fetch(
      new Request('https://staging.axnna.example/api/does-not-exist'),
      unifiedEnv
    );
    expect(unknownApi.status).toBe(404);
    expect(unknownApi.headers.get('Content-Type')).toContain('application/json');
    expect(await unknownApi.json()).toEqual({ error: 'Not Found' });
    expect(assetsFetch).toHaveBeenCalledTimes(5);
  });

  it('serves sanitized public /api/status without secrets or internal credentials', async () => {
    await env.DB.prepare(
      `INSERT INTO provider_health_state (provider_name, service_type, status, last_successful_sync, error_count)
       VALUES ('TwelveData', 'MARKET_DATA', 'HEALTHY', CURRENT_TIMESTAMP, 0),
              ('FreeEconomicCalendar', 'ECONOMIC_CALENDAR', 'HEALTHY', CURRENT_TIMESTAMP, 0)`
    ).run();

    const res = await worker.fetch(new Request('https://staging.axnna.example/api/status'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(['OPERATIONAL', 'INITIALIZING']).toContain(body.overallStatus);
    expect(body.monitoredInstruments).toEqual(['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']);
    expect(Array.isArray(body.subsystems)).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('mock_bot_token');
    expect(serialized).not.toContain('mock_twelvedata_key');
    expect(serialized).not.toContain('stage-c-admin-passphrase');
  });

  it('removes legacy /api/feedback, /api/analytics/event, /api/signals, and /api/config/* endpoints cleanly while preserving Telegram pairing', async () => {
    const removedFeedback = await worker.fetch(
      new Request('https://staging.axnna.example/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Bug Report', message: 'Legacy feedback endpoint check.' }),
      }),
      env
    );
    expect(removedFeedback.status).toBe(404);

    const removedAnalytics = await worker.fetch(
      new Request('https://staging.axnna.example/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'PAGE_VIEW', path: '/' }),
      }),
      env
    );
    expect(removedAnalytics.status).toBe(404);

    // Server-verified Telegram pairing works end-to-end without writing analytics_events
    const sessRes = await worker.fetch(new Request('https://staging.axnna.example/api/telegram/session', { method: 'POST' }), env);
    expect(sessRes.status).toBe(200);
    const { token } = (await sessRes.json()) as any;
    expect(typeof token).toBe('string');

    const hookRes = await worker.fetch(
      new Request('https://staging.axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'mock_wh_secret_123',
        },
        body: JSON.stringify({
          update_id: 99,
          message: { from: { id: 444555, username: 'verified_tg' }, chat: { id: 444555 }, text: `/start ${token}` },
        }),
      }),
      env
    );
    expect(hookRes.status).toBe(200);

    const pollRes = await worker.fetch(new Request(`https://staging.axnna.example/api/telegram/session/${token}`), env);
    expect(pollRes.status).toBe(200);
    expect(await pollRes.json()).toEqual({ status: 'CONNECTED' });

    // Removed /api/signals and /api/config/overview return 404 JSON
    const removedSignals = await worker.fetch(new Request('https://staging.axnna.example/api/signals'), env);
    expect(removedSignals.status).toBe(404);

    const removedOverview = await worker.fetch(new Request('https://staging.axnna.example/api/config/overview?days=7'), env);
    expect(removedOverview.status).toBe(404);

    const events = sqlite.prepare(`SELECT COUNT(*) as c FROM analytics_events`).get() as any;
    expect(events.c).toBe(0);
  });

  it('tracks provider health for market + calendar providers and records scheduled_job_runs on sync', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', values: [] }),
      })
    );

    await worker.runSynchronization(env, 'TEST_CRON_SYNC');

    const providers = sqlite
      .prepare(`SELECT provider_name, service_type, status FROM provider_health_state ORDER BY provider_name ASC`)
      .all() as any[];
    expect(providers.length).toBe(2);
    expect(providers.some((p) => p.service_type === 'ECONOMIC_CALENDAR')).toBe(true);
    expect(providers.some((p) => p.provider_name === 'twelvedata' && p.status === 'FAILED')).toBe(true);

    const jobRun = sqlite
      .prepare(`SELECT job_name, status, summary FROM scheduled_job_runs WHERE job_name = 'TEST_CRON_SYNC'`)
      .get() as any;
    expect(jobRun.job_name).toBe('TEST_CRON_SYNC');
    expect(['DEGRADED', 'FAILED', 'SUCCEEDED']).toContain(jobRun.status);
  });

  it('handles Telegram /status, /recap, idempotent daily recap delivery, and bounded manual retry', async () => {
    await env.DB.prepare(
      `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
       VALUES ('u_tg_1', '555111', '555111', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
    ).run();

    const sentPayloads: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.body) sentPayloads.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 9001 } }), { status: 200 });
      })
    );

    // /status EURUSD via authenticated webhook
    const statusRes = await worker.fetch(
      new Request('https://staging.axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'mock_wh_secret_123',
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            from: { id: 555111, username: 'trader' },
            chat: { id: 555111 },
            text: '/status EURUSD',
          },
        }),
      }),
      env
    );
    expect(statusRes.status).toBe(200);
    expect(sentPayloads.at(-1)?.text).toContain('AXNNA STATUS: EURUSD');

    // /recap when no signals triggered
    const recapCmdRes = await worker.fetch(
      new Request('https://staging.axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'mock_wh_secret_123',
        },
        body: JSON.stringify({
          update_id: 2,
          message: {
            from: { id: 555111, username: 'trader' },
            chat: { id: 555111 },
            text: '/recap',
          },
        }),
      }),
      env
    );
    expect(recapCmdRes.status).toBe(200);
    expect(sentPayloads.at(-1)?.text).toContain('Silence is a valid signal.');

    // Idempotent runDailyRecap for a fixed UTC date
    const count1 = await runDailyRecap(env, '2026-11-17');
    const count2 = await runDailyRecap(env, '2026-11-17');
    expect(count1).toBe(1);
    expect(count2).toBe(0);

    // Bounded manual retry via Admin route
    await env.DB.prepare(
      `INSERT INTO signals (
         signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
         anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status, technical_score
       ) VALUES (
         'sig_retry_1', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T10:00:00Z',
         '1H', '5M', 1.1000, 1.0950, 1.1100, 2.0, 'ALERT_ELIGIBLE', 75
       )`
    ).run();
    await env.DB.prepare(
      `INSERT INTO notification_deliveries (
         id, signal_id, axnna_user_id, channel, destination, status, attempt_count, last_error
       ) VALUES ('del_retry_1', 'sig_retry_1', 'u_tg_1', 'TELEGRAM', '555111', 'RETRY_SCHEDULED', 1, 'HTTP 429')`
    ).run();

    const recovered = await retryScheduledDeliveries(env);
    expect(recovered).toBe(1);
    const delRow = sqlite.prepare(`SELECT status FROM notification_deliveries WHERE id = 'del_retry_1'`).get() as any;
    expect(delRow.status).toBe('SENT');
  });

  it('serves cached read-only GET /api/performance metrics aggregated by instrument and score band without writing D1', async () => {
    sqlite.prepare(
      `INSERT OR IGNORE INTO paper_accounts (id, name, starting_balance, current_balance, risk_per_trade_percent) VALUES ('acct_perf', 'Default', 10000, 10000, 1.0)`
    ).run();
    sqlite.prepare(
      `INSERT INTO signals (signal_id, strategy_id, strategy_version, instrument, direction, generated_at, anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status, technical_score)
       VALUES
         ('sig_p1', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T10:00:00Z', '1H', '5M', 1.10, 1.09, 1.12, 2.0, 'ALERTED', 78),
         ('sig_p2', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'XAUUSD', 'SHORT', '2026-11-17T12:00:00Z', '1H', '5M', 2600, 2610, 2580, 2.0, 'ALERTED', 88)`
    ).run();
    sqlite.prepare(
      `INSERT INTO paper_trades (id, account_id, signal_id, instrument, timeframe, direction, strategy_id, strategy_version, intended_entry, stop_loss, target_price, risk_amount, status, outcome, r_multiple, signal_timestamp)
       VALUES
         ('pt_1', 'acct_perf', 'sig_p1', 'EURUSD', '5M', 'LONG', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 1.10, 1.09, 1.12, 100, 'TARGET_HIT', 'WIN', 1.9, '2026-11-17T10:00:00Z'),
         ('pt_2', 'acct_perf', 'sig_p2', 'XAUUSD', '5M', 'SHORT', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 2600, 2610, 2580, 100, 'STOP_HIT', 'LOSS', -1.0, '2026-11-17T12:00:00Z')`
    ).run();

    const res = await worker.fetch(new Request('https://staging.axnna.example/api/performance'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');

    const body = (await res.json()) as any;
    expect(body.summary).toMatchObject({
      closedTrades: 2,
      wins: 1,
      losses: 1,
      winRate: 50,
      totalR: 0.9,
      averageR: 0.45,
    });
    expect(body.byInstrument.find((r: any) => r.instrument === 'EURUSD')).toMatchObject({ closedTrades: 1, wins: 1, totalR: 1.9 });
    expect(body.byScoreBand.find((r: any) => r.band === '75-84')).toMatchObject({ closedTrades: 1, wins: 1, winRate: 100 });
    expect(body.byScoreBand.find((r: any) => r.band === '85+')).toMatchObject({ closedTrades: 1, losses: 1, winRate: 0 });
  });
});
