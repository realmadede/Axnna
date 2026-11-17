import { CandidateSetup } from '../core-engine/Types';
import { getMostRecentFxSessionCloseMs, isFxMarketClosedUtc } from '../utils/time';
import { Confluence, FundamentalContext } from './FundamentalEngine';

export type RiskDecisionOutcome = 'APPROVED' | 'REJECTED';

export type RiskReasonCode =
  | 'RISK_APPROVED'
  | 'SCORE_BELOW_THRESHOLD'
  | 'HIGH_EVENT_RISK'
  | 'FUNDAMENTAL_DATA_UNAVAILABLE'
  | 'INVALID_SETUP_STATUS'
  | 'UNSUPPORTED_INSTRUMENT'
  | 'INVALID_STRATEGY_STATE'
  | 'MISSING_MARKET_DATA'
  | 'STALE_SIGNAL'
  | 'INVALID_SETUP_GEOMETRY'
  | 'INSUFFICIENT_RR'
  | 'DUPLICATE_ALERT';

export interface RiskGateInput {
  signal: CandidateSetup;
  instrument: string;
  expectedStrategyVersion: string;
  alertScoreThreshold?: number;
  fundamentalContext: FundamentalContext | null;
  confluence: Confluence | null;
  hasCompletedMarketData: boolean;
  latestCompletedCandleMs: number | null;
  nowMs?: number;
  maxSignalAgeMs?: number;
  maxMarketStalenessMs?: number | null;
  requireFundamentalAvailability?: boolean;
  alreadyAlerted?: boolean;
}

export interface RiskGateDecision {
  decision: RiskDecisionOutcome;
  reasonCode: RiskReasonCode;
  reasonDetail: string;
  computedRr: number | null;
}

const SUPPORTED_SET = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']);
const DEFAULT_MAX_SIGNAL_AGE_MS = 30 * 60 * 1000;

/**
 * Deterministic, stateless Risk Gate sitting strictly between signal qualification
 * and downstream Telegram alerting / paper trading.
 */
