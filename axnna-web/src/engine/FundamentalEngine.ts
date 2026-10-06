import { EconomicEvent } from '../providers/FundamentalProvider';
import { Direction } from './Types';

export type MacroRegime = 'RISK_ON' | 'RISK_OFF' | 'HAWKISH' | 'DOVISH' | 'MIXED' | 'UNCERTAIN';
export type EventRisk = 'NONE' | 'LOW' | 'ELEVATED' | 'HIGH' | 'EXTREME';
export type Confluence = 'STRONG ALIGNMENT' | 'MODERATE ALIGNMENT' | 'NEUTRAL' | 'CONFLICT' | 'HIGH EVENT RISK';

export interface IndicatorDefinition {
  indicator: string;
  strongerWhen: 'HIGHER' | 'LOWER';
  weakerWhen: 'HIGHER' | 'LOWER';
  unit: string;
  weight: number; // 0.0 to 1.0
}

export interface FundamentalContext {
  instrument: string;
  fundamentalScore: number; // -100 to +100
  confidence: number;       // 0.0 to 1.0
  macroRegime: MacroRegime;
  eventRisk: EventRisk;
  upcomingHighImpactEvent: EconomicEvent | null;
  timeUntilEventMs: number | null;
}

const INDICATORS: Record<string, IndicatorDefinition> = {
  'Core CPI m/m': { indicator: 'Core CPI m/m', strongerWhen: 'HIGHER', weakerWhen: 'LOWER', unit: '%', weight: 1.0 },
  'CPI m/m': { indicator: 'CPI m/m', strongerWhen: 'HIGHER', weakerWhen: 'LOWER', unit: '%', weight: 0.9 },
  'Non-Farm Payrolls': { indicator: 'Non-Farm Payrolls', strongerWhen: 'HIGHER', weakerWhen: 'LOWER', unit: 'K', weight: 1.0 },
  'Unemployment Rate': { indicator: 'Unemployment Rate', strongerWhen: 'LOWER', weakerWhen: 'HIGHER', unit: '%', weight: 0.9 },
  'GDP q/q': { indicator: 'GDP q/q', strongerWhen: 'HIGHER', weakerWhen: 'LOWER', unit: '%', weight: 0.8 },
  'Interest Rate Decision': { indicator: 'Interest Rate Decision', strongerWhen: 'HIGHER', weakerWhen: 'LOWER', unit: '%', weight: 1.0 },
};

export class FundamentalEngine {
  private config = {
    criticalPreEventMinutes: 15,
    highImpactPreEventMinutes: 60,
    postEventDecayMinutes: 60,
  };

