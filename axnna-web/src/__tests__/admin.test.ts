import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker, { deliverTelegramAlerts, Env } from '../worker';
import { CandidateSetup } from '../core-engine/Types';

function createMockDb(overrides?: {
  first?: (query: string) => any;
  all?: (query: string) => any[];
}) {
  return {
    prepare: vi.fn((query: string) => ({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({}),
      first: vi.fn().mockImplementation(async () => (overrides?.first ? overrides.first(query) : null)),
      all: vi.fn().mockImplementation(async () => ({
        results: overrides?.all ? overrides.all(query) : [],
      })),
    })),
  } as any;
}

describe('Admin Auth & Config Endpoints', () => {
  let mockEnv: Env;

  beforeEach(() => {
    mockEnv = {
      DB: createMockDb(),
      TELEGRAM_BOT_TOKEN: 'mock_bot',
      TWELVEDATA_API_KEY: 'mock_twelve',
      ADMIN_PASSPHRASE: 'super-secret-passphrase',
    };
  });

  it('returns 503 when ADMIN_PASSPHRASE is not configured', async () => {
    mockEnv.ADMIN_PASSPHRASE = undefined;
    const req = new Request('https://axnna.example/api/auth/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: 'anything' }),
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(503);
  });

  it('rejects invalid passphrase with 401 and issues session cookie on valid login', async () => {
    const badReq = new Request('https://axnna.example/api/auth/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: 'wrong' }),
    });
    const badRes = await worker.fetch(badReq, mockEnv);
    expect(badRes.status).toBe(401);

    const goodReq = new Request('https://axnna.example/api/auth/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: 'super-secret-passphrase' }),
    });
    const goodRes = await worker.fetch(goodReq, mockEnv);
    expect(goodRes.status).toBe(200);
    const cookie = goodRes.headers.get('Set-Cookie');
    expect(cookie).toContain('axnna_admin_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');

    const sessionCookie = cookie!.split(';')[0];

    const checkReq = new Request('https://axnna.example/api/auth/config', {
      headers: { Cookie: sessionCookie },
    });
    const checkRes = await worker.fetch(checkReq, mockEnv);
    const checkBody = (await checkRes.json()) as any;
    expect(checkBody.authenticated).toBe(true);
  });

  it('protects /api/config/* routes and serves overview when authenticated', async () => {
    const unauthRes = await worker.fetch(new Request('https://axnna.example/api/config/overview'), mockEnv);
    expect(unauthRes.status).toBe(401);

    const loginRes = await worker.fetch(
      new Request('https://axnna.example/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: 'super-secret-passphrase' }),
      }),
      mockEnv
    );
    const sessionCookie = loginRes.headers.get('Set-Cookie')!.split(';')[0];

    const overviewRes = await worker.fetch(
      new Request('https://axnna.example/api/config/overview', {
        headers: { Cookie: sessionCookie },
      }),
      mockEnv
    );
    expect(overviewRes.status).toBe(200);
    const body = (await overviewRes.json()) as any;
    expect(body).toHaveProperty('systemConfig.globalNotificationsEnabled', true);
    expect(body).toHaveProperty('strategies');
    expect(body).toHaveProperty('users');
    expect(body).toHaveProperty('signals');
    expect(body).toHaveProperty('deliveries');
  });

  it('updates global notifications, strategy status, and user controls when authenticated', async () => {
    const loginRes = await worker.fetch(
      new Request('https://axnna.example/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: 'super-secret-passphrase' }),
      }),
      mockEnv
    );
    const sessionCookie = loginRes.headers.get('Set-Cookie')!.split(';')[0];

    const notifRes = await worker.fetch(
      new Request('https://axnna.example/api/config/system/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify({ enabled: false }),
      }),
      mockEnv
    );
    expect(notifRes.status).toBe(200);

    const stratRes = await worker.fetch(
      new Request('https://axnna.example/api/config/strategies/AXNNA_V1_LIQUIDITY_FVG/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify({ activeStatus: 'DISABLED' }),
      }),
      mockEnv
    );
    expect(stratRes.status).toBe(200);

    const userRes = await worker.fetch(
      new Request('https://axnna.example/api/config/users/user_1/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify({ notificationsEnabled: false }),
      }),
      mockEnv
    );
    expect(userRes.status).toBe(200);
  });

  it('respects DISABLED strategy status and global_notifications_enabled kill-switch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // 1. Disabled strategy stops before loading candles
    const disabledDb = createMockDb({
      first: (q) => (q.includes('FROM strategies') ? { active_status: 'DISABLED' } : null),
    });
    mockEnv.DB = disabledDb;
    await worker.runStrategyEngine(mockEnv, 'EURUSD');
    expect(disabledDb.prepare).toHaveBeenCalledTimes(1);

    // 2. Global kill-switch stops Telegram delivery
    mockEnv.DB = createMockDb({
      first: (q) => (q.includes('system_config') ? { value: 'false' } : null),
      all: () => [{ id: 'u1', telegram_chat_id: 'c1' }],
    });

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
      mockEnv,
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
