export type Direction = 'LONG' | 'SHORT';
export type HTFBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type SetupStatus = 'DETECTED' | 'QUALIFIED' | 'REJECTED' | 'EXPIRED' | 'ALERT_ELIGIBLE' | 'ALERTED';

export interface Point {
  price: number;
  timestamp: number;
}

export interface LiquidityReference {
  id: string;
  type: 'BSL' | 'SSL'; // Buy-side liquidity (Highs), Sell-side liquidity (Lows)
  price: number;
  timestamp: number;
  timeframe: string;
  status: 'INTACT' | 'SWEPT';
}

export interface SweepEvidence {
  liquidityRefId: string;
  sweepCandleTimestamp: number;
  direction: Direction; // The direction of the sweep (LONG = swept SSL, SHORT = swept BSL)
  sweptPrice: number;
  extremePrice: number; // The actual high/low of the sweep candle
}

export interface DisplacementEvidence {
  timestamp: number;
  atrAtTime: number;
  range: number;
  body: number;
  bodyAtrRatio: number;
  closeLocation: number;
}

export interface FVGEvidence {
  direction: Direction;
  upperBoundary: number;
  lowerBoundary: number;
  creationTimestamp: number;
  timeframe: string;
  isOpen: boolean;
  isMitigated: boolean;
}

export interface RetracementEvidence {
  timestamp: number;
  price: number;
  depthIntoFVG: number;
}

export interface StrategyConfig {
  htfTimeframe: string;
  ltfTimeframe: string;
  swingLengthHTF: number;
  swingLengthLTF: number;
  atrLength: number;
  displacementSizeMultiplier: number; // Range / ATR
  displacementBodyRatio: number; // Body / Range
  displacementCloseLocation: number; // Where it closed relative to range
  fvgMinAtrRatio: number;
  alertScoreThreshold: number;
}

export interface CandidateSetup {
  setupId: string; // Unique deterministic ID
  symbol: string;
  direction: Direction;
  strategyVersion: string;
  detectionTimestamp: number;
  analysisTimeframe: string;
  executionTimeframe: string;
  
  // Evidence
  htfBias: HTFBias;
  liquidityReference?: LiquidityReference;
  sweep?: SweepEvidence;
  displacement?: DisplacementEvidence;
  fvg?: FVGEvidence;
  retracement?: RetracementEvidence;
  
  // Levels
  entryPrice?: number;
  stopLossPrice?: number;
  structuralTargetPrice?: number;
  
  invalidationReason?: string;
  technicalScore: number;
  status: SetupStatus;
}
