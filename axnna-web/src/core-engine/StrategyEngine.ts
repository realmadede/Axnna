import {
  InternalCandle
} from './MarketData';
import {
  CandidateSetup,
  Direction,
  HTFBias,
  LiquidityReference,
  StrategyConfig,
  SweepEvidence
} from './Types';
import { ScoringModel } from './ScoringModel';

export class StrategyEngine {
  private config: StrategyConfig;
  private htfCandles: InternalCandle[] = [];
  private ltfCandles: InternalCandle[] = [];

  private currentHtfBias: HTFBias = 'NEUTRAL';
  private htfSwingHighs: InternalCandle[] = [];
  private htfSwingLows: InternalCandle[] = [];

  private activeBsl: LiquidityReference | null = null;
  private activeSsl: LiquidityReference | null = null;

  // Active candidate being built
  private activeCandidate: Partial<CandidateSetup> | null = null;

  private atr: number | null = null;
  private trueRanges: number[] = [];

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  public getActiveCandidate(): Partial<CandidateSetup> | null {
    return this.activeCandidate;
  }

  public processCandles(htfCandles: InternalCandle[], ltfCandles: InternalCandle[]): CandidateSetup[] {
    const results: CandidateSetup[] = [];

    // Reset state for clean run
    this.htfCandles = htfCandles;
    this.ltfCandles = [];
    this.htfSwingHighs = [];
    this.htfSwingLows = [];
    this.currentHtfBias = 'NEUTRAL';
    this.activeBsl = null;
    this.activeSsl = null;
    this.activeCandidate = null;
    this.atr = null;
    this.trueRanges = [];

    // Pre-calculate HTF swings & bias
    this.calculateHtfStructure();

    // Process LTF chronologically
    for (const candle of ltfCandles) {
      this.ltfCandles.push(candle);
      
      const candidate = this.processLtfCandle(candle);
      if (candidate && (candidate.status === 'REJECTED' || candidate.status === 'ALERT_ELIGIBLE' || candidate.status === 'QUALIFIED')) {
        results.push(candidate);
      }
    }

    return results;
  }

  private calculateHtfStructure() {
    const n = this.config.swingLengthHTF;
    if (this.htfCandles.length < (2 * n) + 1) return;

    for (let i = n; i < this.htfCandles.length - n; i++) {
      const candidate = this.htfCandles[i];
      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= n; j++) {
        if (this.htfCandles[i - j].high >= candidate.high || this.htfCandles[i + j].high >= candidate.high) isHigh = false;
        if (this.htfCandles[i - j].low <= candidate.low || this.htfCandles[i + j].low <= candidate.low) isLow = false;
      }

      if (isHigh) this.htfSwingHighs.push(candidate);
      if (isLow) this.htfSwingLows.push(candidate);
    }

    // Determine bias based on most recent confirmed swings
    const lastHigh = this.htfSwingHighs[this.htfSwingHighs.length - 1];
    const lastLow = this.htfSwingLows[this.htfSwingLows.length - 1];

