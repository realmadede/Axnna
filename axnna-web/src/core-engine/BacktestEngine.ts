import { InternalCandle } from './MarketData';
import { StrategyEngine } from './StrategyEngine';
import { CandidateSetup, StrategyConfig } from './Types';

export interface InstrumentCosts {
  pipSize: number;
  spreadPips: number;
  commissionPips: number;
  slippagePips: number;
}

export type CostScenario = 'LOWER_COST' | 'BASELINE' | 'HIGHER_COST';

export interface BacktestConfig {
  initialCapital: number;
  riskPerTradePercent: number;
  symbol: string;
  strategyConfig: StrategyConfig;
  costScenario?: CostScenario; // Cost sensitivity mode
  // Optional overrides
  spreadPips?: number; 
  commissionPercent?: number; 
  slippagePips?: number;
}

// Default instrument configurations
export const INSTRUMENT_CONFIGS: Record<string, InstrumentCosts> = {
  'EURUSD': { pipSize: 0.0001, spreadPips: 1.0, commissionPips: 0.5, slippagePips: 0.5 },
  'GBPUSD': { pipSize: 0.0001, spreadPips: 1.5, commissionPips: 0.5, slippagePips: 0.5 },
  'USDJPY': { pipSize: 0.01, spreadPips: 1.5, commissionPips: 0.5, slippagePips: 0.5 },
  'XAUUSD': { pipSize: 0.1, spreadPips: 2.0, commissionPips: 0.5, slippagePips: 1.0 }, // Gold standard conversion: 1 pip = 10 cents ($0.10)
};

export function getInstrumentCosts(symbol: string, configOverrides?: BacktestConfig): InstrumentCosts {
  // Normalize symbol
  const cleanSymbol = symbol.replace(/[^A-Z]/g, '');
  // Default values represent engineering estimates, not guaranteed historical broker execution costs
  const defaults = INSTRUMENT_CONFIGS[cleanSymbol] || { pipSize: 0.0001, spreadPips: 1.5, commissionPips: 0.5, slippagePips: 0.5 };
  
  let multiplier = 1.0;
  if (configOverrides?.costScenario === 'LOWER_COST') multiplier = 0.5;
  if (configOverrides?.costScenario === 'HIGHER_COST') multiplier = 2.0;

  return {
    pipSize: defaults.pipSize,
    spreadPips: (configOverrides?.spreadPips !== undefined ? configOverrides.spreadPips : defaults.spreadPips) * multiplier,
    commissionPips: (configOverrides?.commissionPercent !== undefined ? configOverrides.commissionPercent : defaults.commissionPips) * multiplier,
    slippagePips: (configOverrides?.slippagePips !== undefined ? configOverrides.slippagePips : defaults.slippagePips) * multiplier
  };
}

export interface TradeResult {
  setupId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  strategyVersion: string;
  setupScore: number;
  
  signalTimestamp: number;
  entryTimestamp: number;
  exitTimestamp: number;
  
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  exitPrice: number;
  
  exitReason: 'TARGET' | 'STOP' | 'EXPIRED';
  
  grossResult: number;
  estimatedCosts: number;
  netResult: number;
  rMultiple: number;
}

export interface BacktestReport {
  totalSetups: number;
  rejectedSetups: number;
  executedTrades: number;
  
  wins: number;
  losses: number;
  breakEvens: number;
  
  winRate: number;
  averageWinR: number;
  averageLossR: number;
  expectancyR: number;
  profitFactor: number | null;
  
  maxDrawdownR: number;
  maxConsecutiveLosses: number;
  averageHoldingTimeMs: number;
  
  totalGrossR: number;
  totalCostsR: number;
  totalNetR: number;
  
  scoreBands: Record<string, { trades: number, winRate: number, netR: number }>;
  
  trades: TradeResult[];
  metadata?: BacktestMetadata;
  diagnostics?: ExecutionDiagnostics;
}

export interface ExecutionDiagnostics {
  signals: number;
  pendingOrders: number;
  entryTouches: number;
  cancellations: number;
  expiries: number;
}

export interface BacktestMetadata {
  provider: string;
  endpoint: string;
  symbol: string;
  timeframe: string;
  firstTimestamp: number;
  lastTimestamp: number;
  totalCandles: number;
  completedCandlesUsed: number;
  gapsDetected: number;
  priceBasis: string;
  spreadModel: string;
  slippageModel: string;
  commissionModel: string;
  strategyVersion: string;
  backtesterVersion: string;
  costScenario: string;
}

export class BacktestEngine {
  private config: BacktestConfig;
  private trades: TradeResult[] = [];
  
