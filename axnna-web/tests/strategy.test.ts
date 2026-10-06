import { describe, it, expect, beforeEach } from 'vitest';
import { AxnnaV1Engine } from '../src/engine/AxnnaV1Strategy';
import { EngineConfig, Candle } from '../src/engine/Types';

const config: EngineConfig = {
  swingN: 2,
  atrN: 14,
  maxSweepDuration: 3,
  maxDisplacementDelay: 3,
  dispSizeMultiplier: 1.5,
  dispBodyRatio: 0.5,
  dispCloseLocation: 0.5,
  fvgMinAtrRatio: 0.5,
  minimumRR: 2.0
};

describe('Axnna V1 Liquidity-FVG Engine', () => {
  let engine: AxnnaV1Engine;

  beforeEach(() => {
    engine = new AxnnaV1Engine(config);
  });

  const createCandle = (ts: number, o: number, h: number, l: number, c: number): Candle => ({
    timestamp: new Date(ts * 1000 * 60).toISOString(),
    open: o,
    high: h,
    low: l,
    close: c
  });

  it('initializes ATR correctly', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(createCandle(i * 5, 1.1000, 1.1010, 1.0990, 1.1005));
    }
    
    engine.processCandles(candles, []);
    expect(engine.state.atr).not.toBeNull();
    // TR = 0.0020
    expect(engine.state.atr).toBeCloseTo(0.0020, 4);
  });

  it('detects 1H Bias', () => {
    const c1H: Candle[] = [
      createCandle(0, 1.0, 1.1, 0.9, 1.0),
      createCandle(60, 1.0, 1.2, 0.9, 1.0), // High
      createCandle(120, 1.0, 1.1, 0.9, 1.0),
      createCandle(180, 1.0, 1.1, 0.9, 1.0)
    ];

    const c5M = [createCandle(200, 1.0, 1.5, 0.9, 1.3)]; // Closes above 1.2 high

    engine.processCandles(c5M, c1H);
    expect(engine.state.htfBias).toBe('BULLISH');
  });

  it('detects 5M active liquidity', () => {
    const c5: Candle[] = [
      createCandle(0, 1.0, 1.1, 0.9, 1.0),
      createCandle(5, 1.0, 1.2, 0.9, 1.0), // High
      createCandle(10, 1.0, 1.1, 0.9, 1.0),
      createCandle(15, 1.0, 1.1, 0.9, 1.0)
    ];

    engine.processCandles(c5, []);
    expect(engine.state.activeBsl).not.toBeNull();
    expect(engine.state.activeBsl?.price).toBe(1.2);
  });

  it('executes full valid SHORT setup', () => {
    // 1. Establish ATR
    const c5: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      c5.push(createCandle(i * 5, 1.1000, 1.1010, 1.0990, 1.1000));
    }

    // 2. Establish BSL and SSL
    c5.push(createCandle(100, 1.1000, 1.1020, 1.0980, 1.1000)); // SSL = 1.0980
    c5.push(createCandle(105, 1.1000, 1.1020, 1.0990, 1.1000));
    c5.push(createCandle(110, 1.1000, 1.1050, 1.0990, 1.1000)); // BSL = 1.1050
    c5.push(createCandle(115, 1.1000, 1.1020, 1.0990, 1.1000));
    c5.push(createCandle(120, 1.1000, 1.1020, 1.0990, 1.1000));

    // 3. Sweep BSL
    c5.push(createCandle(125, 1.1000, 1.1060, 1.0990, 1.1040)); // Sweep

    // 4. Displacement (Bearish)
    // Needs large range, good body, close near low. ATR is ~0.0020.
    c5.push(createCandle(130, 1.1040, 1.1040, 1.0980, 1.0985));

    // 5. FVG Confirmation
    // previous low = 1.0990 (candle 125)
    // current high < 1.0990
    c5.push(createCandle(135, 1.0985, 1.0985, 1.0950, 1.0960)); // FVG created!

    engine.processCandles(c5, []);

    expect(engine.generatedSignals.length).toBe(1);
    const sig = engine.generatedSignals[0];
    expect(sig.direction).toBe('SHORT');
    expect(sig.entry).toBe(1.0990);
    expect(sig.stop).toBe(1.1060);
    expect(sig.target).toBe(1.0980);
    expect(sig.status).toBe('PENDING_ENTRY');
  });
});
