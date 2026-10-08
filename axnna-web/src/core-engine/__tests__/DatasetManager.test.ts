import { describe, it, expect } from 'vitest';
import { DatasetManager } from '../DatasetManager';
import { InternalCandle } from '../MarketData';

describe('DatasetManager', () => {
    it('aligns datasets and calculates common evaluation range', () => {
        const ltfMs = 5 * 60 * 1000;
        const htfMs = 60 * 60 * 1000;
        
        const htf: InternalCandle[] = [];
        const ltf: InternalCandle[] = [];
        
        // HTF starts at 0, goes to 20 hours
        for (let i = 0; i <= 20; i++) {
            htf.push({
                symbol: 'TEST',
                timeframe: '1H',
                timestamp: i * htfMs,
                open: 1, high: 2, low: 0.5, close: 1.5,
                isCompleted: true,
                priceBasis: 'provider_ohlc_unspecified'
            });
        }
        
        // LTF starts at 10 hours, goes to 20 hours
        for (let i = 0; i <= (10 * 60) / 5; i++) {
            ltf.push({
                symbol: 'TEST',
                timeframe: '5M',
                timestamp: (10 * htfMs) + (i * ltfMs),
                open: 1, high: 2, low: 0.5, close: 1.5,
                isCompleted: true,
                priceBasis: 'provider_ohlc_unspecified'
            });
        }
        
        const aligned = DatasetManager.prepareDataset(htf, ltf, 'TEST');
        
        expect(aligned.htfWarmup.length).toBeGreaterThan(0);
        expect(aligned.htfWarmup[0].timestamp).toBe(0);
        
        expect(aligned.quality.evaluationRange.start).toBe(new Date(10 * htfMs).toISOString());
        expect(aligned.quality.evaluationRange.end).toBe(new Date(20 * htfMs).toISOString());
        
        expect(aligned.quality.missingLtfIntervals).toBe(0);
    });

    it('detects missing intervals', () => {
        const ltfMs = 5 * 60 * 1000;
        const ltf: InternalCandle[] = [
            { symbol: 'TEST', timeframe: '5M', timestamp: 0, open: 1, high: 2, low: 0.5, close: 1.5, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' },
            { symbol: 'TEST', timeframe: '5M', timestamp: ltfMs * 2, open: 1, high: 2, low: 0.5, close: 1.5, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' } // Skipped index 1
        ];
        
        const aligned = DatasetManager.prepareDataset(ltf, ltf, 'TEST'); // Pass LTF as HTF just to test LTF gaps
        expect(aligned.quality.missingLtfIntervals).toBe(1);
        expect(aligned.quality.suspiciousGaps).toBe(1);
    });

    it('generates consistent hashes for identical datasets', () => {
        const ltf: InternalCandle[] = [
            { symbol: 'TEST', timeframe: '5M', timestamp: 0, open: 1, high: 2, low: 0.5, close: 1.5, isCompleted: true, priceBasis: 'provider_ohlc_unspecified' }
        ];
        const res1 = DatasetManager.prepareDataset(ltf, ltf, 'TEST');
        const res2 = DatasetManager.prepareDataset(ltf, ltf, 'TEST');
        
        expect(res1.quality.datasetHash).toBe(res2.quality.datasetHash);
        expect(res1.quality.datasetHash).toMatch(/^[a-f0-9]{8}$/);
    });
});
