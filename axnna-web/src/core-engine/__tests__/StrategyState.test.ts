import { describe, it, expect } from 'vitest';
import { StrategyEngine } from '../StrategyEngine';
import { InternalCandle } from '../MarketData';
import { StrategyConfig } from '../Types';
import worker, { Env } from '../../worker';
import { createSqliteD1 } from '../../../tests/helpers/sqliteD1';

const CONFIG: StrategyConfig = {
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
};

function makeBullishScenario(): { htf: InternalCandle[]; ltf: InternalCandle[]; sweepIdx: number } {
  const htfBase = Date.UTC(2026, 10, 1, 0, 0, 0);
  const htf: InternalCandle[] = [];
  for (let i = 0; i < 15; i++) {
    const low = i === 10 ? 1.09 : 1.1 + i * 0.0005;
    htf.push({
      symbol: 'EURUSD',
      timeframe: '1H',
      timestamp: htfBase + i * 3600000,
      open: low + 0.001,
      high: low + 0.003,
      low,
      close: low + 0.002,
      isCompleted: true,
      priceBasis: 'provider_ohlc_unspecified',
    });
  }

  const ltfBase = Date.UTC(2026, 10, 1, 15, 0, 0);
  const ltf: InternalCandle[] = [];
  // 20 calm baseline candles to initialize ATR
  for (let i = 0; i < 20; i++) {
    ltf.push({
      symbol: 'EURUSD',
      timeframe: '5M',
      timestamp: ltfBase + i * 300000,
      open: 1.1000,
      high: 1.1010,
      low: 1.0990,
      close: 1.1002,
      isCompleted: true,
      priceBasis: 'provider_ohlc_unspecified',
    });
  }
  // LTF Swing Low at index 22 (surrounded by higher lows at 20,21,23,24; highs kept <= 1.1010 so no accidental BSL sweep)
  ltf.push(
    { symbol: 'EURUSD', timeframe: '5M', timestamp: ltfBase + 20 * 300000, open: 1.1002, high: 1.1008, low: 1.0995, close: 1.1000, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
    { symbol: 'EURUSD', timeframe: '5M', timestamp: ltfBase + 21 * 300000, open: 1.1000, high: 1.1008, low: 1.0992, close: 1.0998, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
    { symbol: 'EURUSD', timeframe: '5M', timestamp: ltfBase + 22 * 300000, open: 1.0998, high: 1.1004, low: 1.0980, close: 1.0996, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
    { symbol: 'EURUSD', timeframe: '5M', timestamp: ltfBase + 23 * 300000, open: 1.0996, high: 1.1008, low: 1.0991, close: 1.1005, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
    { symbol: 'EURUSD', timeframe: '5M', timestamp: ltfBase + 24 * 300000, open: 1.1005, high: 1.1008, low: 1.0994, close: 1.1006, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
  );
  // Index 25: Liquidity Sweep of SSL (1.0980)
  const sweepIdx = ltf.length;
  ltf.push({
    symbol: 'EURUSD',
    timeframe: '5M',
    timestamp: ltfBase + 25 * 300000,
    open: 1.0992,
    high: 1.0996,
    low: 1.0975,
    close: 1.0994,
    isCompleted: true,
    priceBasis: 'provider_ohlc_unspecified',
  });
  // Index 26: Bullish Displacement
  ltf.push({
    symbol: 'EURUSD',
    timeframe: '5M',
    timestamp: ltfBase + 26 * 300000,
    open: 1.0994,
    high: 1.1050,
    low: 1.0992,
    close: 1.1046,
    isCompleted: true,
    priceBasis: 'provider_ohlc_unspecified',
  });
  // Index 27: FVG creator (low 1.1020 > sweep.high 1.0996 => gap 0.0024)
  ltf.push({
    symbol: 'EURUSD',
    timeframe: '5M',
    timestamp: ltfBase + 27 * 300000,
    open: 1.1046,
    high: 1.1060,
    low: 1.1020,
    close: 1.1055,
    isCompleted: true,
    priceBasis: 'provider_ohlc_unspecified',
  });
  // Index 28: Retracement into FVG [1.0996, 1.1020]
  ltf.push({
    symbol: 'EURUSD',
    timeframe: '5M',
    timestamp: ltfBase + 28 * 300000,
    open: 1.1055,
    high: 1.1056,
    low: 1.1008,
    close: 1.1030,
    isCompleted: true,
    priceBasis: 'provider_ohlc_unspecified',
  });

  return { htf, ltf, sweepIdx };
}

describe('StrategyEngine Incremental State & Deterministic Replay', () => {
  it('survives Worker restart and rolling window truncation without losing an active candidate', () => {
    const { htf, ltf } = makeBullishScenario();

    // Run 1: process up through FVG formation (before retracement)
    const batch1 = ltf.slice(0, ltf.length - 1);
    const engine1 = new StrategyEngine(CONFIG);
    const res1 = engine1.processIncremental(htf, batch1, 0);
    expect(res1.setups).toHaveLength(0);
    expect(engine1.getActiveCandidate()?.status).toBe('DETECTED');

    const saved = engine1.exportState('technical-v1');

    // Run 2: new Worker instance restores state and receives ONLY the final retracement candle (sweep candle not in slice!)
    const engine2 = new StrategyEngine(CONFIG);
    const restored = engine2.restoreState(saved, 'technical-v1');
    expect(restored.restored).toBe(true);

    const onlyNewCandle = [ltf[ltf.length - 1]];
    const res2 = engine2.processIncremental(htf, onlyNewCandle);
    expect(res2.setups).toHaveLength(1);
    expect(res2.setups[0].status).toBe('ALERT_ELIGIBLE');
    expect(res2.setups[0].entryPrice).toBeCloseTo(1.102, 5);
  });

  it('produces identical results on repeated executions and ignores already-processed/out-of-order/incomplete candles', () => {
    const { htf, ltf } = makeBullishScenario();

    const fullEngine = new StrategyEngine(CONFIG);
    const fullResults = fullEngine.processCandles(htf, ltf);

    const incEngine = new StrategyEngine(CONFIG);
    // Feed shuffled out-of-order + duplicate + incomplete candles
    const incomplete: InternalCandle = { ...ltf[ltf.length - 1], timestamp: ltf[ltf.length - 1].timestamp + 300000, isCompleted: false };
    const shuffled = [...ltf].reverse().concat([ltf[0], incomplete]);
    const inc1 = incEngine.processIncremental(htf, shuffled, 0);
    expect(inc1.setups).toHaveLength(fullResults.length);
    expect(inc1.setups[0].setupId).toBe(fullResults[0].setupId);
    expect(inc1.setups[0].technicalScore).toBe(fullResults[0].technicalScore);

    // Replaying same candles produces 0 duplicate setups
    const inc2 = incEngine.processIncremental(htf, ltf);
    expect(inc2.setups).toHaveLength(0);
  });

  it('rejects persisted state on strategy version mismatch and persists state in real D1 SQLite', async () => {
    const engine = new StrategyEngine(CONFIG);
    const saved = engine.exportState('technical-v1');
    const mismatch = engine.restoreState(saved, 'technical-v2');
    expect(mismatch.restored).toBe(false);
    expect(mismatch.reason).toContain('Strategy version mismatch');

    // End-to-end persistence in real D1 SQLite via worker.runStrategyEngine
    const { db, sqlite } = createSqliteD1();
    const env: Env = {
      DB: db,
      TELEGRAM_BOT_TOKEN: '',
      TWELVEDATA_API_KEY: 'td_test',
    };
    const { htf, ltf } = makeBullishScenario();

    for (const c of [...htf, ...ltf]) {
      sqlite
        .prepare(
          `INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'twelvedata')`
        )
        .run(`${c.symbol}_${c.timeframe}_${c.timestamp}`, c.symbol, c.timeframe, new Date(c.timestamp).toISOString(), c.open, c.high, c.low, c.close);
    }

    await worker.runStrategyEngine(env, 'EURUSD');

    const signals = sqlite.prepare(`SELECT signal_id, status, technical_score FROM signals`).all() as any[];
    expect(signals).toHaveLength(1);
    expect(signals[0].status).toBe('ALERT_ELIGIBLE');

    const persistedRow = sqlite.prepare(`SELECT last_processed_5m_timestamp, state_payload FROM strategy_state WHERE instrument = 'EURUSD'`).get() as any;
    expect(persistedRow).toBeTruthy();
    expect(JSON.parse(persistedRow.state_payload).strategyVersion).toBe('technical-v1');

    // Re-running with same D1 candles creates no duplicate signal
    await worker.runStrategyEngine(env, 'EURUSD');
    const countAfter = sqlite.prepare(`SELECT COUNT(*) as cnt FROM signals`).get() as any;
    expect(countAfter.cnt).toBe(1);
  });
});
