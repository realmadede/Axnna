import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { Env, runDailyRecap } from '../src/worker';
import { FundamentalEngine } from '../src/engine/FundamentalEngine';
import { BacktestEngine } from '../src/core-engine/BacktestEngine';
import { StrategyEngine } from '../src/core-engine/StrategyEngine';
import { InternalCandle } from '../src/core-engine/MarketData';
import { CandidateSetup } from '../src/core-engine/Types';
import {
  evaluateOpenPaperTrades,
  getPaperPortfolioOverview,
  registerPaperTradeFromApprovedSignal,
} from '../src/engine/PaperTradingEngine';
import { checkD1RateLimit, pruneOperationalTables } from '../src/ops/telemetry';
import { isFxMarketClosedUtc, getMostRecentFxSessionCloseMs } from '../src/utils/time';
import { createSqliteD1 } from './helpers/sqliteD1';

describe('Stage D.2 Consolidated Release-Blocking Remediation Suite', () => {
  let env: Env;
  let sqlite: any;

  beforeEach(() => {
    const setup = createSqliteD1();
    sqlite = setup.sqlite;
    env = {
      DB: setup.db,
      ENVIRONMENT: 'staging',
      TELEGRAM_BOT_TOKEN: '123456:STAGE_D2_BOT_TOKEN',
      TELEGRAM_WEBHOOK_SECRET: 'stage_d2_webhook_secret_32_chars',
      TWELVEDATA_API_KEY: 'stage_d2_twelvedata_key',
      BACKTEST_SECRET: 'stage_d2_backtest_secret',
      ADMIN_PASSPHRASE: 'stage-d2-admin-passphrase',
      ADMIN_SESSION_SECRET: 'stage-d2-hmac-signing-secret-32chars',
      ACTOR_HASH_SECRET: 'stage-d2-actor-hash-secret-32chars',
      ALLOWED_ORIGINS: 'https://axnna-staging.madede.workers.dev',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeCandidate(overrides: Partial<CandidateSetup> = {}): CandidateSetup {
    const recentMs = Math.floor((Date.now() - 300_000) / 300_000) * 300_000;
    return {
      setupId: `EURUSD-techv1-LONG-${recentMs}`,
      symbol: 'EURUSD',
      direction: 'LONG',
      strategyVersion: 'technical-v1',
      detectionTimestamp: recentMs,
      analysisTimeframe: '1H',
      executionTimeframe: '5M',
      htfBias: 'BULLISH',
      entryPrice: 1.1,
      stopLossPrice: 1.095,
      structuralTargetPrice: 1.11,
      technicalScore: 82,
      status: 'ALERT_ELIGIBLE',
      ...overrides,
    };
  }

  async function loginAdmin(): Promise<string> {
    const res = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/auth/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://axnna-staging.madede.workers.dev',
        },
        body: JSON.stringify({ passphrase: 'stage-d2-admin-passphrase' }),
      }),
      env
    );
    expect(res.status).toBe(200);
    return res.headers.get('Set-Cookie')!.split(';')[0];
  }

  it('AUD-D1-01: Rejects UNKNOWN/failed calendar (even with legacy events), stale active-session 5M feeds, and preserves FX weekend schedule semantics', async () => {
    const recentBarMs = Math.floor((Date.now() - 300_000) / 300_000) * 300_000;
    const recentIso = new Date(recentBarMs).toISOString();

    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
         VALUES ('u_d2_1', '2001', '2001', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
      )
      .run();

    // 1. Seed legacy old economic event + FAILED calendar provider -> MUST evaluate UNKNOWN and reject FUNDAMENTAL_DATA_UNAVAILABLE
    sqlite
      .prepare(
        `INSERT INTO economic_events (id, country, currency, event, timestamp, importance, source)
         VALUES ('ev_old', 'US', 'USD', 'Old CPI', '2026-11-01T12:00:00Z', 'HIGH', 'biquote')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO provider_health_state (provider_name, service_type, status, last_failure, error_count)
         VALUES ('biquote', 'ECONOMIC_CALENDAR', 'FAILED', ?, 3)`
      )
      .run(recentIso);

    sqlite
      .prepare(
        `INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
         VALUES ('mc5_1', 'EURUSD', '5M', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata'),
                ('mc1_1', 'EURUSD', '1H', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata')`
      )
      .run(recentIso, recentIso);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const spyUnknown = vi.spyOn(StrategyEngine.prototype, 'processIncremental').mockReturnValueOnce({
      lastProcessed5mTimestamp: recentBarMs,
      setups: [makeCandidate({ setupId: 'sig_unknown_cal', detectionTimestamp: recentBarMs })],
    });

    await worker.runStrategyEngine(env, 'EURUSD');

    expect(fetchMock).not.toHaveBeenCalled();
    const rdUnknown = sqlite.prepare(`SELECT decision, reason_code, event_risk FROM risk_decisions WHERE signal_id = 'sig_unknown_cal'`).get() as any;
    expect(rdUnknown).toEqual({ decision: 'REJECTED', reason_code: 'FUNDAMENTAL_DATA_UNAVAILABLE', event_risk: 'UNKNOWN' });
    const ptUnknown = (sqlite.prepare(`SELECT COUNT(*) as c FROM paper_trades WHERE signal_id = 'sig_unknown_cal'`).get() as any).c;
    expect(ptUnknown).toBe(0);
    spyUnknown.mockRestore();

    // Verify FundamentalEngine.getConfluence never turns UNKNOWN into NEUTRAL
    const fe = new FundamentalEngine();
    const unknownCtx = fe.evaluateContext('EURUSD', [], new Date(), { calendarDataAvailable: false });
    expect(unknownCtx.eventRisk).toBe('UNKNOWN');
    expect(fe.getConfluence(unknownCtx, 'LONG')).toBe('FUNDAMENTAL UNAVAILABLE');

    // 2. Make calendar HEALTHY, make 5M feed stale (>45m old on active FX session) -> rejects MISSING_MARKET_DATA
    sqlite
      .prepare(`UPDATE provider_health_state SET status = 'HEALTHY', last_successful_sync = ? WHERE service_type = 'ECONOMIC_CALENDAR'`)
      .run(recentIso);
    const staleCandleMs = Date.UTC(2026, 10, 17, 10, 0, 0);
    const staleIso = new Date(staleCandleMs).toISOString();
    sqlite.prepare(`DELETE FROM market_candles WHERE instrument = 'EURUSD'`).run();
    sqlite
      .prepare(
        `INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
         VALUES ('mc5_stale', 'EURUSD', '5M', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata'),
                ('mc1_stale', 'EURUSD', '1H', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata')`
      )
      .run(staleIso, staleIso);

    const spyStaleFeed = vi.spyOn(StrategyEngine.prototype, 'processIncremental').mockReturnValueOnce({
      lastProcessed5mTimestamp: staleCandleMs,
      setups: [makeCandidate({ setupId: 'sig_stale_feed', detectionTimestamp: staleCandleMs })],
    });
    await worker.runStrategyEngine(env, 'EURUSD');
    const rdStaleFeed = sqlite.prepare(`SELECT decision, reason_code FROM risk_decisions WHERE signal_id = 'sig_stale_feed'`).get() as any;
    expect(rdStaleFeed).toEqual({ decision: 'REJECTED', reason_code: 'MISSING_MARKET_DATA' });
    spyStaleFeed.mockRestore();

    // 3. FX market schedule helpers distinguish Saturday closure vs Tuesday active session
    const satUtc = Date.UTC(2026, 10, 14, 15, 0, 0); // Saturday 15:00 UTC
    const tueUtc = Date.UTC(2026, 10, 17, 15, 0, 0); // Tuesday 15:00 UTC
    expect(isFxMarketClosedUtc(satUtc)).toBe(true);
    expect(isFxMarketClosedUtc(tueUtc)).toBe(false);
    expect(new Date(getMostRecentFxSessionCloseMs(satUtc)).toISOString()).toBe('2026-11-13T22:00:00.000Z');
  });

  it('AUD-D1-02: Fails closed when risk_decisions batch persistence fails (zero Telegram alerts, zero paper trades)', async () => {
    const recentBarMs = Math.floor((Date.now() - 300_000) / 300_000) * 300_000;
    const recentIso = new Date(recentBarMs).toISOString();

    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
         VALUES ('u_d2_2', '2002', '2002', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO provider_health_state (provider_name, service_type, status, last_successful_sync, error_count)
         VALUES ('biquote', 'ECONOMIC_CALENDAR', 'HEALTHY', ?, 0)`
      )
      .run(recentIso);
    sqlite
      .prepare(
        `INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
         VALUES ('mc5_fc', 'EURUSD', '5M', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata'),
                ('mc1_fc', 'EURUSD', '1H', ?, 1.1, 1.11, 1.09, 1.105, 'twelvedata')`
      )
      .run(recentIso, recentIso);

    // Inject trigger causing risk_decisions insert to abort
    sqlite.exec(`
      CREATE TRIGGER fail_risk_insert BEFORE INSERT ON risk_decisions
      BEGIN
        SELECT RAISE(ABORT, 'simulated D1 risk_decisions write failure');
      END;
    `);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const spy = vi.spyOn(StrategyEngine.prototype, 'processIncremental').mockReturnValueOnce({
      lastProcessed5mTimestamp: recentBarMs,
      setups: [makeCandidate({ setupId: 'sig_persist_fail', detectionTimestamp: recentBarMs })],
    });

    await worker.runStrategyEngine(env, 'EURUSD');

    expect(fetchMock).not.toHaveBeenCalled();
    expect((sqlite.prepare(`SELECT COUNT(*) as c FROM paper_trades WHERE signal_id = 'sig_persist_fail'`).get() as any).c).toBe(0);
    const secEvt = sqlite.prepare(`SELECT event_type, resource FROM security_events WHERE event_type = 'RISK_DECISION_PERSIST_FAILED'`).get() as any;
    expect(secEvt).toEqual({ event_type: 'RISK_DECISION_PERSIST_FAILED', resource: 'sig_persist_fail' });
    spy.mockRestore();
  });

  it('AUD-D1-03 & AUD-D1-04: Enforces atomic trade close rollback, exit-chronology equity curve/drawdown, startingBalance reconciliation, and preserves signals.status for Daily Recap/Admin KPIs', async () => {
    const t0 = Date.UTC(2026, 10, 17, 10, 0, 0);
    const seedAlertedSignal = (id: string, dir: 'LONG' | 'SHORT', inst: string, genTs: number, e: number, sl: number, tp: number) => {
      sqlite.prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status, technical_score
         ) VALUES (?, 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', ?, ?, ?, '1H', '5M', ?, ?, ?, 2.0, 'ALERTED', 82)`
      ).run(id, inst, dir, new Date(genTs).toISOString(), e, sl, tp);
      sqlite.prepare(
        `INSERT INTO risk_decisions (id, signal_id, instrument, direction, strategy_version, technical_score, decision, reason_code)
         VALUES (?, ?, ?, ?, 'technical-v1', 82, 'APPROVED', 'RISK_APPROVED')`
      ).run(`rd_${id}`, id, inst, dir);
    };

    sqlite
      .prepare(
        `INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, signal_notifications_enabled, connected_at)
         VALUES ('u_recap_d2', '3001', '3001', 'CONNECTED', 1, '2026-11-17T00:00:00Z')`
      )
      .run();

    // Trade A enters first (10:00) and closes LAST (12:00) with a LOSS (-103.96)
    // Trade B enters second (10:15) and closes FIRST (10:45) with a WIN (+194.06)
    seedAlertedSignal('sig_early_late_loss', 'LONG', 'EURUSD', t0, 1.1, 1.095, 1.11);
    seedAlertedSignal('sig_late_early_win', 'LONG', 'GBPUSD', t0 + 15 * 60_000, 1.25, 1.245, 1.26);

    await registerPaperTradeFromApprovedSignal(env.DB, makeCandidate({
      setupId: 'sig_early_late_loss',
      symbol: 'EURUSD',
      detectionTimestamp: t0,
      entryPrice: 1.1,
      stopLossPrice: 1.095,
      structuralTargetPrice: 1.11,
    }), 'AXNNA_V1_LIQUIDITY_FVG');

    await registerPaperTradeFromApprovedSignal(env.DB, makeCandidate({
      setupId: 'sig_late_early_win',
      symbol: 'GBPUSD',
      detectionTimestamp: t0 + 15 * 60_000,
      entryPrice: 1.25,
      stopLossPrice: 1.245,
      structuralTargetPrice: 1.26,
    }), 'AXNNA_V1_LIQUIDITY_FVG');

    // Fill Trade A at 10:05
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 5 * 60_000, open: 1.101, high: 1.104, low: 1.0995, close: 1.103, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    // Fill Trade B at 10:20, Close Trade B WIN at 10:45
    await evaluateOpenPaperTrades(env.DB, 'GBPUSD', {
      GBPUSD: [
        { symbol: 'GBPUSD', timeframe: '5M', timestamp: t0 + 20 * 60_000, open: 1.251, high: 1.254, low: 1.2495, close: 1.253, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
        { symbol: 'GBPUSD', timeframe: '5M', timestamp: t0 + 45 * 60_000, open: 1.254, high: 1.262, low: 1.253, close: 1.261, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
      ],
    });
    // Close Trade A LOSS at 12:00
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 120 * 60_000, open: 1.099, high: 1.1, low: 1.094, close: 1.0945, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });

    const ov = await getPaperPortfolioOverview(env.DB);
    // Equity curve MUST follow exit chronology: WIN at 10:45 FIRST -> peak > 10000 -> LOSS at 12:00 creates drawdown!
    expect(ov.equityCurve.map((p) => p.signalId)).toEqual(['sig_late_early_win', 'sig_early_late_loss']);
    expect(ov.equityCurve[0].balance).toBeGreaterThan(10000);
    expect(ov.summary.maxDrawdown).toBeCloseTo(Math.abs(ov.equityCurve[1].balance - ov.equityCurve[0].balance), 1);
    // Invariant: current_balance === starting_balance + sum(realized net_pnl)
    expect(ov.account.current_balance).toBeCloseTo(10000 + ov.summary.realizedPnl, 4);

    // Non-reset startingBalance update must reconcile current_balance
    const cookie = await loginAdmin();
    const updRes = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/config/paper/account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://axnna-staging.madede.workers.dev',
          'X-Requested-With': 'AxnnaAdmin',
        },
        body: JSON.stringify({ startingBalance: 25000, riskPerTradePercent: 1.0, resetAccount: false }),
      }),
      env
    );
    expect(updRes.status).toBe(200);
    const afterStartUpd = await getPaperPortfolioOverview(env.DB);
    expect(afterStartUpd.account.starting_balance).toBe(25000);
    expect(afterStartUpd.account.current_balance).toBeCloseTo(25000 + ov.summary.realizedPnl, 4);

    // Signals must STILL be 'ALERTED' even after TARGET_HIT / STOP_HIT, and Daily Recap must count both!
    expect((sqlite.prepare(`SELECT status FROM signals WHERE signal_id = 'sig_late_early_win'`).get() as any).status).toBe('ALERTED');
    const recapPayloads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        recapPayloads.push(JSON.parse(String(init?.body || '{}')).text);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200 });
      })
    );
    await runDailyRecap(env, '2026-11-17');
    expect(recapPayloads[0]).toContain('Alerted setups: 2');
    expect(recapPayloads[0]).not.toContain('Silence is a valid signal.');

    // Admin totals still preserve alertedSignals = 2
    const ovApiRes = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/config/overview?days=7', { headers: { Cookie: cookie } }),
      env
    );
    const ovApi = (await ovApiRes.json()) as any;
    expect(ovApi.totals.alertedSignals).toBe(2);

    // Atomic closure rollback check: trigger failure on paper_accounts keeps paper_trades in ACTIVE_TRADE!
    seedAlertedSignal('sig_atomic_rb', 'LONG', 'EURUSD', t0 + 180 * 60_000, 1.1, 1.095, 1.11);
    await registerPaperTradeFromApprovedSignal(env.DB, makeCandidate({
      setupId: 'sig_atomic_rb',
      symbol: 'EURUSD',
      detectionTimestamp: t0 + 180 * 60_000,
      entryPrice: 1.1,
      stopLossPrice: 1.095,
      structuralTargetPrice: 1.11,
    }), 'AXNNA_V1_LIQUIDITY_FVG');
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 185 * 60_000, open: 1.101, high: 1.104, low: 1.0995, close: 1.103, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    sqlite.exec(`
      CREATE TRIGGER fail_acc_update BEFORE UPDATE ON paper_accounts
      BEGIN
        SELECT RAISE(ABORT, 'simulated D1 account failure');
      END;
    `);
    await expect(
      evaluateOpenPaperTrades(env.DB, 'EURUSD', {
        EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 190 * 60_000, open: 1.105, high: 1.112, low: 1.104, close: 1.111, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
      })
    ).rejects.toThrow(/simulated D1 account failure/);
    // Rolled back: trade MUST still be ACTIVE_TRADE!
    expect((sqlite.prepare(`SELECT status FROM paper_trades WHERE signal_id = 'sig_atomic_rb'`).get() as any).status).toBe('ACTIVE_TRADE');
  });

  it('AUD-D1-05: /api/dev/backtest uses real pip defaults per instrument (not 0.00015) and validates cost overrides', async () => {
    const baseMs = Date.UTC(2026, 10, 17, 10, 0, 0);
    const makeTdValues = (count: number, stepMs: number, mult: number) =>
      Array.from({ length: count }, (_, idx) => {
        const ts = baseMs - (count - idx) * stepMs;
        const px = (1.1 * mult).toFixed(mult >= 100 ? 2 : 4);
        return {
          datetime: new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
          open: px,
          high: (1.101 * mult).toFixed(mult >= 100 ? 2 : 4),
          low: (1.099 * mult).toFixed(mult >= 100 ? 2 : 4),
          close: px,
        };
      });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const isUsdjpy = url.includes('USD/JPY');
        const isXau = url.includes('XAU/USD');
        const is1h = url.includes('interval=1h');
        const mult = isXau ? 2000 : isUsdjpy ? 140 : 1;
        return new Response(
          JSON.stringify({ status: 'ok', values: makeTdValues(is1h ? 100 : 1200, is1h ? 3_600_000 : 300_000, mult) }),
          { status: 200 }
        );
      })
    );

    const expectedSpreads: Record<string, string> = {
      EURUSD: '1 pips',
      GBPUSD: '1.5 pips',
      USDJPY: '1.5 pips',
      XAUUSD: '2 pips',
    };

    for (const inst of ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']) {
      const res = await worker.fetch(
        new Request('https://axnna-staging.madede.workers.dev/api/dev/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.BACKTEST_SECRET}` },
          body: JSON.stringify({ instrument: inst, limit: 100 }),
        }),
        env
      );
      expect(res.status).toBe(200);
      const report = (await res.json()) as any;
      expect(report.metadata.spreadModel).toBe(expectedSpreads[inst]);
    }

    for (const badOverride of [{ spreadPips: -1 }, { spreadPips: '1.5' }, { slippagePips: 100 }]) {
      const badRes = await worker.fetch(
        new Request('https://axnna-staging.madede.workers.dev/api/dev/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.BACKTEST_SECRET}` },
          body: JSON.stringify({ instrument: 'EURUSD', limit: 100, ...badOverride }),
        }),
        env
      );
      expect(badRes.status).toBe(400);
    }
  });

  it('AUD-D1-06: Expires delayed PENDING_ENTRY strictly before fill/invalidation (>15m) in both PaperTradingEngine and BacktestEngine', async () => {
    const t0 = Date.UTC(2026, 10, 17, 10, 0, 0);

    // Case 1: Candle at exact 15m (inclusive <= 15m) still fills!
    sqlite.prepare(
      `INSERT INTO signals (signal_id, strategy_id, strategy_version, instrument, direction, generated_at, anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status, technical_score)
       VALUES ('sig_15m', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', ?, '1H', '5M', 1.1, 1.095, 1.11, 2.0, 'ALERTED', 80),
              ('sig_20m', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', ?, '1H', '5M', 1.1, 1.095, 1.11, 2.0, 'ALERTED', 80)`
    ).run(new Date(t0).toISOString(), new Date(t0).toISOString());

    await registerPaperTradeFromApprovedSignal(env.DB, makeCandidate({ setupId: 'sig_15m', detectionTimestamp: t0 }), 'AXNNA_V1_LIQUIDITY_FVG');
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 15 * 60_000, open: 1.101, high: 1.104, low: 1.0995, close: 1.103, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    expect((sqlite.prepare(`SELECT status FROM paper_trades WHERE signal_id = 'sig_15m'`).get() as any).status).toBe('ACTIVE_TRADE');

    // Case 2: Candle at 20m touching both entry AND stop expires strictly as EXPIRED without filling or invalidating
    await registerPaperTradeFromApprovedSignal(env.DB, makeCandidate({ setupId: 'sig_20m', detectionTimestamp: t0 }), 'AXNNA_V1_LIQUIDITY_FVG');
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 20 * 60_000, open: 1.101, high: 1.104, low: 1.09, close: 1.092, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    expect((sqlite.prepare(`SELECT status, outcome FROM paper_trades WHERE signal_id = 'sig_20m'`).get() as any)).toEqual({
      status: 'EXPIRED',
      outcome: 'EXPIRED',
    });

    // Verify BacktestEngine applies identical >15m pre-fill expiry rule
    const bt = new BacktestEngine({
      initialCapital: 10000,
      riskPerTradePercent: 1,
      symbol: 'EURUSD',
      strategyConfig: {
        htfTimeframe: '1H',
        ltfTimeframe: '5M',
        swingLengthHTF: 3,
        swingLengthLTF: 2,
        atrLength: 14,
        displacementSizeMultiplier: 1.5,
        displacementBodyRatio: 0.5,
        displacementCloseLocation: 0.5,
        fvgMinAtrRatio: 0.5,
        alertScoreThreshold: 65,
      },
    });
    const htf: InternalCandle[] = [{ symbol: 'EURUSD', timeframe: '1H', timestamp: t0 - 3_600_000, open: 1.1, high: 1.11, low: 1.09, close: 1.105, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }];
    const ltf: InternalCandle[] = [
      { symbol: 'EURUSD', timeframe: '5M', timestamp: t0, open: 1.101, high: 1.102, low: 1.1, close: 1.101, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
      { symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 20 * 60_000, open: 1.101, high: 1.103, low: 1.09, close: 1.095, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
    ];
    const spyProc = vi.spyOn(StrategyEngine.prototype, 'processCandles')
      .mockReturnValueOnce([makeCandidate({ setupId: 'bt_exp', detectionTimestamp: t0 })])
      .mockReturnValueOnce([]);
    const btRes = bt.run(htf, ltf);
    expect(btRes.executedTrades).toBe(0);
    expect(btRes.diagnostics?.expiries).toBe(1);
    expect(btRes.diagnostics?.cancellations).toBe(0);
    spyProc.mockRestore();
  });

  it('AUD-D1-07, AUD-D1-08, AUD-D1-09, AUD-D1-11, AUD-D1-12 & AUD-D1-14: Guards concurrent retries, recap locks, batched candles, filtered Admin pagination, event pruning, body limits, atomic rate limits & pairing audit', async () => {
    const cookie = await loginAdmin();

    // 1. Concurrent manual delivery retries claim atomically so Telegram receives only 1 send
    sqlite.prepare(`INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, status, connected_at) VALUES ('u_c1', '501', '501', 'CONNECTED', '2026-11-17T00:00:00Z')`).run();
    sqlite.prepare(`INSERT INTO signals (signal_id, strategy_id, strategy_version, instrument, direction, generated_at, anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status, technical_score) VALUES ('sig_c1', 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', 'LONG', '2026-11-17T00:00:00Z', '1H', '5M', 1.1, 1.095, 1.11, 2.0, 'ALERT_ELIGIBLE', 80)`).run();
    sqlite.prepare(`INSERT INTO notification_deliveries (id, signal_id, axnna_user_id, channel, destination, status, attempt_count) VALUES ('nd_c1', 'sig_c1', 'u_c1', 'TELEGRAM', '501', 'RETRY_SCHEDULED', 1)`).run();

    let tgCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        tgCalls++;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 901 } }), { status: 200 });
      })
    );

    const [rA, rB] = await Promise.all([
      worker.fetch(
        new Request('https://axnna-staging.madede.workers.dev/api/config/deliveries/nd_c1/retry', {
          method: 'POST',
          headers: { Cookie: cookie, Origin: 'https://axnna-staging.madede.workers.dev', 'X-Requested-With': 'AxnnaAdmin' },
        }),
        env
      ),
      worker.fetch(
        new Request('https://axnna-staging.madede.workers.dev/api/config/deliveries/nd_c1/retry', {
          method: 'POST',
          headers: { Cookie: cookie, Origin: 'https://axnna-staging.madede.workers.dev', 'X-Requested-With': 'AxnnaAdmin' },
        }),
        env
      ),
    ]);
    expect([rA.status, rB.status].sort()).toEqual([200, 400]); // One succeeds, second sees terminal/claimed state
    expect(tgCalls).toBe(1);

    // 2. Concurrent /start webhook claims only 1 TELEGRAM_CONNECTION_COMPLETED audit event
    const sessRes = await worker.fetch(new Request('https://axnna-staging.madede.workers.dev/api/telegram/session', { method: 'POST' }), env);
    const { token } = (await sessRes.json()) as any;
    const whReq = () =>
      worker.fetch(
        new Request('https://axnna-staging.madede.workers.dev/api/telegram/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET! },
          body: JSON.stringify({ update_id: 801, message: { from: { id: 502, username: 'dup_wh' }, chat: { id: 502 }, text: `/start ${token}` } }),
        }),
        env
      );
    await Promise.all([whReq(), whReq()]);
    const pairAudits = (sqlite.prepare(`SELECT COUNT(*) as c FROM audit_events WHERE event_type = 'TELEGRAM_CONNECTION_COMPLETED'`).get() as any).c;
    expect(pairAudits).toBe(1);

    // 3. Oversized JSON payload (>64KB Telegram webhook, >8KB admin mutation) rejected with 413
    const hugeWh = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET! },
        body: JSON.stringify({ message: { text: 'a'.repeat(70_000) } }),
      }),
      env
    );
    expect(hugeWh.status).toBe(413);

    const hugeAdmin = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/config/system/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://axnna-staging.madede.workers.dev',
          'X-Requested-With': 'AxnnaAdmin',
        },
        body: JSON.stringify({ pad: 'x'.repeat(10_000) }),
      }),
      env
    );
    expect(hugeAdmin.status).toBe(413);

    // 4. Atomic checkD1RateLimit strictly enforces limit under burst calls
    const results = await Promise.all(
      Array.from({ length: 6 }, () => checkD1RateLimit(env.DB, 'burst:test', 3, 60))
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(results.filter((r) => !r.allowed)).toHaveLength(3);

    // 5. Server-side filtered Admin overview returns accurate filteredTotals
    const filtRes = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/config/overview?userSearch=dup_wh&signalInstrument=GBPUSD&paperInstrument=GBPUSD', {
        headers: { Cookie: cookie },
      }),
      env
    );
    const filt = (await filtRes.json()) as any;
    expect(filt.totals.usersTotal).toBe(2);
    expect(filt.filteredTotals.users).toBe(1);
    expect(filt.filteredTotals.signals).toBe(0);
    expect(filt.filteredTotals.paperTrades).toBe(0);

    // 6. Economic event retention prunes >90d events while preserving recent events
    const oldEvIso = new Date(Date.now() - 120 * 86400 * 1000).toISOString();
    const newEvIso = new Date().toISOString();
    sqlite.prepare(`INSERT INTO economic_events (id, country, currency, event, timestamp, importance, source) VALUES ('ev_prune_old', 'US', 'USD', 'Old', ?, 'LOW', 'biquote'), ('ev_keep_new', 'US', 'USD', 'New', ?, 'LOW', 'biquote')`).run(oldEvIso, newEvIso);
    const pruned = await pruneOperationalTables(env.DB);
    expect(pruned.economicEventsDeleted).toBe(1);
    expect(sqlite.prepare(`SELECT id FROM economic_events WHERE id = 'ev_keep_new'`).get()).toBeDefined();

    // 7. Synchronize >100 candles via chunked D1 batching & verify 1H budget skips redundant same-hour 1H fetch on 2nd sync
    const baseMs = Math.floor(Date.now() / 300_000) * 300_000;
    const makeBars = (count: number, step: number) =>
      Array.from({ length: count }, (_, idx) => {
        const ts = baseMs - (count - idx) * step;
        return {
          datetime: new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
          open: '1.1000',
          high: '1.1010',
          low: '1.0990',
          close: '1.1005',
        };
      });

    let fetch1hCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('biquote.io')) return new Response(JSON.stringify([]), { status: 200 });
        if (url.includes('api.twelvedata.com')) {
          if (url.includes('interval=1h')) {
            fetch1hCount++;
            return new Response(JSON.stringify({ status: 'ok', values: makeBars(30, 3_600_000) }), { status: 200 });
          }
          return new Response(JSON.stringify({ status: 'ok', values: makeBars(110, 300_000) }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      })
    );
    await worker.runSynchronization(env, 'BATCH_TEST_1');
    const first1hCount = fetch1hCount;
    expect(first1hCount).toBe(4); // 4 instruments once
    expect((sqlite.prepare(`SELECT COUNT(*) as c FROM market_candles WHERE instrument = 'EURUSD' AND timeframe = '5M'`).get() as any).c).toBe(110);

    await worker.runSynchronization(env, 'BATCH_TEST_2');
    expect(fetch1hCount).toBe(first1hCount); // 1H skipped within same hour -> budget saved

    // 8. Concurrent runDailyRecap respects DAILY_RECAP lease so each of the 2 connected subscribers only receives 1 recap (not 4)
    let recapSentCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        recapSentCount++;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 950 } }), { status: 200 });
      })
    );
    await Promise.all([runDailyRecap(env, '2026-11-18'), runDailyRecap(env, '2026-11-18')]);
    expect(recapSentCount).toBe(2);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) as c FROM daily_recap_deliveries WHERE recap_date = '2026-11-18' AND status = 'SENT'`).get() as any).c
    ).toBe(2);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) as c FROM scheduled_job_runs WHERE job_name = 'DAILY_RECAP' AND status = 'SUCCEEDED'`).get() as any).c
    ).toBe(1);
  });
});
