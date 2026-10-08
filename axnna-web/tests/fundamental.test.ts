import { describe, it, expect } from 'vitest';
import { FundamentalEngine } from '../src/engine/FundamentalEngine';
import { EconomicEvent } from '../src/providers/FundamentalProvider';

describe('FundamentalEngine', () => {
  const engine = new FundamentalEngine();

  const createEvent = (
    id: string,
    event: string,
    currency: string,
    importance: 'LOW' | 'MEDIUM' | 'HIGH',
    timestamp: string,
    estimate: string | null = null,
    actual: string | null = null
  ): EconomicEvent => ({
    id,
    country: 'US', // default
    currency,
    event,
    timestamp,
    importance,
    estimate,
    actual,
    previous: null,
    source: 'test'
  });

  it('calculates EXTREME event risk for upcoming high impact event within 15 minutes', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const upcoming = createEvent('1', 'Core CPI m/m', 'USD', 'HIGH', '2026-10-06T12:10:00Z');
    
    const context = engine.evaluateContext('EURUSD', [upcoming], now);
    
    expect(context.eventRisk).toBe('EXTREME');
    expect(context.upcomingHighImpactEvent?.id).toBe('1');
  });

  it('calculates fundamental bias for EURUSD given strong US CPI', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    
    // US CPI is stronger than expected (actual > estimate)
    const pastUsdEvent = createEvent('2', 'Core CPI m/m', 'USD', 'HIGH', '2026-10-06T10:00:00Z', '0.2', '0.5');
    
    const context = engine.evaluateContext('EURUSD', [pastUsdEvent], now);
    
    // Strong US data is BEARISH for EURUSD -> Score should be negative
    expect(context.fundamentalScore).toBeLessThan(0);
    expect(context.macroRegime).toBe('HAWKISH');
  });

  it('calculates confluence correctly', () => {
    // Strongly bullish EURUSD context
    const now = new Date('2026-10-06T12:00:00Z');
    const weakUsdEvent = createEvent('3', 'Core CPI m/m', 'USD', 'HIGH', '2026-10-06T10:00:00Z', '2.0', '0.1'); // US data weak -> EURUSD bullish
    const context = engine.evaluateContext('EURUSD', [weakUsdEvent], now);

    expect(context.fundamentalScore).toBeGreaterThan(0);

    const confluenceLong = engine.getConfluence(context, 'LONG');
    expect(['STRONG ALIGNMENT', 'MODERATE ALIGNMENT']).toContain(confluenceLong);

    const confluenceShort = engine.getConfluence(context, 'SHORT');
    expect(confluenceShort).toBe('CONFLICT');
  });

  it('blocks setups (HIGH EVENT RISK) if event is imminent', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const imminentUsdEvent = createEvent('4', 'NFP', 'USD', 'HIGH', '2026-10-06T12:05:00Z'); 
    const context = engine.evaluateContext('GBPUSD', [imminentUsdEvent], now);

    const confluence = engine.getConfluence(context, 'LONG');
    expect(confluence).toBe('HIGH EVENT RISK');
  });
});