  constructor(config: BacktestConfig) {
    this.config = config;
  }

  public run(candles1H: InternalCandle[], candles5M: InternalCandle[]): BacktestReport {
    // Ensure chronological order
    const htf = [...candles1H].sort((a, b) => a.timestamp - b.timestamp);
    const ltf = [...candles5M].sort((a, b) => a.timestamp - b.timestamp);
    
    let diagSignals = 0;
    let diagPending = 0;
    let diagTouches = 0;
    let diagCancellations = 0;
    let diagExpiries = 0;

    const engine = new StrategyEngine(this.config.strategyConfig);
    const processedSetups = new Set<string>();
    
    let activeTrade: { setup: CandidateSetup, entryTime: number } | null = null;
    let pendingTrade: { setup: CandidateSetup, creationTime: number } | null = null;
    let rejectedCount = 0;
    
    // We step through the LTF (5M) array one by one to strictly prevent look-ahead bias
    for (let i = 0; i < ltf.length; i++) {
      const currentLTFCandle = ltf[i];
      const currentTimestamp = currentLTFCandle.timestamp;
      
      const costs = getInstrumentCosts(this.config.symbol, this.config);
      const spreadRaw = costs.spreadPips * costs.pipSize;
      const slippageRaw = costs.slippagePips * costs.pipSize;
      const halfSpread = spreadRaw / 2;

      // 1. Check if pending trade triggers entry
      if (pendingTrade && !activeTrade) {
         const { setup } = pendingTrade;
         const chartHigh = currentLTFCandle.high;
         const chartLow = currentLTFCandle.low;
         
         let triggeredEntry = false;
         let invalidated = false;

         // Twelve Data historical FX is a liquidity composite (midpoint).
         // Approximation: Bid = Midpoint - spread/2, Ask = Midpoint + spread/2
         if (setup.direction === 'LONG') {
             // LONG STOP (Market Sell): Triggers when Bid <= Stop
             // Bid = chartLow - halfSpread
             const stopTriggered = (chartLow - halfSpread) <= setup.stopLossPrice!;
             
             // LONG ENTRY (Limit Buy): Fills when Ask <= Entry Limit
             // Ask = chartLow + halfSpread
             const entryTriggered = (chartLow + halfSpread) <= setup.entryPrice!;
             
             if (stopTriggered) {
                invalidated = true; // Hit stop loss before/during entry
             } else if (entryTriggered) {
                triggeredEntry = true;
             }
         } else {
             // SHORT STOP (Market Buy): Triggers when Ask >= Stop
             // Ask = chartHigh + halfSpread
             const stopTriggered = (chartHigh + halfSpread) >= setup.stopLossPrice!;
             
             // SHORT ENTRY (Limit Sell): Fills when Bid >= Entry Limit
             // Bid = chartHigh - halfSpread
             const entryTriggered = (chartHigh - halfSpread) >= setup.entryPrice!;

             if (stopTriggered) {
                invalidated = true; 
             } else if (entryTriggered) {
                triggeredEntry = true;
             }
         }

         if (invalidated) {
             diagCancellations++;
             pendingTrade = null; // Missed or hit stop before entry could safely execute
         } else if (triggeredEntry) {
             diagTouches++;
             let actualEntry = setup.entryPrice!;
             // Slippage is execution deterioration relative to intended price
             if (setup.direction === 'LONG') actualEntry += slippageRaw; // Buy higher
             if (setup.direction === 'SHORT') actualEntry -= slippageRaw; // Sell lower
             
             activeTrade = { setup: { ...setup, entryPrice: actualEntry }, entryTime: currentTimestamp };
             pendingTrade = null;
         } else {
             // Expiry: Strategy uses a 3-candle pending order limit (15 mins)
             const elapsedMs = currentTimestamp - pendingTrade.creationTime;
             if (elapsedMs > 15 * 60 * 1000) {
                 diagExpiries++;
                 pendingTrade = null;
             }
         }
      }

      // 2. If we have an active trade, evaluate exit
      if (activeTrade) {
        const { setup, entryTime } = activeTrade;
        
        let hitTarget = false;
        let hitStop = false;
        let exitPrice = 0;
        let exitReason: 'TARGET' | 'STOP' | 'EXPIRED' | null = null;
        
        const chartHigh = currentLTFCandle.high;
        const chartLow = currentLTFCandle.low;
        
        if (setup.direction === 'LONG') {
           // LONG TARGET (Limit Sell): Fills when Bid >= Target Limit
           if ((chartHigh - halfSpread) >= setup.structuralTargetPrice!) hitTarget = true;
           // LONG STOP (Market Sell): Triggers when Bid <= Stop Limit
           if ((chartLow - halfSpread) <= setup.stopLossPrice!) hitStop = true;
        } else {
           // SHORT TARGET (Limit Buy): Fills when Ask <= Target Limit
           if ((chartLow + halfSpread) <= setup.structuralTargetPrice!) hitTarget = true;
           // SHORT STOP (Market Buy): Triggers when Ask >= Stop Limit
           if ((chartHigh + halfSpread) >= setup.stopLossPrice!) hitStop = true;
        }
        
        if (hitTarget && hitStop) {
           // Ambiguous candle: hit both in the same 5M window.
           hitTarget = false;
        }
        
        if (hitStop) {
           exitReason = 'STOP';
           exitPrice = setup.stopLossPrice!;
           if (setup.direction === 'LONG') exitPrice -= slippageRaw; // Slip worse on sell
           if (setup.direction === 'SHORT') exitPrice += slippageRaw; // Slip worse on buy
        } else if (hitTarget) {
           exitReason = 'TARGET';
           exitPrice = setup.structuralTargetPrice!;
        }
        
        if (exitReason) {
           // Calculate results
           const initialRiskRaw = Math.abs(setup.entryPrice! - setup.stopLossPrice!);
           const grossDistance = setup.direction === 'LONG' ? (exitPrice - setup.entryPrice!) : (setup.entryPrice! - exitPrice);
           
           const grossR = grossDistance / initialRiskRaw;
           const costRaw = (costs.spreadPips + costs.commissionPips) * costs.pipSize; 
           const costR = costRaw / initialRiskRaw;
           const netR = grossR - costR;
           
           this.trades.push({
              setupId: setup.setupId,
              symbol: setup.symbol,
              direction: setup.direction,
              strategyVersion: setup.strategyVersion,
              setupScore: setup.technicalScore,
              signalTimestamp: setup.detectionTimestamp,
              entryTimestamp: entryTime,
              exitTimestamp: currentTimestamp,
              entryPrice: setup.entryPrice!,
              stopLossPrice: setup.stopLossPrice!,
              targetPrice: setup.structuralTargetPrice!,
              exitPrice,
              exitReason,
              grossResult: grossR,
              estimatedCosts: costR,
              netResult: netR,
              rMultiple: netR
           });
           
           activeTrade = null;
        }
        
      // We no longer skip engine processing while in a trade, because that caused totalSetups to vary across cost scenarios!
      // But we will just ignore ALERT_ELIGIBLE if we already have a trade.
      }
      
      // 3. Slice history strictly up to current timestamp
      const availableHTF = htf.filter(c => c.timestamp <= currentTimestamp);
      const availableLTF = ltf.slice(0, i + 1);
      
      const results = engine.processCandles(availableHTF, availableLTF);
      
      for (const res of results) {
         if (processedSetups.has(res.setupId)) continue;
         
         if (res.status === 'REJECTED') {
            processedSetups.add(res.setupId);
            rejectedCount++;
            continue;
         }
         
         if (res.status === 'ALERT_ELIGIBLE') {
            diagSignals++;
            processedSetups.add(res.setupId);
            if (!pendingTrade && !activeTrade) {
              diagPending++;
              // Setup confirmed! But execution opportunity on THIS candle passed (we only alert at close).
              // Place as pending limit order for next candles.
              pendingTrade = { setup: res, creationTime: currentTimestamp };
            }
         }
      }
    }
    
    let gaps = 0;
    const ltfIntervalMs = 5 * 60 * 1000;
    for (let i = 1; i < ltf.length; i++) {
        if (ltf[i].timestamp - ltf[i-1].timestamp > ltfIntervalMs) {
            gaps++;
        }
    }

    const report = this.calculateMetrics(processedSetups.size, rejectedCount);
    const costs = getInstrumentCosts(this.config.symbol, this.config);
    
    report.metadata = {
      provider: 'Twelve Data',
      endpoint: '/time_series',
      symbol: this.config.symbol,
      timeframe: '5M (HTF: 1H)',
      firstTimestamp: ltf.length > 0 ? ltf[0].timestamp : 0,
      lastTimestamp: ltf.length > 0 ? ltf[ltf.length - 1].timestamp : 0,
      totalCandles: ltf.length,
      completedCandlesUsed: ltf.length,
      gapsDetected: gaps,
      priceBasis: 'synthetic_bid_ask_from_assumed_midpoint',
      spreadModel: `${costs.spreadPips} pips`,
      slippageModel: `${costs.slippagePips} pips`,
      commissionModel: `${costs.commissionPips} pips`,
      strategyVersion: 'technical-v1',
      backtesterVersion: 'v2-chronological',
      costScenario: this.config.costScenario || 'BASELINE'
    };

    report.diagnostics = {
        signals: diagSignals,
        pendingOrders: diagPending,
        entryTouches: diagTouches,
        cancellations: diagCancellations,
        expiries: diagExpiries
    };

    return report;
  }
  