    if (lastHigh && lastLow) {
      if (lastHigh.timestamp > lastLow.timestamp) {
        this.currentHtfBias = 'BEARISH';
      } else {
        this.currentHtfBias = 'BULLISH';
      }
    }
  }

  private updateAtr(candle: InternalCandle) {
    if (this.ltfCandles.length < 2) return;
    const prevCandle = this.ltfCandles[this.ltfCandles.length - 2];
    
    const tr = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevCandle.close),
      Math.abs(candle.low - prevCandle.close)
    );

    this.trueRanges.push(tr);
    const n = this.config.atrLength;

    if (this.trueRanges.length === n && this.atr === null) {
      this.atr = this.trueRanges.reduce((a, b) => a + b, 0) / n;
    } else if (this.atr !== null) {
      this.atr = ((this.atr * (n - 1)) + tr) / n;
    }
  }

  private updateLtfLiquidity() {
    const n = this.config.swingLengthLTF;
    if (this.ltfCandles.length < (2 * n) + 1) return;

    const i = this.ltfCandles.length - 1 - n;
    const candidate = this.ltfCandles[i];

    let isHigh = true;
    let isLow = true;

    for (let k = 1; k <= n; k++) {
      if (this.ltfCandles[i - k].high >= candidate.high || this.ltfCandles[i + k].high >= candidate.high) {
        isHigh = false;
      }
      if (this.ltfCandles[i - k].low <= candidate.low || this.ltfCandles[i + k].low <= candidate.low) {
        isLow = false;
      }
    }

    if (isHigh) {
      this.activeBsl = {
        id: `BSL_${candidate.timestamp}`,
        type: 'BSL',
        price: candidate.high,
        timestamp: candidate.timestamp,
        timeframe: this.config.ltfTimeframe,
        status: 'INTACT'
      };
    }
    if (isLow) {
      this.activeSsl = {
        id: `SSL_${candidate.timestamp}`,
        type: 'SSL',
        price: candidate.low,
        timestamp: candidate.timestamp,
        timeframe: this.config.ltfTimeframe,
        status: 'INTACT'
      };
    }
  }

  private processLtfCandle(candle: InternalCandle): CandidateSetup | null {
    this.updateAtr(candle);
    this.updateLtfLiquidity();

    if (!this.atr) return null;

    // 1. Detect Sweep
    if (!this.activeCandidate) {
      let sweptBsl = false;
      let sweptSsl = false;

      if (this.activeBsl && candle.high > this.activeBsl.price) sweptBsl = true;
      if (this.activeSsl && candle.low < this.activeSsl.price) sweptSsl = true;

      if (sweptBsl && sweptSsl) {
        // Ambiguous same-candle sweep, ignore
        return null;
      }

      if (sweptBsl) {
        this.activeCandidate = this.initCandidate('SHORT', candle, this.activeBsl!);
        this.activeBsl = null; 
      } else if (sweptSsl) {
        this.activeCandidate = this.initCandidate('LONG', candle, this.activeSsl!);
        this.activeSsl = null;
      }
      return null; // Need more candles for displacement
    }

    const c = this.activeCandidate!;

    // Ensure we don't hold pending candidates forever. Timeouts would be implemented here.
    if (c.status === 'DETECTED' && !c.displacement) {
      // 2. Check Displacement
      const range = candle.high - candle.low;
      if (range === 0) {
        return null;
      }
      const body = Math.abs(candle.close - candle.open);
      
      const isSizeValid = (range / this.atr) >= this.config.displacementSizeMultiplier;
      const isBodyValid = (body / range) >= this.config.displacementBodyRatio;
      
      let isCloseValid = false;
      if (c.direction === 'LONG') {
        isCloseValid = ((candle.close - candle.low) / range) >= this.config.displacementCloseLocation;
      } else {
        isCloseValid = ((candle.high - candle.close) / range) >= this.config.displacementCloseLocation;
      }

      if (isSizeValid && isBodyValid && isCloseValid) {
        c.displacement = {
          timestamp: candle.timestamp,
          atrAtTime: this.atr,
          range,
          body,
          bodyAtrRatio: range / this.atr,
          closeLocation: c.direction === 'LONG' ? (candle.close - candle.low) / range : (candle.high - candle.close) / range
        };
      } else {
        // Did not displace immediately, maybe allow a few candles, but for strictness let's say it must be the very next candle or within a window.
        // For simplicity, we just wait. If it sweeps opposite side, invalidate.
        if (c.direction === 'LONG' && candle.low < c.sweep!.extremePrice) {
           return this.rejectCandidate('Swept low before displacement');
        } else if (c.direction === 'SHORT' && candle.high > c.sweep!.extremePrice) {
           return this.rejectCandidate('Swept high before displacement');
        }
      }
      return null;
    }

    if (c.status === 'DETECTED' && c.displacement && !c.fvg) {
      // 3. Check FVG (Needs the candle after displacement)
      const dispIndex = this.ltfCandles.findIndex(l => l.timestamp === c.displacement!.timestamp);
      const currentIndex = this.ltfCandles.length - 1;
      
      if (currentIndex === dispIndex + 1) {
        const past = this.ltfCandles[dispIndex - 1]; // Sweep candle or candle before displacement
        if (!past) return this.rejectCandidate('Missing past candle for FVG');

        const minGap = this.config.fvgMinAtrRatio * this.atr;

        if (c.direction === 'LONG') {
          const gap = candle.low - past.high;
          if (gap >= minGap) {
            c.fvg = {
              direction: 'LONG',
              upperBoundary: candle.low,
              lowerBoundary: past.high,
              creationTimestamp: candle.timestamp,
              timeframe: this.config.ltfTimeframe,
              isOpen: true,
              isMitigated: false
            };
          } else {
            return this.rejectCandidate('No valid FVG formed');
          }
        } else {
          const gap = past.low - candle.high;
          if (gap >= minGap) {
            c.fvg = {
              direction: 'SHORT',
              upperBoundary: past.low,
              lowerBoundary: candle.high,
              creationTimestamp: candle.timestamp,
              timeframe: this.config.ltfTimeframe,
              isOpen: true,
              isMitigated: false
            };
          } else {
             return this.rejectCandidate('No valid FVG formed');
          }
        }
      } else if (currentIndex > dispIndex + 1) {
         // Should not happen as we check exactly on dispIndex + 1
      }
      return null;
    }

    if (c.status === 'DETECTED' && c.fvg && !c.retracement) {
       // 4. Wait for Retracement into FVG
       let retraced = false;
       let depth = 0;
       let price = 0;

       if (c.direction === 'LONG') {
         if (candle.low <= c.fvg.upperBoundary) {
           retraced = true;
           price = candle.low;
           const fvgSize = c.fvg.upperBoundary - c.fvg.lowerBoundary;
           depth = Math.min(1, (c.fvg.upperBoundary - candle.low) / fvgSize);
           if (candle.low < c.fvg.lowerBoundary) {
              // Mitigated completely or invalidated
              c.fvg.isMitigated = true;
           }
         }
       } else {
         if (candle.high >= c.fvg.lowerBoundary) {
           retraced = true;
           price = candle.high;
           const fvgSize = c.fvg.upperBoundary - c.fvg.lowerBoundary;
           depth = Math.min(1, (candle.high - c.fvg.lowerBoundary) / fvgSize);
           if (candle.high > c.fvg.upperBoundary) {
              c.fvg.isMitigated = true;
           }
         }
       }

       if (retraced) {
         c.retracement = {
           timestamp: candle.timestamp,
           price,
           depthIntoFVG: depth
         };
         
         // Setup is fully formed. Calculate targets and score.
         c.entryPrice = c.direction === 'LONG' ? c.fvg.upperBoundary : c.fvg.lowerBoundary;
         c.stopLossPrice = c.sweep!.extremePrice; // Structural stop

         // Target is the next opposing liquidity
         c.structuralTargetPrice = c.direction === 'LONG' ? 
           (this.activeBsl ? this.activeBsl.price : candle.high + (c.entryPrice - c.stopLossPrice)*2) : 
           (this.activeSsl ? this.activeSsl.price : candle.low - (c.stopLossPrice - c.entryPrice)*2);

         c.technicalScore = ScoringModel.calculateScore(c as CandidateSetup);
         
         if (c.technicalScore >= this.config.alertScoreThreshold) {
           c.status = 'ALERT_ELIGIBLE';
         } else {
           c.status = 'QUALIFIED'; // Still valid, but below threshold
         }

         const result = { ...c } as CandidateSetup;
         this.activeCandidate = null; // Reset for next setup
         return result;
       }
       
       // Invalidation by taking structural stop before retracement
       if (c.direction === 'LONG' && candle.low < c.sweep!.extremePrice) {
          return this.rejectCandidate('Structural stop taken before retracement');
       } else if (c.direction === 'SHORT' && candle.high > c.sweep!.extremePrice) {
          return this.rejectCandidate('Structural stop taken before retracement');
       }

       return null;
    }

    return null;
  }

  private initCandidate(direction: Direction, sweepCandle: InternalCandle, liqRef: LiquidityReference): Partial<CandidateSetup> {
    const sweepEv: SweepEvidence = {
      liquidityRefId: liqRef.id,
      sweepCandleTimestamp: sweepCandle.timestamp,
      direction: direction,
      sweptPrice: liqRef.price,
      extremePrice: direction === 'LONG' ? sweepCandle.low : sweepCandle.high
    };

    // Deterministic ID
    const setupId = `${sweepCandle.symbol}-techv1-${direction}-${sweepCandle.timestamp}`;

    return {
      setupId,
      symbol: sweepCandle.symbol,
      direction,
      strategyVersion: 'technical-v1',
      detectionTimestamp: sweepCandle.timestamp,
      analysisTimeframe: this.config.htfTimeframe,
      executionTimeframe: this.config.ltfTimeframe,
      htfBias: this.currentHtfBias,
      liquidityReference: liqRef,
      sweep: sweepEv,
      status: 'DETECTED',
      technicalScore: 0
    };
  }

  private rejectCandidate(reason: string): CandidateSetup {
    const c = this.activeCandidate!;
    c.status = 'REJECTED';
    c.invalidationReason = reason;
    this.activeCandidate = null;
    return c as CandidateSetup;
  }
}
