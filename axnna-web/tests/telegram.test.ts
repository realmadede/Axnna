import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { deliverTelegramAlerts, retryScheduledDeliveries, Env } from '../src/worker';
import { CandidateSetup } from '../src/core-engine/Types';
import { createSqliteD1 } from './helpers/sqliteD1';

describe('Telegram Pairing, Webhook Security & Delivery Reliability', () => {
  let env: Env;
  let sqlite: any;

  beforeEach(() => {
    const setup = createSqliteD1();
    sqlite = setup.sqlite;
    env = {
      DB: setup.db,
      TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN',
      TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret-token',
      TWELVEDATA_API_KEY: 'test_td_key',
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a pairing session, notifies existing users if already connected, supports /disconnect & web disconnect, and reconnects cleanly', async () => {
    const botMessages: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        botMessages.push(JSON.parse(String(init?.body || '{}')).text);
        return new Response(JSON.stringify({ ok: true, result: { message_id: botMessages.length } }), { status: 200 });
      })
    );

    // 1. Create pairing session
    const createRes = await worker.fetch(
      new Request('https://axnna.example/api/telegram/session', { method: 'POST' }),
      env
    );
    expect(createRes.status).toBe(200);
    const { token } = (await createRes.json()) as { token: string };
    expect(token).toBeTruthy();

    // 2. Poll before expiry -> PENDING
    const pollRes1 = await worker.fetch(
      new Request(`https://axnna.example/api/telegram/session/${token}`),
      env
    );
    expect(pollRes1.status).toBe(200);
    expect(await pollRes1.json()).toEqual({ status: 'PENDING' });

    // 3. Valid webhook /start connects user, marks session CONNECTED, and sends welcome message
    const webhookRes = await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-token',
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            text: `/start ${token}`,
            from: { id: 555001, username: 'trader_one', first_name: 'Trader', last_name: 'One' },
            chat: { id: 555001, type: 'private' },
          },
        }),
      }),
      env
    );
    expect(webhookRes.status).toBe(200);
    expect(botMessages.at(-1)).toContain('Connected to Axnna!');

    const pollRes2 = await worker.fetch(
      new Request(`https://axnna.example/api/telegram/session/${token}`),
      env
    );
    expect(await pollRes2.json()).toEqual({ status: 'CONNECTED' });

    // 4. Re-connecting from another session notifies user inside Telegram without creating duplicate user rows
    const createRes2 = await worker.fetch(
      new Request('https://axnna.example/api/telegram/session', { method: 'POST' }),
      env
    );
    const { token: token2 } = (await createRes2.json()) as { token: string };
    await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-token',
        },
        body: JSON.stringify({
          update_id: 2,
          message: {
            text: `/start ${token2}`,
            from: { id: 555001, username: 'trader_one' },
            chat: { id: 555001, type: 'private' },
          },
        }),
      }),
      env
    );
    const userCount = sqlite.prepare(`SELECT COUNT(*) as cnt FROM axnna_users`).get() as any;
    expect(userCount.cnt).toBe(1);
    expect(botMessages.at(-1)).toContain('already connected to Axnna');

    // 5. Disconnecting via /disconnect disables alerts and updates session poll state to DISCONNECTED
    await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-token',
        },
        body: JSON.stringify({
          update_id: 3,
          message: { text: '/disconnect', from: { id: 555001 }, chat: { id: 555001 } },
        }),
      }),
      env
    );
    expect(botMessages.at(-1)).toContain('Disconnected from Axnna');
    const userAfterDc = sqlite.prepare(`SELECT status, signal_notifications_enabled, disconnected_at FROM axnna_users WHERE telegram_user_id = '555001'`).get() as any;
    expect(userAfterDc.status).toBe('DISCONNECTED');
    expect(userAfterDc.signal_notifications_enabled).toBe(0);
    expect(userAfterDc.disconnected_at).toBeTruthy();

    const pollAfterDc = await worker.fetch(
      new Request(`https://axnna.example/api/telegram/session/${token2}`),
      env
    );
    expect(await pollAfterDc.json()).toEqual({ status: 'DISCONNECTED' });

    // 6. Reconnecting resets signal_notifications_enabled = 1 and clears disconnected_at, and web disconnect works too
    const createRes3 = await worker.fetch(
      new Request('https://axnna.example/api/telegram/session', { method: 'POST' }),
      env
    );
    const { token: token3 } = (await createRes3.json()) as { token: string };
    await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-token',
        },
        body: JSON.stringify({
          update_id: 4,
          message: { text: `/start ${token3}`, from: { id: 555001 }, chat: { id: 555001 } },
        }),
      }),
      env
    );
    const userReconnected = sqlite.prepare(`SELECT status, signal_notifications_enabled, disconnected_at FROM axnna_users WHERE telegram_user_id = '555001'`).get() as any;
    expect(userReconnected).toEqual({ status: 'CONNECTED', signal_notifications_enabled: 1, disconnected_at: null });

    const webDcRes = await worker.fetch(
      new Request('https://axnna.example/api/telegram/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token3 }),
      }),
      env
    );
    expect(webDcRes.status).toBe(200);
    expect(await webDcRes.json()).toEqual({ status: 'DISCONNECTED' });
    const userAfterWebDc = sqlite.prepare(`SELECT status, signal_notifications_enabled FROM axnna_users WHERE telegram_user_id = '555001'`).get() as any;
    expect(userAfterWebDc).toEqual({ status: 'DISCONNECTED', signal_notifications_enabled: 0 });
  });

  it('expires pending sessions on poll when deadline passes and rejects expired/unknown pairing codes', async () => {
    const createRes = await worker.fetch(
      new Request('https://axnna.example/api/telegram/session', { method: 'POST' }),
      env
    );
    const { token } = (await createRes.json()) as { token: string };

    // Force expiration in DB
    sqlite
      .prepare(`UPDATE telegram_connection_sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE connection_token = ?`)
      .run(token);

    // Webhook attempt on expired token must not connect a user
    await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-token',
        },
        body: JSON.stringify({
          message: { text: `/start ${token}`, from: { id: 999 }, chat: { id: 999 } },
        }),
      }),
      env
    );
    expect((sqlite.prepare(`SELECT COUNT(*) as cnt FROM axnna_users`).get() as any).cnt).toBe(0);

    // Polling returns EXPIRED
    const createRes2 = await worker.fetch(
      new Request('https://axnna.example/api/telegram/session', { method: 'POST' }),
      env
    );
    const { token: token2 } = (await createRes2.json()) as { token: string };
    sqlite
      .prepare(`UPDATE telegram_connection_sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE connection_token = ?`)
      .run(token2);

    const pollExpired = await worker.fetch(
      new Request(`https://axnna.example/api/telegram/session/${token2}`),
      env
    );
    expect(await pollExpired.json()).toEqual({ status: 'EXPIRED' });

    const pollUnknown = await worker.fetch(
      new Request('https://axnna.example/api/telegram/session/nonexistent-token'),
      env
    );
    expect(pollUnknown.status).toBe(404);
  });

  it('enforces webhook secret-token validation and rejects malformed payloads without crashing', async () => {
    // Missing server config -> 503 fail closed
    const noSecretEnv = { ...env, TELEGRAM_WEBHOOK_SECRET: undefined };
    const res503 = await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', { method: 'POST', body: '{}' }),
      noSecretEnv
    );
    expect(res503.status).toBe(503);

    // Missing or wrong header -> 401
    const res401 = await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
        body: '{}',
      }),
      env
    );
    expect(res401.status).toBe(401);

    // Malformed JSON -> 400
    const res400Json = await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-token' },
        body: '{not-json',
      }),
      env
    );
    expect(res400Json.status).toBe(400);

    // Missing message (e.g. edited_channel_post) -> 200 ignored safely
    const resIgnored = await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-token' },
        body: JSON.stringify({ update_id: 9, channel_post: { text: 'hello' } }),
      }),
      env
    );
    expect(resIgnored.status).toBe(200);

    // Missing/invalid from or chat -> 400 without crash
    const resBadSender = await worker.fetch(
      new Request('https://axnna.example/api/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-token' },
        body: JSON.stringify({ message: { text: '/start abc', from: {}, chat: { id: 'abc' } } }),
      }),
      env
    );
    expect(resBadSender.status).toBe(400);
  });

  it('handles Telegram delivery lifecycle: 200 SENT, 403 PERMANENT_FAILURE, 429 RETRY_SCHEDULED, and EXHAUSTED', async () => {
    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
         VALUES ('u_ok', '1', '101', 'CONNECTED', 1, '2026-11-17T00:00:00Z'),
                ('u_blocked', '2', '102', 'CONNECTED', 1, '2026-11-17T00:00:00Z'),
                ('u_rate', '3', '103', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status, technical_score
         ) VALUES ('sig_deliv_1', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 1.1, 1.09, 1.12, 2.0, 'ALERT_ELIGIBLE', 82)`
      )
      .run();

    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.chat_id === '101') {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 777 } }) } as any;
      }
      if (body.chat_id === '102') {
        return { ok: false, status: 403, json: async () => ({ ok: false, description: 'Forbidden: bot was blocked by the user' }) } as any;
      }
      return {
        ok: false,
        status: 429,
        json: async () => ({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 1 } }),
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    const sig: CandidateSetup = {
      setupId: 'sig_deliv_1',
      symbol: 'EURUSD',
      direction: 'LONG',
      strategyVersion: 'technical-v1',
      detectionTimestamp: Date.now(),
      analysisTimeframe: '1H',
      executionTimeframe: '5M',
      htfBias: 'BULLISH',
      entryPrice: 1.1,
      stopLossPrice: 1.09,
      structuralTargetPrice: 1.12,
      technicalScore: 82,
      status: 'ALERT_ELIGIBLE',
    };

    const sent = await deliverTelegramAlerts(
      env,
      sig,
      'EURUSD',
      2.0,
      {
        instrument: 'EURUSD',
        fundamentalScore: 0,
        confidence: 0,
        macroRegime: 'UNCERTAIN',
        eventRisk: 'NONE',
        upcomingHighImpactEvent: null,
        timeUntilEventMs: null,
      },
      'NEUTRAL'
    );
    expect(sent).toBe(1);

    const rows = sqlite.prepare(`SELECT axnna_user_id, status, attempt_count, provider_message_id FROM notification_deliveries`).all() as any[];
    const byUser = Object.fromEntries(rows.map((r) => [r.axnna_user_id, r]));
    expect(byUser.u_ok).toMatchObject({ status: 'SENT', attempt_count: 1, provider_message_id: '777' });
    expect(byUser.u_blocked).toMatchObject({ status: 'PERMANENT_FAILURE', attempt_count: 1 });
    expect(byUser.u_rate).toMatchObject({ status: 'RETRY_SCHEDULED', attempt_count: 1 });

    // On immediate second call: u_ok (SENT), u_blocked (PERMANENT_FAILURE), and u_rate (future next_retry_at) are ALL skipped
    fetchMock.mockClear();
    await deliverTelegramAlerts(
      env,
      sig,
      'EURUSD',
      2.0,
      {
        instrument: 'EURUSD',
        fundamentalScore: 0,
        confidence: 0,
        macroRegime: 'UNCERTAIN',
        eventRisk: 'NONE',
        upcomingHighImpactEvent: null,
        timeUntilEventMs: null,
      },
      'NEUTRAL'
    );
    expect(fetchMock).not.toHaveBeenCalled();

    // When u_rate becomes due and succeeds on retry, status transitions to SENT
    sqlite.prepare(`UPDATE notification_deliveries SET next_retry_at = '2020-01-01T00:00:00Z' WHERE axnna_user_id = 'u_rate'`).run();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 888 } }) } as any);

    const retried = await retryScheduledDeliveries(env);
    expect(retried).toBe(1);
    const rateAfter = sqlite.prepare(`SELECT status, attempt_count, provider_message_id FROM notification_deliveries WHERE axnna_user_id = 'u_rate'`).get() as any;
    expect(rateAfter).toMatchObject({ status: 'SENT', attempt_count: 2, provider_message_id: '888' });
  });

  it('marks delivery EXHAUSTED after maximum retry attempts', async () => {
    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
         VALUES ('u_fail', '4', '104', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, status
         ) VALUES ('sig_exh', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 'ALERT_ELIGIBLE')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO notification_deliveries (id, signal_id, axnna_user_id, channel, destination, status, attempt_count, next_retry_at)
         VALUES ('nd_exh', 'sig_exh', 'u_fail', 'TELEGRAM', '104', 'RETRY_SCHEDULED', 4, '2020-01-01T00:00:00Z')`
      )
      .run();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')));
    const retried = await retryScheduledDeliveries(env);
    expect(retried).toBe(0);

    const row = sqlite.prepare(`SELECT status, attempt_count FROM notification_deliveries WHERE id = 'nd_exh'`).get() as any;
    expect(row).toMatchObject({ status: 'EXHAUSTED', attempt_count: 5 });
  });
});
