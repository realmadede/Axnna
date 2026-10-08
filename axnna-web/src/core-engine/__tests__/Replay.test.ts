import { describe, it, expect } from 'vitest';
import { InternalCandle } from '../MarketData';
import { StrategyEngine } from '../StrategyEngine';


function generateReplayCandles(count: number, timeframeMs: number, startPrice: number): InternalCandle[] {
  const candles: InternalCandle[] = [];
  let currentPrice = startPrice;
  let time = 1600000000000;

  for (let i = 0; i < count; i++) {
    candles.push({
      symbol: 'EUR/USD',
      timeframe: timeframeMs === 3600000 ? '1H' : '5M',
      timestamp: time,
      open: currentPrice,
      high: currentPrice + 0.0020,
      low: currentPrice - 0.0020,
      close: currentPrice,
      isCompleted: true,
      priceBasis: 'midpoint'
    });
    time += timeframeMs;
  }
  return candles;
}

describe('Deterministic Historical Replay', () => {
  it('processes candles sequentially without look-ahead bias', () => {
    const engine = new StrategyEngine({
      htfTimeframe: '1H',
      ltfTimeframe: '5M',
      swingLengthHTF: 3,
      swingLengthLTF: 2,
      atrLength: 14,
      displacementSizeMultiplier: 1.5,
      displacementBodyRatio: 0.5,
      displacementCloseLocation: 0.5,
      fvgMinAtrRatio: 0.5,
      alertScoreThreshold: 65
    });

    const htfMaster = generateReplayCandles(30, 3600000, 1.1000);
    const ltfMaster = generateReplayCandles(50, 300000, 1.1000);
    
    // Inject a specific sequence to trigger a setup
    // 1. Establish ATR and Liquidity
    ltfMaster[15].high = 1.1050; // Swing high (BSL)
    
    // 2. Sweep BSL at candle 25
    ltfMaster[25].high = 1.1060; // Sweeps 1.1050
    ltfMaster[25].low = 1.0990;
    
    // 3. Displacement SHORT at candle 26
    ltfMaster[26].open = 1.1050;
    ltfMaster[26].high = 1.1050;
    ltfMaster[26].low = 1.0900;
    ltfMaster[26].close = 1.0910; // Large body, closes near low
    
    // 4. FVG creation at candle 27
    ltfMaster[27].high = 1.0890; // Gap between 25.low (1.0990) and 27.high (1.0890) -> Gap of 100 pips!
    ltfMaster[27].low = 1.0800;

    // 5. Retracement at candle 28
    ltfMaster[28].high = 1.0950; // Retraces into FVG (1.0890 - 1.0990)

    let totalSignalsDetected = 0;
    let setupId = '';

    // Replay loop
    for (let i = 20; i < ltfMaster.length; i++) {
      // Provide only candles up to 'i'
      const htfView = htfMaster.filter(c => c.timestamp <= ltfMaster[i].timestamp);
      const ltfView = ltfMaster.slice(0, i + 1);

      const results = engine.processCandles(htfView, ltfView);
      const eligible = results.filter(r => r.status === 'ALERT_ELIGIBLE' || r.status === 'QUALIFIED');
      
      if (i < 28) {
         // Setup should not exist yet since retracement hasn't happened
         expect(eligible.length).toBe(0);
      } else if (i === 28) {
         // Setup created exactly here
         expect(eligible.length).toBe(1);
         expect(eligible[0].direction).toBe('SHORT');
         expect(eligible[0].fvg).toBeDefined();
         setupId = eligible[0].setupId;
         totalSignalsDetected++;
      } else {
         // In a stateful engine, it might just emit nothing because activeCandidate is null.
         // Wait, the engine is stateless in `processCandles`! It evaluates the whole history again!
         // This means it will rediscover the same setup on candle 29, 30, etc.
         // BUT wait, it evaluates chronological. Once a setup completes and is emitted, `activeCandidate` is null.
         // Then it looks for new sweeps. So it WILL emit the identical setup again because the historical events haven't changed!
         // This is why deterministic setup IDs are critical.
         expect(eligible.length).toBe(1);
         expect(eligible[0].setupId).toBe(setupId); // Identical setup!
      }
    }

    expect(totalSignalsDetected).toBe(1);
  });
});