  public evaluateContext(instrument: string, events: EconomicEvent[], currentTime: Date = new Date()): FundamentalContext {
    // 1. Currency Exposure
    // e.g., EURUSD is exposed to EUR and USD.
    const base = instrument.substring(0, 3);
    const quote = instrument.substring(3, 6);

    const relevantEvents = events.filter(e => e.currency === base || e.currency === quote);

    // 2. Event Risk Window
    let eventRisk: EventRisk = 'NONE';
    let upcomingEvent: EconomicEvent | null = null;
    let minTimeMs: number | null = null;

    const futureEvents = relevantEvents.filter(e => new Date(e.timestamp) >= currentTime && (e.importance === 'HIGH' || e.importance === 'MEDIUM'));
    futureEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (futureEvents.length > 0) {
      const next = futureEvents[0];
      const diffMs = new Date(next.timestamp).getTime() - currentTime.getTime();
      const diffMins = diffMs / 60000;

      if (diffMins <= this.config.criticalPreEventMinutes) {
        eventRisk = 'EXTREME';
      } else if (diffMins <= this.config.highImpactPreEventMinutes) {
        eventRisk = 'HIGH';
      } else if (diffMins <= this.config.highImpactPreEventMinutes * 4) {
        eventRisk = 'ELEVATED';
      } else {
        eventRisk = 'LOW';
      }
      
      upcomingEvent = next;
      minTimeMs = diffMs;
    }

    // Recent events for post-event risk
    const recentEvents = relevantEvents.filter(e => new Date(e.timestamp) <= currentTime && new Date(e.timestamp).getTime() > currentTime.getTime() - (this.config.postEventDecayMinutes * 60000));
    if (recentEvents.length > 0 && (eventRisk === 'NONE' || eventRisk === 'LOW')) {
      eventRisk = 'ELEVATED'; // Lingering volatility
    }

    // 3. Fundamental Bias Calculation
    let score = 0;
    let totalWeight = 0;
    let hawkishCount = 0;
    let dovishCount = 0;

    const pastEvents = relevantEvents.filter(e => new Date(e.timestamp) <= currentTime && e.actual !== null && e.estimate !== null);

    for (const ev of pastEvents) {
      const def = INDICATORS[ev.event] || { indicator: ev.event, strongerWhen: 'HIGHER', weakerWhen: 'LOWER', unit: '', weight: 0.5 };
      
      const actual = parseFloat(ev.actual!);
      const estimate = parseFloat(ev.estimate!);
      if (isNaN(actual) || isNaN(estimate)) continue;

      const surprise = actual - estimate;
      if (Math.abs(surprise) < 0.0001) continue;

      let isStronger = false;
      if (def.strongerWhen === 'HIGHER' && surprise > 0) isStronger = true;
      if (def.strongerWhen === 'LOWER' && surprise < 0) isStronger = true;

      // Base vs Quote context
      // If US event (quote) is stronger -> bearish for EURUSD
      // If EUR event (base) is stronger -> bullish for EURUSD
      let isBullish = false;
      if (ev.currency === base) {
        isBullish = isStronger;
      } else if (ev.currency === quote) {
        isBullish = !isStronger;
      }

      // Magnitude proxy (capped)
      const importanceMult = ev.importance === 'HIGH' ? 2 : (ev.importance === 'MEDIUM' ? 1 : 0.5);
      const absScore = Math.min(100, Math.abs(surprise) * 10 * importanceMult * def.weight);
      
      const contribution = isBullish ? absScore : -absScore;
      score += contribution;
      totalWeight += def.weight;

      // Macro tracking
      if (def.indicator.includes('CPI') || def.indicator.includes('Rate')) {
        if (isStronger) hawkishCount++;
        else dovishCount++;
      }
    }

    const finalScore = totalWeight > 0 ? Math.max(-100, Math.min(100, score / totalWeight)) : 0;
    const confidence = totalWeight > 0 ? Math.min(1.0, totalWeight / 5) : 0; // arbitrary scale

    // 4. Macro Regime
    let regime: MacroRegime = 'UNCERTAIN';
    if (hawkishCount > dovishCount + 1) regime = 'HAWKISH';
    else if (dovishCount > hawkishCount + 1) regime = 'DOVISH';
    else if (hawkishCount > 0 && dovishCount > 0) regime = 'MIXED';

    return {
      instrument,
      fundamentalScore: finalScore,
      confidence,
      macroRegime: regime,
      eventRisk,
      upcomingHighImpactEvent: upcomingEvent,
      timeUntilEventMs: minTimeMs
    };
  }

  public getConfluence(context: FundamentalContext, techDirection: Direction): Confluence {
    if (context.eventRisk === 'EXTREME' || context.eventRisk === 'HIGH') {
      return 'HIGH EVENT RISK';
    }

    const isFundyBullish = context.fundamentalScore > 20;
    const isFundyBearish = context.fundamentalScore < -20;
    
    if (techDirection === 'LONG') {
      if (isFundyBullish) return context.fundamentalScore > 50 ? 'STRONG ALIGNMENT' : 'MODERATE ALIGNMENT';
      if (isFundyBearish) return 'CONFLICT';
      return 'NEUTRAL';
    } else {
      if (isFundyBearish) return context.fundamentalScore < -50 ? 'STRONG ALIGNMENT' : 'MODERATE ALIGNMENT';
      if (isFundyBullish) return 'CONFLICT';
      return 'NEUTRAL';
    }
  }
}
