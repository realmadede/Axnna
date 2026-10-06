import { EngineConfig, Candle, StrategyState, SetupSnapshot, Direction } from './Types';

export class AxnnaV1Engine {
  private config: EngineConfig;
  public state: StrategyState;
  
  public generatedSignals: any[] = []; // Output queue

  constructor(config: EngineConfig, initialState?: StrategyState) {
    this.config = config;
    this.state = initialState || {
      atr: null,
      historicalTRs: [],
      candles5M: [],
      candles1H: [],
      activeAnchorHigh: null,
      activeAnchorLow: null,
      htfBias: 'NEUTRAL',
      activeBsl: null,
      activeSsl: null,
      activeSetup: null
    };
  }

  public processCandles(candles5M: Candle[], candles1H: Candle[]) {
    // Candles must be processed chronologically
    for (const c5 of candles5M) {
      // 1. Synchronize completed 1H data BEFORE 5M logic
      const htfToProcess = candles1H.filter(c1 => new Date(c1.timestamp).getTime() <= new Date(c5.timestamp).getTime());
      
      for (const c1 of htfToProcess) {
        if (!this.state.candles1H.find(c => c.timestamp === c1.timestamp)) {
          this.state.candles1H.push(c1);
          this.processHTF();
        }
      }

      if (!this.state.candles5M.find(c => c.timestamp === c5.timestamp)) {
        this.state.candles5M.push(c5);
        this.process5M(c5);
      }
    }
  }

  private processHTF() {
    // Detect 1H swings and update bias
    const c1H = this.state.candles1H;
    const n = this.config.swingN;
    if (c1H.length < (2 * n) + 1) return;

    const i = c1H.length - 1 - n; // Candidate index
    const candidate = c1H[i];

    // Check Swing High
    let isHigh = true;
    for (let k = 1; k <= n; k++) {
      if (candidate.high <= c1H[i - k].high || candidate.high <= c1H[i + k].high) {
        isHigh = false; break;
      }
    }
    if (isHigh) {
      this.state.activeAnchorHigh = { price: candidate.high, timestamp: candidate.timestamp };
    }

    // Check Swing Low
    let isLow = true;
    for (let k = 1; k <= n; k++) {
      if (candidate.low >= c1H[i - k].low || candidate.low >= c1H[i + k].low) {
        isLow = false; break;
      }
    }
    if (isLow) {
      this.state.activeAnchorLow = { price: candidate.low, timestamp: candidate.timestamp };
    }

    // Update HTF Bias
    const latestClose = c1H[c1H.length - 1].close;
    if (this.state.activeAnchorHigh && latestClose > this.state.activeAnchorHigh.price) {
      this.state.htfBias = 'BULLISH';
    } else if (this.state.activeAnchorLow && latestClose < this.state.activeAnchorLow.price) {
      this.state.htfBias = 'BEARISH';
    }
  }

  private process5M(_c5: Candle) {
    this.updateATR();
    this.update5MSwings();
    
    // Engine cannot operate before ATR is initialized
    if (this.state.atr === null) return;

    this.evaluateSetupPipeline();
  }

  private updateATR() {
    const c5 = this.state.candles5M;
    if (c5.length < 2) return;
    
    const t = c5.length - 1;
    const current = c5[t];
    const prev = c5[t - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );

    this.state.historicalTRs.push(tr);

    const n = this.config.atrN;
    if (this.state.historicalTRs.length === n && this.state.atr === null) {
      // Seed SMA
      const sum = this.state.historicalTRs.reduce((a, b) => a + b, 0);
      this.state.atr = sum / n;
    } else if (this.state.atr !== null) {
      // Recursive Smoothing
      this.state.atr = ((this.state.atr * (n - 1)) + tr) / n;
    }
  }

  private update5MSwings() {
    const c5 = this.state.candles5M;
    const n = this.config.swingN;
    if (c5.length < (2 * n) + 1) return;

    const i = c5.length - 1 - n;
    const candidate = c5[i];

    let isHigh = true;
    for (let k = 1; k <= n; k++) {
      if (candidate.high <= c5[i - k].high || candidate.high <= c5[i + k].high) {
        isHigh = false; break;
      }
    }
    if (isHigh) {
      this.state.activeBsl = { price: candidate.high, timestamp: candidate.timestamp };
    }

    let isLow = true;
    for (let k = 1; k <= n; k++) {
      if (candidate.low >= c5[i - k].low || candidate.low >= c5[i + k].low) {
        isLow = false; break;
      }
    }
    if (isLow) {
      this.state.activeSsl = { price: candidate.low, timestamp: candidate.timestamp };
    }
  }