export function evaluateRiskGate(input: RiskGateInput): RiskGateDecision {
  const {
    signal,
    instrument,
    expectedStrategyVersion,
    alertScoreThreshold = 65,
    fundamentalContext,
    confluence,
    hasCompletedMarketData,
    latestCompletedCandleMs,
    nowMs,
    maxSignalAgeMs = DEFAULT_MAX_SIGNAL_AGE_MS,
    maxMarketStalenessMs = null,
    requireFundamentalAvailability = true,
    alreadyAlerted = false,
  } = input;

  if (!SUPPORTED_SET.has(instrument)) {
    return {
      decision: 'REJECTED',
      reasonCode: 'UNSUPPORTED_INSTRUMENT',
      reasonDetail: `Instrument ${instrument} is outside monitored pairs.`,
      computedRr: null,
    };
  }

  if (signal.strategyVersion !== expectedStrategyVersion) {
    return {
      decision: 'REJECTED',
      reasonCode: 'INVALID_STRATEGY_STATE',
      reasonDetail: `Strategy version mismatch (${signal.strategyVersion} !== ${expectedStrategyVersion}).`,
      computedRr: null,
    };
  }

  if (!hasCompletedMarketData || latestCompletedCandleMs === null || !Number.isFinite(latestCompletedCandleMs)) {
    return {
      decision: 'REJECTED',
      reasonCode: 'MISSING_MARKET_DATA',
      reasonDetail: `Completed 5M/1H candle history unavailable for ${instrument}.`,
      computedRr: null,
    };
  }

  if (
    maxMarketStalenessMs !== null &&
    nowMs !== undefined &&
    nowMs - latestCompletedCandleMs > maxMarketStalenessMs
  ) {
    const weekendClosedWithRecentClose =
      isFxMarketClosedUtc(nowMs) &&
      latestCompletedCandleMs >= getMostRecentFxSessionCloseMs(nowMs) - 30 * 60 * 1000;
    if (!weekendClosedWithRecentClose) {
      return {
        decision: 'REJECTED',
        reasonCode: 'MISSING_MARKET_DATA',
        reasonDetail: `Market candle feed for ${instrument} is stale beyond ${Math.round(maxMarketStalenessMs / 60000)}m.`,
        computedRr: null,
      };
    }
  }

  if (signal.status !== 'ALERT_ELIGIBLE') {
    return {
      decision: 'REJECTED',
      reasonCode: 'INVALID_SETUP_STATUS',
      reasonDetail: `Setup status "${signal.status}" is not eligible for risk approval.`,
      computedRr: null,
    };
  }

  const score = Number(signal.technicalScore ?? 0);
  if (!Number.isFinite(score) || score < alertScoreThreshold) {
    return {
      decision: 'REJECTED',
      reasonCode: 'SCORE_BELOW_THRESHOLD',
      reasonDetail: `Technical setup strength ${score}/100 is below threshold ${alertScoreThreshold}.`,
      computedRr: null,
    };
  }

  const referenceMs = nowMs ?? latestCompletedCandleMs;
  if (!Number.isFinite(signal.detectionTimestamp) || referenceMs - signal.detectionTimestamp > maxSignalAgeMs) {
    return {
      decision: 'REJECTED',
      reasonCode: 'STALE_SIGNAL',
      reasonDetail: `Signal age exceeds maximum window (${Math.round(maxSignalAgeMs / 60000)}m).`,
      computedRr: null,
    };
  }

  const entry = signal.entryPrice;
  const stop = signal.stopLossPrice;
  const target = signal.structuralTargetPrice;

  if (
    typeof entry !== 'number' ||
    typeof stop !== 'number' ||
    typeof target !== 'number' ||
    !Number.isFinite(entry) ||
    !Number.isFinite(stop) ||
    !Number.isFinite(target)
  ) {
    return {
      decision: 'REJECTED',
      reasonCode: 'INVALID_SETUP_GEOMETRY',
      reasonDetail: 'Signal is missing numeric entry, stop, or structural target price.',
      computedRr: null,
    };
  }

  const validGeometry =
    signal.direction === 'LONG' ? stop < entry && entry < target : target < entry && entry < stop;
  if (!validGeometry) {
    return {
      decision: 'REJECTED',
      reasonCode: 'INVALID_SETUP_GEOMETRY',
      reasonDetail: `Directional price geometry invalid for ${signal.direction} (${stop} / ${entry} / ${target}).`,
      computedRr: null,
    };
  }

  const riskDist = Math.abs(entry - stop);
  const rewardDist = Math.abs(target - entry);
  const computedRr = riskDist > 0 ? rewardDist / riskDist : 0;
  if (!Number.isFinite(computedRr) || computedRr < 1.0) {
    return {
      decision: 'REJECTED',
      reasonCode: 'INSUFFICIENT_RR',
      reasonDetail: `Structural R:R (${computedRr.toFixed(2)}) is below minimum 1.00.`,
      computedRr,
    };
  }

  if (alreadyAlerted) {
    return {
      decision: 'REJECTED',
      reasonCode: 'DUPLICATE_ALERT',
      reasonDetail: `Setup ${signal.setupId} already has recorded alert deliveries.`,
      computedRr,
    };
  }

  if (confluence === 'HIGH EVENT RISK' || fundamentalContext?.eventRisk === 'HIGH' || fundamentalContext?.eventRisk === 'EXTREME') {
    return {
      decision: 'REJECTED',
      reasonCode: 'HIGH_EVENT_RISK',
      reasonDetail: `Blocked by high-impact economic event risk (${fundamentalContext?.eventRisk ?? 'HIGH'}).`,
      computedRr,
    };
  }

  if (
    requireFundamentalAvailability &&
    (!fundamentalContext || fundamentalContext.dataAvailable === false || fundamentalContext.eventRisk === 'UNKNOWN')
  ) {
    return {
      decision: 'REJECTED',
      reasonCode: 'FUNDAMENTAL_DATA_UNAVAILABLE',
      reasonDetail: 'Economic calendar data unavailable or stale; cannot verify low event risk.',
      computedRr,
    };
  }

  return {
    decision: 'APPROVED',
    reasonCode: 'RISK_APPROVED',
    reasonDetail: `Passed score (${score}/100), geometry (R:R ${computedRr.toFixed(2)}), and fundamental risk checks.`,
    computedRr,
  };
}
