export interface EngineConfig {
  swingN: number;
  atrN: number;
  maxSweepDuration: number;
  maxDisplacementDelay: number;
  dispSizeMultiplier: number;
  dispBodyRatio: number;
  dispCloseLocation: number;
  fvgMinAtrRatio: number;
  minimumRR: number;
}

export type Direction = 'LONG' | 'SHORT';
export type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type SetupStatus = 'NONE' | 'PENETRATED' | 'BROKEN' | 'INVALIDATED' | 'DISPLACED' | 'PENDING_ENTRY' | 'ACTIVE_TRADE' | 'TARGET_HIT' | 'STOP_HIT' | 'EXPIRED';

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LiquidityReference {
  price: number;
  timestamp: string;
}

export interface SetupSnapshot {
  setupId: string;
  direction: Direction;
  status: SetupStatus;
  
  penetrationTimestamp: string | null;
  sweepTimestamp: string | null;
  displacementTimestamp: string | null;
  fvgTimestamp: string | null;

  liquidityPrice: number;
  
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
}

export interface StrategyState {
  atr: number | null;
  historicalTRs: number[];
  
  candles5M: Candle[];
  candles1H: Candle[];
  
  // 1H Engine State
  activeAnchorHigh: LiquidityReference | null;
  activeAnchorLow: LiquidityReference | null;
  htfBias: Bias;

  // 5M Engine State
  activeBsl: LiquidityReference | null;
  activeSsl: LiquidityReference | null;
  
  activeSetup: SetupSnapshot | null;
}
