import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker, { deliverTelegramAlerts, Env } from '../worker';
import { CandidateSetup } from '../core-engine/Types';
import { createSqliteD1 } from '../../tests/helpers/sqliteD1';

describe('Admin Auth Hardening, Route Protection & CORS', () => {
  let env: Env;
  let sqlite: any;

  beforeEach(() => {
    const setup = createSqliteD1();
    sqlite = setup.sqlite;
    env = {
      DB: setup.db,
      TELEGRAM_BOT_TOKEN: 'mock_bot',
      TWELVEDATA_API_KEY: 'mock_twelve',
      ADMIN_PASSPHRASE: 'super-secret-passphrase',
      ADMIN_SESSION_SECRET: 'separate-hmac-signing-secret-32chars',
      ALLOWED_ORIGINS: 'https://app.axnna.example',
    };
  });

  async function loginAdmin(customEnv = env): Promise<string> {
    const res = await worker.fetch(
      new Request('https://axnna.example/api/auth/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://axnna.example',
        },
        body: JSON.stringify({ passphrase: 'super-secret-passphrase' }),
      }),
      customEnv
    );
    expect(res.status).toBe(200);
    return res.headers.get('Set-Cookie')!.split(';')[0];
  }

  it('fails closed (503) when ADMIN_PASSPHRASE or ADMIN_SESSION_SECRET is missing (no fallback)', async () => {
    const noPass = await worker.fetch(
      new Request('https://axnna.example/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: 'anything' }),
      }),
      { ...env, ADMIN_PASSPHRASE: undefined }
    );
    expect(noPass.status).toBe(503);

    const noSessionSecret = await worker.fetch(
      new Request('https://axnna.example/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: 'super-secret-passphrase' }),
      }),
      { ...env, ADMIN_SESSION_SECRET: undefined }
    );
    expect(noSessionSecret.status).toBe(503);
  });

  it('enforces D1 brute-force lockout after 5 failed attempts and resets on success', async () => {
    for (let i = 0; i < 5; i++) {
      const badRes = await worker.fetch(
        new Request('https://axnna.example/api/auth/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
          body: JSON.stringify({ passphrase: 'wrong' }),
        }),
        env
      );
      expect(badRes.status).toBe(401);
    }

    // 6th attempt even with right passphrase is locked -> 429
    const lockedRes = await worker.fetch(
      new Request('https://axnna.example/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
        body: JSON.stringify({ passphrase: 'super-secret-passphrase' }),
      }),
      env
    );
    expect(lockedRes.status).toBe(429);
    expect(Number(lockedRes.headers.get('Retry-After'))).toBeGreaterThan(0);

    // Verifies raw IP is never stored in admin_login_attempts (HMAC pseudonymized), then expires lockout
    const rawRow = sqlite.prepare(`SELECT client_key FROM admin_login_attempts`).get() as any;
    expect(rawRow.client_key).toBeTruthy();
    expect(rawRow.client_key).not.toBe('203.0.113.10');

    sqlite
      .prepare(`UPDATE admin_login_attempts SET locked_until = '2020-01-01T00:00:00.000Z'`)
      .run();
    const okRes = await worker.fetch(
      new Request('https://axnna.example/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
        body: JSON.stringify({ passphrase: 'super-secret-passphrase' }),
      }),
      env
    );
    expect(okRes.status).toBe(200);
    const remaining = sqlite.prepare(`SELECT COUNT(*) as cnt FROM admin_login_attempts`).get() as any;
    expect(remaining.cnt).toBe(0);
  });

  it('enforces CSRF Origin + X-Requested-With headers on state-changing admin routes', async () => {
    const cookie = await loginAdmin();

    // Missing X-Requested-With -> 403
    const missingHeader = await worker.fetch(
      new Request('https://axnna.example/api/config/system/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://axnna.example' },
        body: JSON.stringify({ enabled: false }),
      }),
      env
    );
    expect(missingHeader.status).toBe(403);

    // Disallowed cross-origin -> 403
    const badOrigin = await worker.fetch(
      new Request('https://axnna.example/api/config/system/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'AxnnaAdmin',
          Cookie: cookie,
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({ enabled: false }),
      }),
      env
    );
    expect(badOrigin.status).toBe(403);

    // Valid origin + CSRF header -> 200
    const valid = await worker.fetch(
      new Request('https://axnna.example/api/config/system/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'AxnnaAdmin',
          Cookie: cookie,
          Origin: 'https://app.axnna.example',
        },
        body: JSON.stringify({ enabled: false }),
      }),
      env
    );
    expect(valid.status).toBe(200);
  });

  it('supports server-side session revocation on logout and session version rotation', async () => {
    const cookie = await loginAdmin();

    // Authenticated overview succeeds
    const ov1 = await worker.fetch(
      new Request('https://axnna.example/api/config/overview', { headers: { Cookie: cookie } }),
      env
    );
    expect(ov1.status).toBe(200);

    // Logout revokes nonce in D1
    const logoutRes = await worker.fetch(
      new Request('https://axnna.example/api/auth/config/logout', {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Requested-With': 'AxnnaAdmin', Origin: 'https://axnna.example' },
      }),
      env
    );
    expect(logoutRes.status).toBe(200);

    // Reusing old cookie after logout fails with 401
    const ovAfterLogout = await worker.fetch(
      new Request('https://axnna.example/api/config/overview', { headers: { Cookie: cookie } }),
      env
    );
    expect(ovAfterLogout.status).toBe(401);

    // New login invalidated by version rotation
    const cookie2 = await loginAdmin();
    sqlite.prepare(`UPDATE system_config SET value = '2' WHERE "key" = 'admin_session_version'`).run();
    const ovAfterRotation = await worker.fetch(
      new Request('https://axnna.example/api/config/overview', { headers: { Cookie: cookie2 } }),
      env
    );
    expect(ovAfterRotation.status).toBe(401);
  });

  it('protects /api/signals, /api/markets, /api/calendar and applies strict CORS allowlist', async () => {
    for (const path of ['/api/signals', '/api/markets', '/api/calendar']) {
      const unauth = await worker.fetch(new Request(`https://axnna.example${path}`), env);
      expect(unauth.status).toBe(401);
    }

    // Disallowed origin gets no Access-Control-Allow-Origin and OPTIONS returns 403
    const badOptions = await worker.fetch(
      new Request('https://axnna.example/api/fundamentals/EURUSD', {
        method: 'OPTIONS',
        headers: { Origin: 'https://attacker.example' },
      }),
      env
    );
    expect(badOptions.status).toBe(403);

    // Allowed origin receives explicit origin + credentials (never wildcard)
    const allowedGet = await worker.fetch(
      new Request('https://axnna.example/api/fundamentals/EURUSD', {
        headers: { Origin: 'https://app.axnna.example' },
      }),
      env
    );
    expect(allowedGet.status).toBe(200);
    expect(allowedGet.headers.get('Access-Control-Allow-Origin')).toBe('https://app.axnna.example');
    expect(allowedGet.headers.get('Access-Control-Allow-Credentials')).toBe('true');

    // Authenticated admin can read /api/signals
    const cookie = await loginAdmin();
    const authSignals = await worker.fetch(
      new Request('https://axnna.example/api/signals', { headers: { Cookie: cookie } }),
      env
    );
    expect(authSignals.status).toBe(200);
  });

  it('respects DISABLED strategy status and global_notifications_enabled kill-switch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Disable strategy in D1
    sqlite.prepare(`UPDATE strategies SET active_status = 'DISABLED' WHERE strategy_id = 'AXNNA_V1_LIQUIDITY_FVG'`).run();
    await worker.runStrategyEngine(env, 'EURUSD');
    const sigCount = sqlite.prepare(`SELECT COUNT(*) as cnt FROM signals`).get() as any;
    expect(sigCount.cnt).toBe(0);

    // Global kill-switch stops Telegram delivery
    sqlite.prepare(`UPDATE system_config SET value = 'false' WHERE "key" = 'global_notifications_enabled'`).run();
    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
         VALUES ('u1', '1', '100', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
      )
      .run();

    const sig: CandidateSetup = {
      setupId: 'sig_kill_1',
      symbol: 'EURUSD',
      direction: 'LONG',
      strategyVersion: 'technical-v1',
      detectionTimestamp: Date.now(),
      analysisTimeframe: '1H',
      executionTimeframe: '5M',
      htfBias: 'BULLISH',
      technicalScore: 90,
      status: 'ALERT_ELIGIBLE',
    };
    const sent = await deliverTelegramAlerts(
      env,
      sig,
      'EURUSD',
      2.5,
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
    expect(sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