  private calculateMetrics(totalSetups: number, rejectedCount: number): BacktestReport {
    let wins = 0;
    let losses = 0;
    let breakEvens = 0;
    
    let sumWinR = 0;
    let sumLossR = 0;
    
    let peakNetR = 0;
    let currentDrawdownR = 0;
    let maxDrawdownR = 0;
    
    let currentLossStreak = 0;
    let maxConsecutiveLosses = 0;
    
    let totalGrossR = 0;
    let totalCostsR = 0;
    let totalNetR = 0;
    let totalHoldTime = 0;
    
    const bands: Record<string, { trades: number, wins: number, netR: number }> = {
       '65-69': { trades: 0, wins: 0, netR: 0 },
       '70-74': { trades: 0, wins: 0, netR: 0 },
       '75-79': { trades: 0, wins: 0, netR: 0 },
       '80-89': { trades: 0, wins: 0, netR: 0 },
       '90-100': { trades: 0, wins: 0, netR: 0 }
    };
    
    for (const t of this.trades) {
       totalGrossR += t.grossResult;
       totalCostsR += t.estimatedCosts;
       totalNetR += t.netResult;
       totalHoldTime += (t.exitTimestamp - t.entryTimestamp);
       
       if (t.netResult > 0) {
          wins++;
          sumWinR += t.netResult;
          currentLossStreak = 0;
       } else if (t.netResult < 0) {
          losses++;
          sumLossR += t.netResult;
          currentLossStreak++;
          if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
       } else {
          breakEvens++;
          currentLossStreak = 0; // Or keep it? Conservative: reset
       }
       
       // Drawdown
       if (totalNetR > peakNetR) peakNetR = totalNetR;
       currentDrawdownR = peakNetR - totalNetR;
       if (currentDrawdownR > maxDrawdownR) maxDrawdownR = currentDrawdownR;
       
       // Bands
       let band = '';
       if (t.setupScore >= 65 && t.setupScore < 70) band = '65-69';
       else if (t.setupScore >= 70 && t.setupScore < 75) band = '70-74';
       else if (t.setupScore >= 75 && t.setupScore < 80) band = '75-79';
       else if (t.setupScore >= 80 && t.setupScore < 90) band = '80-89';
       else if (t.setupScore >= 90) band = '90-100';
       
       if (band) {
          bands[band].trades++;
          bands[band].netR += t.netResult;
          if (t.netResult > 0) bands[band].wins++;
       }
    }
    
    const executedTrades = this.trades.length;
    const winRate = executedTrades > 0 ? (wins / executedTrades) * 100 : 0;
    const avgWinR = wins > 0 ? sumWinR / wins : 0;
    const avgLossR = losses > 0 ? sumLossR / losses : 0; // Will be negative
    const expectancyR = executedTrades > 0 ? totalNetR / executedTrades : 0;
    
    const grossProfit = this.trades.filter(t => t.grossResult > 0).reduce((acc, t) => acc + t.grossResult, 0);
    const grossLoss = Math.abs(this.trades.filter(t => t.grossResult < 0).reduce((acc, t) => acc + t.grossResult, 0));
    // When gross profit is positive and gross loss is zero, preserve mathematically correct infinite result.
    // When both are zero, represent as null.
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null);
    
    const scoreBands: Record<string, { trades: number, winRate: number, netR: number }> = {};
    for (const [b, stats] of Object.entries(bands)) {
       scoreBands[b] = {
          trades: stats.trades,
          winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
          netR: stats.netR
       };
    }
    
    // We appended metadata in run()
    return {
       totalSetups,
       rejectedSetups: rejectedCount,
       executedTrades,
       wins,
       losses,
       breakEvens,
       winRate,
       averageWinR: avgWinR,
       averageLossR: avgLossR,
       expectancyR,
       profitFactor,
       maxDrawdownR,
       maxConsecutiveLosses,
       averageHoldingTimeMs: executedTrades > 0 ? totalHoldTime / executedTrades : 0,
       totalGrossR,
       totalCostsR,
       totalNetR,
       scoreBands,
       trades: this.trades
    };
  }
}
