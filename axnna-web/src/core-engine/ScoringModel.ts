import { CandidateSetup } from './Types';

export interface ScoreWeights {
  htfBias: number;
  liquidityQuality: number;
  sweepQuality: number;
  displacementQuality: number;
  fvgQuality: number;
  retracementQuality: number;
  targetQuality: number;
}

export class ScoringModel {
  // Configurable weights, totaling 100
  static DEFAULT_WEIGHTS: ScoreWeights = {
    htfBias: 15,
    liquidityQuality: 15,
    sweepQuality: 15,
    displacementQuality: 20,
    fvgQuality: 15,
    retracementQuality: 10,
    targetQuality: 10
  };

  static calculateScore(setup: CandidateSetup, weights: ScoreWeights = this.DEFAULT_WEIGHTS): number {
    let score = 0;

    // 1. HTF Bias
    if (setup.direction === 'LONG' && setup.htfBias === 'BULLISH') {
      score += weights.htfBias;
    } else if (setup.direction === 'SHORT' && setup.htfBias === 'BEARISH') {
      score += weights.htfBias;
    } else if (setup.htfBias === 'NEUTRAL') {
      score += weights.htfBias * 0.5; // Neutral bias still gets some points, but not full
    }

    // 2. Liquidity Quality
    if (setup.liquidityReference) {
      // In a more advanced implementation, we could score based on the age/prominence of the liquidity.
      // For now, existence grants full points.
      score += weights.liquidityQuality;
    }

    // 3. Sweep Quality
    if (setup.sweep) {
      // Deeper sweeps might be scored higher. 
      // For now, existence grants full points.
      score += weights.sweepQuality;
    }

    // 4. Displacement Quality
    if (setup.displacement) {
      const { bodyAtrRatio, closeLocation } = setup.displacement;
      let dispScore = 0;
      
      // Stronger displacement = better score
      if (bodyAtrRatio > 1.0) dispScore += weights.displacementQuality * 0.6;
      else if (bodyAtrRatio > 0.5) dispScore += weights.displacementQuality * 0.3;

      if (closeLocation > 0.8) dispScore += weights.displacementQuality * 0.4;
      else if (closeLocation > 0.5) dispScore += weights.displacementQuality * 0.2;

      score += dispScore;
    }

    // 5. FVG Quality
    if (setup.fvg) {
      // Wider gaps or gaps closely aligned with the sweep could score higher.
      score += weights.fvgQuality;
    }

    // 6. Retracement Quality
    if (setup.retracement) {
      // Deeper retracement into FVG provides better RR, scoring higher.
      const depth = setup.retracement.depthIntoFVG;
      if (depth >= 0.5) score += weights.retracementQuality;
      else score += weights.retracementQuality * 0.5;
    }

    // 7. Target Quality (Reward to Risk)
    if (setup.entryPrice && setup.stopLossPrice && setup.structuralTargetPrice) {
      const risk = Math.abs(setup.entryPrice - setup.stopLossPrice);
      const reward = Math.abs(setup.structuralTargetPrice - setup.entryPrice);
      if (risk > 0) {
        const rr = reward / risk;
        if (rr >= 3) score += weights.targetQuality;
        else if (rr >= 2) score += weights.targetQuality * 0.8;
        else if (rr >= 1) score += weights.targetQuality * 0.5;
      }
    }

    return Math.min(Math.round(score), 100);
  }
}
