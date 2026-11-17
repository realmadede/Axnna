import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { Env } from '../worker';
import { FundamentalEngine } from '../engine/FundamentalEngine';
import { StrategyEngine } from '../core-engine/StrategyEngine';
import { createSqliteD1 } from '../../tests/helpers/sqliteD1';

describe('Worker CRON, Risk Gating & Backtest Bounds', () => {
  let env: Env;
  let sqlite: any;

  beforeEach(() => {
    const setup = createSqliteD1();
    sqlite = setup.sqlite;
    env = {
      DB: setup.db,
      TELEGRAM_BOT_TOKEN: 'mock_bot',
      TELEGRAM_WEBHOOK_SECRET: 'mock_wh_secret',
      TWELVEDATA_API_KEY: 'mock_twelve',
      BACKTEST_SECRET: 'backtest-secret-123',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs the full synchronization cycle safely and records failed provider state when empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', values: [] }),
      })
    );

    await expect(worker.runSynchronization(env)).resolves.not.toThrow();

    const stateRows = sqlite.prepare(`SELECT instrument, timeframe, status FROM market_data_state`).all() as any[];
    expect(stateRows.length).toBe(8);
    expect(stateRows.every((r) => r.status === 'FAILED')).toBe(true);
  });

  it('suppresses Telegram alerts during HIGH EVENT RISK (exact reason HIGH_EVENT_RISK) while persisting market_context', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const recentBarMs = Math.floor((Date.now() - 300_000) / 300_000) * 300_000;
    const recentIso = new Date(recentBarMs).toISOString();

    sqlite
      .prepare(
        `INSERT INTO provider_health_state (provider_name, service_type, status, last_successful_sync, error_count)
         VALUES ('biquote', 'ECONOMIC_CALENDAR', 'HEALTHY', ?, 0)`
      )
      .run(recentIso);

    const processSpy = vi.spyOn(StrategyEngine.prototype, 'processIncremental').mockReturnValue({
      lastProcessed5mTimestamp: recentBarMs,
      setups: [
        {
          setupId: 'sig_risk_1',
          symbol: 'EURUSD',
          direction: 'LONG',
          strategyVersion: 'technical-v1',
          detectionTimestamp: recentBarMs,
          analysisTimeframe: '1H',
          executionTimeframe: '5M',
          htfBias: 'BULLISH',
          entryPrice: 1.105,
          stopLossPrice: 1.1,
          structuralTargetPrice: 1.12,
          technicalScore: 85,
          status: 'ALERT_ELIGIBLE',
        },
      ],
    });
    const confluenceSpy = vi.spyOn(FundamentalEngine.prototype, 'getConfluence').mockReturnValue('HIGH EVENT RISK');

    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
         VALUES ('u_risk', '10', '20', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
         VALUES ('c5', 'EURUSD', '5M', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata'),
                ('c1', 'EURUSD', '1H', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata')`
      )
      .run(recentIso, recentIso);

    await worker.runStrategyEngine(env, 'EURUSD');

    expect(fetchMock).not.toHaveBeenCalled();
    const row = sqlite.prepare(`SELECT status, market_context FROM signals WHERE signal_id = 'sig_risk_1'`).get() as any;
    expect(row.status).toBe('ALERT_ELIGIBLE');
    expect(JSON.parse(row.market_context).confluence).toBe('HIGH EVENT RISK');

    const decisionRow = sqlite.prepare(`SELECT decision, reason_code FROM risk_decisions WHERE signal_id = 'sig_risk_1'`).get() as any;
    expect(decisionRow).toEqual({ decision: 'REJECTED', reason_code: 'HIGH_EVENT_RISK' });
    const paperCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM paper_trades WHERE signal_id = 'sig_risk_1'`).get() as any).c;
    expect(paperCount).toBe(0);

    processSpy.mockRestore();
    confluenceSpy.mockRestore();
  });

  it('rejects stale signals explicitly with STALE_SIGNAL when setup timestamp is too old', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const recentBarMs = Math.floor((Date.now() - 300_000) / 300_000) * 300_000;
    const recentIso = new Date(recentBarMs).toISOString();
    const staleSigMs = recentBarMs - 45 * 60_000;

    sqlite
      .prepare(
        `INSERT INTO provider_health_state (provider_name, service_type, status, last_successful_sync, error_count)
         VALUES ('biquote', 'ECONOMIC_CALENDAR', 'HEALTHY', ?, 0)`
      )
      .run(recentIso);

    const processSpy = vi.spyOn(StrategyEngine.prototype, 'processIncremental').mockReturnValue({
      lastProcessed5mTimestamp: recentBarMs,
      setups: [
        {
          setupId: 'sig_stale_1',
          symbol: 'EURUSD',
          direction: 'LONG',
          strategyVersion: 'technical-v1',
          detectionTimestamp: staleSigMs,
          analysisTimeframe: '1H',
          executionTimeframe: '5M',
          htfBias: 'BULLISH',
          entryPrice: 1.105,
          stopLossPrice: 1.1,
          structuralTargetPrice: 1.12,
          technicalScore: 85,
          status: 'ALERT_ELIGIBLE',
        },
      ],
    });

    sqlite
      .prepare(
        `INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
         VALUES ('c5s', 'EURUSD', '5M', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata'),
                ('c1s', 'EURUSD', '1H', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata')`
      )
      .run(recentIso, recentIso);

    await worker.runStrategyEngine(env, 'EURUSD');

    expect(fetchMock).not.toHaveBeenCalled();
    const decisionRow = sqlite.prepare(`SELECT decision, reason_code FROM risk_decisions WHERE signal_id = 'sig_stale_1'`).get() as any;
    expect(decisionRow).toEqual({ decision: 'REJECTED', reason_code: 'STALE_SIGNAL' });
    processSpy.mockRestore();
  });

  it('enforces auth, bounds, and date validation on POST /api/dev/backtest', async () => {
    // Missing/invalid auth -> 401
    const unauth = await worker.fetch(
      new Request('https://axnna.example/api/dev/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument: 'EURUSD', limit: 200 }),
      }),
      env
    );
    expect(unauth.status).toBe(401);

    const badAuth = await worker.fetch(
      new Request('https://axnna.example/api/dev/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
        body: JSON.stringify({ instrument: 'EURUSD', limit: 200 }),
      }),
      env
    );
    expect(badAuth.status).toBe(401);

    // Unsupported instrument -> 400
    const badInst = await worker.fetch(
      new Request('https://axnna.example/api/dev/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer backtest-secret-123' },
        body: JSON.stringify({ instrument: 'BTCUSD', limit: 200 }),
      }),
      env
    );
    expect(badInst.status).toBe(400);

    // Excessive limit (>400) or below min (<100) -> 400
    for (const badLimit of [10, 5000, '200', 150.5]) {
      const res = await worker.fetch(
        new Request('https://axnna.example/api/dev/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer backtest-secret-123' },
          body: JSON.stringify({ instrument: 'EURUSD', limit: badLimit }),
        }),
        env
      );
      expect(res.status).toBe(400);
    }

    // Invalid date range -> 400
    const badDates = await worker.fetch(
      new Request('https://axnna.example/api/dev/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer backtest-secret-123' },
        body: JSON.stringify({
          instrument: 'EURUSD',
          limit: 200,
          startDate: '2026-11-10T00:00:00Z',
          endDate: '2026-11-01T00:00:00Z',
        }),
      }),
      env
    );
    expect(badDates.status).toBe(400);

    // Missing TwelveData key -> 503 fail closed
    const missingKey = await worker.fetch(
      new Request('https://axnna.example/api/dev/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer backtest-secret-123' },
        body: JSON.stringify({ instrument: 'EURUSD', limit: 200 }),
      }),
      { ...env, TWELVEDATA_API_KEY: '' }
    );
    expect(missingKey.status).toBe(503);
  });
});
