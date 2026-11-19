import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { Env } from '../src/worker';
import { FundamentalEngine } from '../src/engine/FundamentalEngine';
import { evaluateRiskGate } from '../src/engine/RiskGate';
import {
  evaluateOpenPaperTrades,
  getPaperPortfolioOverview,
  registerPaperTradeFromApprovedSignal,
} from '../src/engine/PaperTradingEngine';
import { StrategyEngine } from '../src/core-engine/StrategyEngine';
import { CandidateSetup } from '../src/core-engine/Types';
import { createSqliteD1 } from './helpers/sqliteD1';

describe('Stage D Risk Gate, Paper Trading Lifecycle, Security Boundaries & Staging Simulation', () => {
  let env: Env;
  let sqlite: any;

  beforeEach(() => {
    const setup = createSqliteD1();
    sqlite = setup.sqlite;
    env = {
      DB: setup.db,
      ENVIRONMENT: 'staging',
      TELEGRAM_BOT_TOKEN: '123456:STAGING_BOT_TOKEN',
      TELEGRAM_WEBHOOK_SECRET: 'staging_webhook_secret_token_32ch',
      TWELVEDATA_API_KEY: 'staging_twelvedata_key',
      ACTOR_HASH_SECRET: 'stage-d-actor-hash-secret-32chars',
      ALLOWED_ORIGINS: 'https://axnna-staging.madede.workers.dev',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeCandidate(overrides: Partial<CandidateSetup> = {}): CandidateSetup {
    return {
      setupId: 'EURUSD-techv1-LONG-1794900000000',
      symbol: 'EURUSD',
      direction: 'LONG',
      strategyVersion: 'technical-v1',
      detectionTimestamp: 1794900000000,
      analysisTimeframe: '1H',
      executionTimeframe: '5M',
      htfBias: 'BULLISH',
      entryPrice: 1.1000,
      stopLossPrice: 1.0950,
      structuralTargetPrice: 1.1100,
      technicalScore: 78,
      status: 'ALERT_ELIGIBLE',
      ...overrides,
    };
  }

  it('FundamentalEngine explicitly marks missing calendar data as UNKNOWN rather than confirmed low risk', () => {
    const engine = new FundamentalEngine();
    const ctx = engine.evaluateContext('EURUSD', [], new Date('2026-11-17T12:00:00Z'), {
      calendarDataAvailable: false,
    });
    expect(ctx.eventRisk).toBe('UNKNOWN');
    expect(ctx.dataAvailable).toBe(false);
  });

  it('evaluateRiskGate enforces all deterministic checks and rejection reasons', () => {
    const baseCtx = {
      instrument: 'EURUSD',
      fundamentalScore: 10,
      confidence: 0.5,
      macroRegime: 'UNCERTAIN' as const,
      eventRisk: 'LOW' as const,
      upcomingHighImpactEvent: null,
      timeUntilEventMs: null,
      dataAvailable: true,
    };

    const baseInput = {
      signal: makeCandidate(),
      instrument: 'EURUSD',
      expectedStrategyVersion: 'technical-v1',
      alertScoreThreshold: 65,
      fundamentalContext: baseCtx,
      confluence: 'NEUTRAL' as const,
      hasCompletedMarketData: true,
      latestCompletedCandleMs: 1794900300000,
      nowMs: 1794900300000,
      alreadyAlerted: false,
    };

    expect(evaluateRiskGate(baseInput).decision).toBe('APPROVED');
    expect(evaluateRiskGate({ ...baseInput, instrument: 'BTCUSD' }).reasonCode).toBe('UNSUPPORTED_INSTRUMENT');
    expect(evaluateRiskGate({ ...baseInput, expectedStrategyVersion: 'technical-v2' }).reasonCode).toBe('INVALID_STRATEGY_STATE');
    expect(evaluateRiskGate({ ...baseInput, hasCompletedMarketData: false }).reasonCode).toBe('MISSING_MARKET_DATA');
    expect(
      evaluateRiskGate({
        ...baseInput,
        signal: makeCandidate({ status: 'QUALIFIED' }),
      }).reasonCode
    ).toBe('INVALID_SETUP_STATUS');
    expect(
      evaluateRiskGate({
        ...baseInput,
        signal: makeCandidate({ technicalScore: 64 }),
      }).reasonCode
    ).toBe('SCORE_BELOW_THRESHOLD');
    expect(
      evaluateRiskGate({
        ...baseInput,
        nowMs: 1794900000000 + 35 * 60 * 1000,
      }).reasonCode
    ).toBe('STALE_SIGNAL');
    expect(
      evaluateRiskGate({
        ...baseInput,
        signal: makeCandidate({ entryPrice: 1.09, stopLossPrice: 1.095, structuralTargetPrice: 1.11 }),
      }).reasonCode
    ).toBe('INVALID_SETUP_GEOMETRY');
    expect(
      evaluateRiskGate({
        ...baseInput,
        signal: makeCandidate({ entryPrice: 1.1, stopLossPrice: 1.09, structuralTargetPrice: 1.105 }),
      }).reasonCode
    ).toBe('INSUFFICIENT_RR');
    expect(evaluateRiskGate({ ...baseInput, alreadyAlerted: true }).reasonCode).toBe('DUPLICATE_ALERT');
    expect(evaluateRiskGate({ ...baseInput, confluence: 'HIGH EVENT RISK' }).reasonCode).toBe('HIGH_EVENT_RISK');
    expect(
      evaluateRiskGate({
        ...baseInput,
        fundamentalContext: { ...baseCtx, eventRisk: 'UNKNOWN', dataAvailable: false },
        requireFundamentalAvailability: true,
      }).reasonCode
    ).toBe('FUNDAMENTAL_DATA_UNAVAILABLE');
  });

  it('PaperTradingEngine enforces no-lookahead entry, conservative stop-first exit, unrealized P&L, expiry, invalidation, and portfolio metrics', async () => {
    const t0 = Date.UTC(2026, 10, 17, 10, 0, 0);
    const seedSignal = (id: string, dir: 'LONG' | 'SHORT', ts: number, entry: number, stop: number, target: number) => {
      sqlite.prepare(
        `INSERT INTO signals (
           signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
           anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status, technical_score
         ) VALUES (?, 'AXNNA_V1_LIQUIDITY_FVG', 'technical-v1', 'EURUSD', ?, ?, '1H', '5M', ?, ?, ?, 2.0, 'ALERT_ELIGIBLE', 80)`
      ).run(id, dir, new Date(ts).toISOString(), entry, stop, target);
    };

    // Initial empty portfolio is honest zero state
    const empty = await getPaperPortfolioOverview(env.DB);
    expect(empty.summary.closedPositions).toBe(0);
    expect(empty.summary.winRate).toBe(0);
    expect(empty.summary.profitFactor).toBeNull();

    // Trade 1: Winning LONG (fill on t0+5m, target hit on t0+10m; candle AT t0 must be ignored -> no lookahead)
    const sigWin = makeCandidate({ setupId: 'sig_win', detectionTimestamp: t0, entryPrice: 1.1, stopLossPrice: 1.095, structuralTargetPrice: 1.11 });
    seedSignal('sig_win', 'LONG', t0, 1.1, 1.095, 1.11);
    const r1 = await registerPaperTradeFromApprovedSignal(env.DB, sigWin, 'AXNNA_V1_LIQUIDITY_FVG');
    const r1Dup = await registerPaperTradeFromApprovedSignal(env.DB, sigWin, 'AXNNA_V1_LIQUIDITY_FVG');
    expect(r1.created).toBe(true);
    expect(r1Dup.created).toBe(false);

    // Same-timestamp candle at t0 does NOT fill (strictly > signal_timestamp)
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0, open: 1.1, high: 1.12, low: 1.099, close: 1.115, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    expect((sqlite.prepare(`SELECT status FROM paper_trades WHERE signal_id = 'sig_win'`).get() as any).status).toBe('PENDING_ENTRY');

    // Fill candle at t0+5m (even if high hits 1.12 on same bar, target isn't triggered until next bar!)
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 300_000, open: 1.101, high: 1.115, low: 1.0995, close: 1.104, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    expect((sqlite.prepare(`SELECT status FROM paper_trades WHERE signal_id = 'sig_win'`).get() as any).status).toBe('ACTIVE_TRADE');

    // Floating unrealized P&L while ACTIVE_TRADE, before balance realizes on close
    sqlite
      .prepare(
        `INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
         VALUES ('mc_mid_1', 'EURUSD', '5M', ?, 1.101, 1.115, 1.0995, 1.104, 'twelvedata')`
      )
      .run(new Date(t0 + 300_000).toISOString());
    const midPortfolio = await getPaperPortfolioOverview(env.DB);
    expect(midPortfolio.summary.openPositions).toBe(1);
    expect(midPortfolio.summary.closedPositions).toBe(0);
    expect(midPortfolio.account.current_balance).toBe(10000);
    expect(midPortfolio.summary.unrealizedPnl).not.toBe(0);

    // Exit candle at t0+10m hits target (1.1101+ >= 1.11 + halfSpread)
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t0 + 600_000, open: 1.104, high: 1.112, low: 1.103, close: 1.111, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    const winRow = sqlite.prepare(`SELECT status, outcome, net_pnl, r_multiple FROM paper_trades WHERE signal_id = 'sig_win'`).get() as any;
    expect(winRow.status).toBe('TARGET_HIT');
    expect(winRow.outcome).toBe('WIN');
    expect(winRow.net_pnl).toBeGreaterThan(150);
    expect(winRow.r_multiple).toBeGreaterThan(1.5);

    // Trade 2: Ambiguous same-candle Stop + Target -> STOP-FIRST rule enforces STOP_HIT
    const t2 = t0 + 1_800_000;
    const sigAmb = makeCandidate({ setupId: 'sig_amb', direction: 'SHORT', detectionTimestamp: t2, entryPrice: 1.1, stopLossPrice: 1.105, structuralTargetPrice: 1.09 });
    seedSignal('sig_amb', 'SHORT', t2, 1.1, 1.105, 1.09);
    await registerPaperTradeFromApprovedSignal(env.DB, sigAmb, 'AXNNA_V1_LIQUIDITY_FVG');
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [
        { symbol: 'EURUSD', timeframe: '5M', timestamp: t2 + 300_000, open: 1.099, high: 1.1005, low: 1.098, close: 1.0995, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
        { symbol: 'EURUSD', timeframe: '5M', timestamp: t2 + 600_000, open: 1.1, high: 1.106, low: 1.088, close: 1.095, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
      ],
    });
    const ambRow = sqlite.prepare(`SELECT status, outcome, net_pnl FROM paper_trades WHERE signal_id = 'sig_amb'`).get() as any;
    expect(ambRow.status).toBe('STOP_HIT');
    expect(ambRow.outcome).toBe('LOSS');
    expect(ambRow.net_pnl).toBeLessThan(0);

    // Trade 3: Pending limit order expires after >15m
    const t3 = t0 + 3_600_000;
    const sigExp = makeCandidate({ setupId: 'sig_exp', detectionTimestamp: t3, entryPrice: 1.08, stopLossPrice: 1.075, structuralTargetPrice: 1.09 });
    seedSignal('sig_exp', 'LONG', t3, 1.08, 1.075, 1.09);
    await registerPaperTradeFromApprovedSignal(env.DB, sigExp, 'AXNNA_V1_LIQUIDITY_FVG');
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t3 + 20 * 60_000, open: 1.085, high: 1.087, low: 1.084, close: 1.086, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    expect((sqlite.prepare(`SELECT status, outcome FROM paper_trades WHERE signal_id = 'sig_exp'`).get() as any)).toMatchObject({ status: 'EXPIRED', outcome: 'EXPIRED' });

    // Trade 4: Pending limit order invalidated if stop is breached before fill
    const t4 = t0 + 5_400_000;
    const sigInv = makeCandidate({ setupId: 'sig_inv', detectionTimestamp: t4, entryPrice: 1.1, stopLossPrice: 1.095, structuralTargetPrice: 1.11 });
    seedSignal('sig_inv', 'LONG', t4, 1.1, 1.095, 1.11);
    await registerPaperTradeFromApprovedSignal(env.DB, sigInv, 'AXNNA_V1_LIQUIDITY_FVG');
    await evaluateOpenPaperTrades(env.DB, 'EURUSD', {
      EURUSD: [{ symbol: 'EURUSD', timeframe: '5M', timestamp: t4 + 300_000, open: 1.096, high: 1.097, low: 1.094, close: 1.0945, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }],
    });
    expect((sqlite.prepare(`SELECT status, outcome FROM paper_trades WHERE signal_id = 'sig_inv'`).get() as any)).toMatchObject({ status: 'INVALIDATED', outcome: 'CANCELLED' });

    const portfolio = await getPaperPortfolioOverview(env.DB);
    expect(portfolio.summary.closedPositions).toBe(2);
    expect(portfolio.summary.wins).toBe(1);
    expect(portfolio.summary.losses).toBe(1);
    expect(portfolio.summary.winRate).toBe(50);
    expect(portfolio.summary.profitFactor).toBeGreaterThan(1);
    expect(portfolio.equityCurve.length).toBe(2);
    expect(portfolio.byInstrument[0].instrument).toBe('EURUSD');
    expect(portfolio.byStrategyVersion[0].strategyVersion).toBe('technical-v1');
  });

  it('Executes full end-to-end staging simulation pipeline without live network or real money', async () => {
    // 1. Pair test Telegram subscriber
    const sessRes = await worker.fetch(new Request('https://axnna-staging.madede.workers.dev/api/telegram/session', { method: 'POST' }), env);
    const { token } = (await sessRes.json()) as any;
    await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET!,
        },
        body: JSON.stringify({
          update_id: 700,
          message: { from: { id: 901, username: 'staging_sim' }, chat: { id: 901 }, text: `/start ${token}` },
        }),
      }),
      env
    );

    // 2. Mock external calendar, TwelveData, and Telegram APIs for deterministic staging simulation
    const baseMs = Math.floor(Date.now() / 300_000) * 300_000;
    const candleValues5M = Array.from({ length: 30 }, (_, idx) => {
      const ts = baseMs - (30 - idx) * 300_000;
      const dt = new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
      return { datetime: dt, open: '1.1000', high: '1.1010', low: '1.0990', close: '1.1005' };
    });
    const candleValues1H = Array.from({ length: 10 }, (_, idx) => {
      const ts = baseMs - (10 - idx) * 3_600_000;
      const dt = new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
      return { datetime: dt, open: '1.1000', high: '1.1020', low: '1.0980', close: '1.1010' };
    });

    const spyEngine = vi.spyOn(StrategyEngine.prototype, 'processIncremental').mockReturnValueOnce({
      lastProcessed5mTimestamp: baseMs - 300_000,
      setups: [makeCandidate({ setupId: 'sim_eurusd_1', detectionTimestamp: baseMs - 300_000 })],
    });

    const telegramSent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('biquote.io')) {
          return new Response(
            JSON.stringify([
              { id: 'cal_1', time: new Date(Date.now() + 6 * 3_600_000).toISOString(), countryCode: 'US', currency: 'USD', name: 'Retail Sales', importance: 'low' },
            ]),
            { status: 200 }
          );
        }
        if (url.includes('api.twelvedata.com')) {
          const is1h = url.includes('interval=1h');
          return new Response(JSON.stringify({ status: 'ok', values: is1h ? candleValues1H : candleValues5M }), { status: 200 });
        }
        if (url.includes('api.telegram.org')) {
          telegramSent.push(JSON.parse(String(init?.body || '{}')).text);
          return new Response(JSON.stringify({ ok: true, result: { message_id: 888 } }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      })
    );

    const syncOutcome = await worker.runSynchronization(env, 'STAGING_SIMULATION_SYNC');
    expect(syncOutcome.status).toBe('SUCCEEDED');
    expect(telegramSent.some((t) => t.includes('sim_eurusd_1'))).toBe(true);

    // Risk Gate approved + Paper Trade created + Audit recorded
    const riskRow = sqlite.prepare(`SELECT decision, reason_code FROM risk_decisions WHERE signal_id = 'sim_eurusd_1'`).get() as any;
    expect(riskRow).toEqual({ decision: 'APPROVED', reason_code: 'RISK_APPROVED' });
    const paperRow = sqlite.prepare(`SELECT status, strategy_version FROM paper_trades WHERE signal_id = 'sim_eurusd_1'`).get() as any;
    expect(paperRow).toEqual({ status: 'PENDING_ENTRY', strategy_version: 'technical-v1' });

    // Simulation portfolio reflects real paper trade state directly in D1
    const ov = await getPaperPortfolioOverview(env.DB);
    expect(ov.mode).toBe('SIMULATION_ONLY');
    expect(ov.summary.pendingPositions).toBe(1);
    expect((sqlite.prepare(`SELECT COUNT(*) as c FROM risk_decisions WHERE decision = 'APPROVED'`).get() as any).c).toBe(1);
    spyEngine.mockRestore();
  });

  it('Blocks Telegram delivery and paper trade creation when Risk Gate rejects HIGH event risk during worker sync', async () => {
    const sessRes = await worker.fetch(new Request('https://axnna-staging.madede.workers.dev/api/telegram/session', { method: 'POST' }), env);
    const { token } = (await sessRes.json()) as any;
    await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET!,
        },
        body: JSON.stringify({
          update_id: 701,
          message: { from: { id: 902, username: 'risk_reject_sim' }, chat: { id: 902 }, text: `/start ${token}` },
        }),
      }),
      env
    );

    const baseMs = Math.floor(Date.now() / 300_000) * 300_000;
    const candleValues5M = Array.from({ length: 30 }, (_, idx) => {
      const ts = baseMs - (30 - idx) * 300_000;
      const dt = new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
      return { datetime: dt, open: '1.1000', high: '1.1010', low: '1.0990', close: '1.1005' };
    });
    const candleValues1H = Array.from({ length: 10 }, (_, idx) => {
      const ts = baseMs - (10 - idx) * 3_600_000;
      const dt = new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
      return { datetime: dt, open: '1.1000', high: '1.1020', low: '1.0980', close: '1.1010' };
    });

    const spyEngine = vi.spyOn(StrategyEngine.prototype, 'processIncremental').mockReturnValueOnce({
      lastProcessed5mTimestamp: baseMs - 300_000,
      setups: [makeCandidate({ setupId: 'sim_eurusd_blocked', detectionTimestamp: baseMs - 300_000 })],
    });

    const telegramCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('biquote.io')) {
          return new Response(
            JSON.stringify([
              { id: 'cal_hi', time: new Date(Date.now() + 10 * 60_000).toISOString(), countryCode: 'US', currency: 'USD', name: 'US CPI Release', importance: 'high' },
            ]),
            { status: 200 }
          );
        }
        if (url.includes('api.twelvedata.com')) {
          const is1h = url.includes('interval=1h');
          return new Response(JSON.stringify({ status: 'ok', values: is1h ? candleValues1H : candleValues5M }), { status: 200 });
        }
        if (url.includes('api.telegram.org')) {
          telegramCalls.push(String(init?.body || ''));
          return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      })
    );

    const syncOutcome = await worker.runSynchronization(env, 'RISK_REJECT_SIM');
    expect(syncOutcome.status).toBe('SUCCEEDED');
    expect(telegramCalls).toHaveLength(0);

    const riskRow = sqlite.prepare(`SELECT decision, reason_code, event_risk FROM risk_decisions WHERE signal_id = 'sim_eurusd_blocked'`).get() as any;
    expect(riskRow).toEqual({ decision: 'REJECTED', reason_code: 'HIGH_EVENT_RISK', event_risk: 'EXTREME' });
    const paperCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM paper_trades WHERE signal_id = 'sim_eurusd_blocked'`).get() as any).c;
    expect(paperCount).toBe(0);
    const auditRow = sqlite.prepare(`SELECT event_type, metadata FROM audit_events WHERE event_type = 'RISK_GATE_REJECTED'`).get() as any;
    expect(auditRow).toBeDefined();
    expect(auditRow.metadata).toContain('sim_eurusd_blocked');

    spyEngine.mockRestore();
  });

  it('Security boundary verification: rejects removed admin routes, encoded path traversals, and SQL injection attempts', async () => {
    // Removed /api/config/* and /api/auth/config routes cleanly return 404 JSON
    const removedOverview = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/config/overview', {
        headers: { Cookie: 'axnna_admin_session=forged.signature' },
      }),
      env
    );
    expect(removedOverview.status).toBe(404);

    const removedAuth = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/auth/config', {
        method: 'POST',
        headers: { Origin: 'https://axnna-staging.madede.workers.dev' },
      }),
      env
    );
    expect(removedAuth.status).toBe(404);

    // Encoded /api/%2e%2e path returns 404 JSON
    const encodedApi = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/config/%2e%2e/overview'),
      env
    );
    expect(encodedApi.status).toBe(404);

    // Removed feedback/analytics routes return 404 JSON and SQL injection payload in path params does not crash
    const removedFeedback = await worker.fetch(
      new Request('https://axnna-staging.madede.workers.dev/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Bug Report', message: 'Check removed endpoint' }),
      }),
      env
    );
    expect(removedFeedback.status).toBe(404);

    const sqliRes = await worker.fetch(
      new Request(
        `https://axnna-staging.madede.workers.dev/api/telegram/session/${encodeURIComponent("'; DROP TABLE signals; --")}`
      ),
      env
    );
    expect(sqliRes.status).toBe(404);
    expect(sqlite.prepare(`SELECT COUNT(*) as c FROM signals`).get()).toBeDefined();
  });
});