  private evaluateSetupPipeline() {
    const c5 = this.state.candles5M;
    const latest = c5[c5.length - 1];
    const t = c5.length - 1;

    let setup = this.state.activeSetup;

    // 1. Terminal State Clearing
    if (setup && ['TARGET_HIT', 'STOP_HIT', 'EXPIRED', 'INVALIDATED'].includes(setup.status)) {
      this.state.activeSetup = null;
      setup = null;
    }

    // 2. Penetration (If no active setup)
    if (!setup) {
      const bslPenetrated = this.state.activeBsl && latest.high > this.state.activeBsl.price;
      const sslPenetrated = this.state.activeSsl && latest.low < this.state.activeSsl.price;

      if (bslPenetrated && sslPenetrated) {
        // Opposite penetration on same candle -> Ambiguous -> Do not create setup
        return; 
      }

      if (bslPenetrated) {
        setup = this.createSetup('SHORT', this.state.activeBsl!.price, latest.timestamp);
        this.state.activeBsl = null; // Permanently consumed
      } else if (sslPenetrated) {
        setup = this.createSetup('LONG', this.state.activeSsl!.price, latest.timestamp);
        this.state.activeSsl = null; // Permanently consumed
      }
    }

    if (!setup) return;

    // 3. Post-Sweep Invalidation
    if (setup.status === 'PENETRATED' || setup.status === 'BROKEN') {
      if (setup.direction === 'LONG' && latest.close < setup.liquidityPrice) {
        setup.status = 'INVALIDATED';
        return;
      }
      if (setup.direction === 'SHORT' && latest.close > setup.liquidityPrice) {
        setup.status = 'INVALIDATED';
        return;
      }
    }

    // 4. Sweep / Reclaim Confirmation
    if (setup.status === 'PENETRATED') {
      const isReclaimed = setup.direction === 'LONG' 
        ? latest.close > setup.liquidityPrice 
        : latest.close < setup.liquidityPrice;

      if (isReclaimed) {
        setup.status = 'BROKEN'; // Meaning Sweep is Confirmed (broken structure)
        setup.sweepTimestamp = latest.timestamp;
      } else {
        // Check Timeout
        const pIndex = c5.findIndex(c => c.timestamp === setup!.penetrationTimestamp);
        if (t - pIndex > this.config.maxSweepDuration) {
          setup.status = 'INVALIDATED';
          return;
        }
      }
    }

    // 5. Displacement
    if (setup.status === 'BROKEN') {
      const range = latest.high - latest.low;
      if (range > 0) {
        const body = Math.abs(latest.close - latest.open);
        const atrRef = this.state.atr!; 

        const sizeValid = (range / atrRef) >= this.config.dispSizeMultiplier;
        const bodyValid = (body / range) >= this.config.dispBodyRatio;
        
        let closeValid = false;
        if (setup.direction === 'LONG') {
          closeValid = ((latest.close - latest.low) / range) >= this.config.dispCloseLocation;
        } else {
          closeValid = ((latest.high - latest.close) / range) >= this.config.dispCloseLocation;
        }

        if (sizeValid && bodyValid && closeValid) {
          setup.status = 'DISPLACED';
          setup.displacementTimestamp = latest.timestamp;
        }
      }
      
      const sIndex = c5.findIndex(c => c.timestamp === setup!.sweepTimestamp);
      if (setup.status !== 'DISPLACED' && (t - sIndex) >= this.config.maxDisplacementDelay) {
        setup.status = 'INVALIDATED';
        return;
      }
    }

    // 6. FVG Confirmation (Strictly immediately following displacement)
    if (setup.status === 'DISPLACED' && setup.displacementTimestamp !== latest.timestamp) {
      const dispIndex = c5.findIndex(c => c.timestamp === setup!.displacementTimestamp);
      
      if (t !== dispIndex + 1) {
        setup.status = 'INVALIDATED';
        return;
      }

      const atrRef = this.state.atr!;
      const minGap = this.config.fvgMinAtrRatio * atrRef;
      const past = c5[dispIndex - 1];

      if (setup.direction === 'LONG') {
        const gap = latest.low - past.high;
        if (gap >= minGap) {
          setup.fvgTimestamp = latest.timestamp;
          setup.entry = past.high;
        } else {
          setup.status = 'INVALIDATED'; return;
        }
      } else {
        const gap = past.low - latest.high;
        if (gap >= minGap) {
          setup.fvgTimestamp = latest.timestamp;
          setup.entry = past.low;
        } else {
          setup.status = 'INVALIDATED'; return;
        }
      }

      // 7. Geometry / Target / Stop / RR
      const pIndex = c5.findIndex(c => c.timestamp === setup!.penetrationTimestamp);
      const window = c5.slice(pIndex, t + 1);

      if (setup.direction === 'LONG') {
        setup.stop = Math.min(...window.map(c => c.low));
        setup.target = this.state.activeBsl ? this.state.activeBsl.price : null;
      } else {
        setup.stop = Math.max(...window.map(c => c.high));
        setup.target = this.state.activeSsl ? this.state.activeSsl.price : null;
      }

      if (!setup.target) {
        setup.status = 'INVALIDATED'; return;
      }

      const risk = setup.direction === 'LONG' ? setup.entry! - setup.stop! : setup.stop! - setup.entry!;
      if (risk <= 0) {
        setup.status = 'INVALIDATED'; return;
      }

      const reward = setup.direction === 'LONG' ? setup.target! - setup.entry! : setup.entry! - setup.target!;
      setup.rr = reward / risk;

      if (setup.rr < this.config.minimumRR) {
        setup.status = 'INVALIDATED'; return;
      }

      // Valid Signal!
      setup.status = 'PENDING_ENTRY';
      
      // Emit signal
      this.generatedSignals.push({
        signal_id: crypto.randomUUID(),
        direction: setup.direction,
        generated_at: latest.timestamp,
        entry: setup.entry,
        stop: setup.stop,
        target: setup.target,
        rr: setup.rr,
        status: 'PENDING_ENTRY'
      });
    }
  }

  private createSetup(direction: Direction, price: number, timestamp: string): SetupSnapshot {
    return {
      setupId: crypto.randomUUID(),
      direction,
      status: 'PENETRATED',
      penetrationTimestamp: timestamp,
      sweepTimestamp: null,
      displacementTimestamp: null,
      fvgTimestamp: null,
      liquidityPrice: price,
      entry: null,
      stop: null,
      target: null,
      rr: null
    };
  }
}
