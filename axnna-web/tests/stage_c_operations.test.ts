import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { Env, runDailyRecap } from '../src/worker';
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
      ADMIN_PASSPHRASE: 'stage-c-admin-passphrase',
      ADMIN_SESSION_SECRET: 'stage-c-hmac-signing-secret-32chars',
      ALLOWED_ORIGINS: 'https://staging.axnna.example',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function loginAdmin(): Promise<string> {
    const res = await worker.fetch(
      new Request('https://staging.axnna.example/api/auth/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://staging.axnna.example',
        },
        body: JSON.stringify({ passphrase: 'stage-c-admin-passphrase' }),
      }),
      env
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('SameSite=Strict');
    return res.headers.get('Set-Cookie')!.split(';')[0];
  }

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

  it('validates, honeypot-filters, rate-limits, persists, and admin-triages POST /api/feedback', async () => {
    const invalid = await worker.fetch(
      new Request('https://staging.axnna.example/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'InvalidCat', message: 'short' }),
      }),
      env
    );
    expect(invalid.status).toBe(400);

    // Honeypot triggered returns 201 without writing to contact_submissions
    const honeypot = await worker.fetch(
      new Request('https://staging.axnna.example/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'General Inquiry',
          message: 'Bot message that should not be saved.',
          website: 'https://spam.invalid',
        }),
      }),
      env
    );
    expect(honeypot.status).toBe(201);
    expect((sqlite.prepare(`SELECT COUNT(*) as c FROM contact_submissions`).get() as any).c).toBe(0);

    // Three allowed submissions per hour from the same client IP hash
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.24' };
    let firstId = '';
    for (let i = 0; i < 3; i++) {
      const res = await worker.fetch(
        new Request('https://staging.axnna.example/api/feedback', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            category: 'Bug Report',
            message: `Valid feedback submission number ${i + 1} describing issue.`,
            contact: '@trader_handle',
          }),
        }),
        env
      );
      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      if (i === 0) firstId = data.id;
    }

    // Fourth submission within the hour triggers 429 and logs a security event
    const limited = await worker.fetch(
      new Request('https://staging.axnna.example/api/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          category: 'Bug Report',
          message: 'Fourth submission exceeding hourly rate limit.',
        }),
      }),
      env
    );
    expect(limited.status).toBe(429);

    const secRow = sqlite
      .prepare(`SELECT event_type, source_category FROM security_events WHERE event_type = 'CONTACT_RATE_LIMITED'`)
      .get() as any;
    expect(secRow).toEqual({ event_type: 'CONTACT_RATE_LIMITED', source_category: 'RATE_LIMIT' });

    // Admin reviews submission status
    const cookie = await loginAdmin();
    const triage = await worker.fetch(
      new Request(`https://staging.axnna.example/api/config/contact/${firstId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://staging.axnna.example',
          'X-Requested-With': 'AxnnaAdmin',
        },
        body: JSON.stringify({ status: 'REVIEWED' }),
      }),
      env
    );
    expect(triage.status).toBe(200);
    const saved = sqlite.prepare(`SELECT status FROM contact_submissions WHERE id = ?`).get(firstId) as any;
    expect(saved.status).toBe('REVIEWED');
  });

  it('ingests privacy-safe analytics events and serves admin-only multi-window aggregations + security resolution', async () => {
    const badAnalytics = await worker.fetch(
      new Request('https://staging.axnna.example/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'UNKNOWN_EVENT', path: 'no-slash' }),
      }),
      env
    );
    expect(badAnalytics.status).toBe(400);

    const badConversion = await worker.fetch(
      new Request('https://staging.axnna.example/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'TELEGRAM_CONNECT_COMPLETED',
          path: '/connect-telegram',
          visitorId: 'visitor_12345678',
          sessionId: 'session_12345678',
        }),
      }),
      env
    );
    expect(badConversion.status).toBe(400);

    for (const evt of [
      { eventType: 'PAGE_VIEW', path: '/' },
      { eventType: 'TELEGRAM_CONNECT_STARTED', path: '/connect-telegram' },
    ]) {
      const req = new Request('https://staging.axnna.example/api/analytics/event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/122.0 Mobile Safari/537.36',
        },
        body: JSON.stringify({
          ...evt,
          visitorId: 'visitor_12345678',
          sessionId: 'session_12345678',
          referrer: 'https://search.example/results?q=axnna',
        }),
      });
      (req as any).cf = { country: 'KE' };
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(202);
    }

    // Server-verified Telegram connection writes TELEGRAM_CONNECT_COMPLETED
    const sessRes = await worker.fetch(new Request('https://staging.axnna.example/api/telegram/session', { method: 'POST' }), env);
    const { token } = (await sessRes.json()) as any;
    await worker.fetch(
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

    // Trigger an unauthorized request to verify security event recording
    const unauthSignals = await worker.fetch(new Request('https://staging.axnna.example/api/signals'), env);
    expect(unauthSignals.status).toBe(401);

    // Overview blocked for unauthenticated callers
    const unauthOverview = await worker.fetch(new Request('https://staging.axnna.example/api/config/overview?days=7'), env);
    expect(unauthOverview.status).toBe(401);

    const cookie = await loginAdmin();
    const overviewRes = await worker.fetch(
      new Request('https://staging.axnna.example/api/config/overview?days=30', {
        headers: { Cookie: cookie },
      }),
      env
    );
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as any;

    expect(overview.analytics.days).toBe(30);
    expect(overview.analytics.summary.totalEvents).toBe(3);
    expect(overview.analytics.summary.uniqueVisitors).toBe(2);
    expect(overview.analytics.summary.pageViews).toBe(1);
    expect(overview.analytics.devices[0]).toMatchObject({ device: 'mobile', count: 1 });
    expect(overview.analytics.countries[0]).toMatchObject({ country: 'KE', count: 1 });
    expect(overview.analytics.topReferrers[0]).toMatchObject({ source: 'search.example', visits: 1 });
    expect(overview.systemConfig.secrets.find((s: any) => s.key === 'TELEGRAM_BOT_TOKEN')?.configured).toBe(true);
    expect(JSON.stringify(overview)).not.toContain('mock_bot_token');

    expect(overview.securityEvents.length).toBeGreaterThanOrEqual(1);
    const secId = overview.securityEvents[0].id;
    const resolveRes = await worker.fetch(
      new Request(`https://staging.axnna.example/api/config/security/${secId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://staging.axnna.example',
          'X-Requested-With': 'AxnnaAdmin',
        },
        body: JSON.stringify({ resolutionStatus: 'RESOLVED' }),
      }),
      env
    );
    expect(resolveRes.status).toBe(200);
    const resolvedRow = sqlite.prepare(`SELECT resolution_status FROM security_events WHERE id = ?`).get(secId) as any;
    expect(resolvedRow.resolution_status).toBe('RESOLVED');
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

    const cookie = await loginAdmin();
    const retryRes = await worker.fetch(
      new Request('https://staging.axnna.example/api/config/deliveries/del_retry_1/retry', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://staging.axnna.example',
          'X-Requested-With': 'AxnnaAdmin',
        },
      }),
      env
    );
    expect(retryRes.status).toBe(200);
    const retryJson = (await retryRes.json()) as any;
    expect(retryJson).toMatchObject({ ok: true, status: 'SENT' });
  });
});
