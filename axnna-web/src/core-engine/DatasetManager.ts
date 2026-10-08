import { InternalCandle } from './MarketData';

export interface DatasetQualityReport {
    symbol: string;
    htfRange: { start: string, end: string, count: number };
    ltfRange: { start: string, end: string, count: number };
    warmUpRange: { start: string, end: string };
    evaluationRange: { start: string, end: string };
    expectedLtfIntervals: number;
    actualLtfIntervals: number;
    missingLtfIntervals: number;
    weekendGaps: number;
    suspiciousGaps: number;
    duplicateTimestamps: number;
    outOfOrderTimestamps: number;
    datasetHash: string;
}

export interface AlignedDataset {
    htfWarmup: InternalCandle[];
    htfEvaluation: InternalCandle[];
    ltfEvaluation: InternalCandle[];
    quality: DatasetQualityReport;
}

export class DatasetManager {
    static prepareDataset(htf: InternalCandle[], ltf: InternalCandle[], symbol: string): AlignedDataset {
        const htfSorted = [...htf].sort((a, b) => a.timestamp - b.timestamp);
        const ltfSorted = [...ltf].sort((a, b) => a.timestamp - b.timestamp);

        let duplicateTimestamps = 0;
        let outOfOrderTimestamps = 0;

        // Check HTF
        for (let i = 1; i < htf.length; i++) {
            if (htf[i].timestamp === htf[i-1].timestamp) duplicateTimestamps++;
            if (htf[i].timestamp < htf[i-1].timestamp) outOfOrderTimestamps++;
        }
        // Check LTF
        let weekendGaps = 0;
        let suspiciousGaps = 0;
        const ltfMs = 5 * 60 * 1000;
        for (let i = 1; i < ltf.length; i++) {
            if (ltf[i].timestamp === ltf[i-1].timestamp) duplicateTimestamps++;
            if (ltf[i].timestamp < ltf[i-1].timestamp) outOfOrderTimestamps++;

            const diff = ltfSorted[i].timestamp - ltfSorted[i-1].timestamp;
            if (diff > ltfMs) {
                // Check if weekend gap
                const prevDate = new Date(ltfSorted[i-1].timestamp);
                const currDate = new Date(ltfSorted[i].timestamp);
                if (prevDate.getUTCDay() === 5 && currDate.getUTCDay() === 0) {
                   // Friday to Sunday
                   weekendGaps++;
                } else {
                   suspiciousGaps++;
                }
            }
        }

        const ltfStart = ltfSorted[0].timestamp;
        const ltfEnd = ltfSorted[ltfSorted.length - 1].timestamp;
        const htfStart = htfSorted[0].timestamp;
        const htfEnd = htfSorted[htfSorted.length - 1].timestamp;

        // Common evaluation interval is the overlap
        const evalStart = Math.max(ltfStart, htfStart);
        const evalEnd = Math.min(ltfEnd, htfEnd);

        const htfWarmup = htfSorted.filter(c => c.timestamp < evalStart);
        const htfEvaluation = htfSorted.filter(c => c.timestamp >= evalStart && c.timestamp <= evalEnd);
        const ltfEvaluation = ltfSorted.filter(c => c.timestamp >= evalStart && c.timestamp <= evalEnd);

        // Gap calculations
        let expectedLtfIntervals = 0;
        if (ltfEvaluation.length > 0) {
            expectedLtfIntervals = Math.floor((evalEnd - evalStart) / ltfMs) + 1;
        }

        const hashInput = JSON.stringify({
            symbol,
            evalStart,
            evalEnd,
            htfCount: htfEvaluation.length,
            ltfCount: ltfEvaluation.length
        });
        
        let hash = 0;
        for (let i = 0; i < hashInput.length; i++) {
            const char = hashInput.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        const datasetHash = Math.abs(hash).toString(16).padStart(8, '0');

        const quality: DatasetQualityReport = {
            symbol,
            htfRange: { start: new Date(htfStart).toISOString(), end: new Date(htfEnd).toISOString(), count: htfSorted.length },
            ltfRange: { start: new Date(ltfStart).toISOString(), end: new Date(ltfEnd).toISOString(), count: ltfSorted.length },
            warmUpRange: { start: new Date(htfStart).toISOString(), end: new Date(evalStart).toISOString() },
            evaluationRange: { start: new Date(evalStart).toISOString(), end: new Date(evalEnd).toISOString() },
            expectedLtfIntervals,
            actualLtfIntervals: ltfEvaluation.length,
            missingLtfIntervals: expectedLtfIntervals - ltfEvaluation.length,
            weekendGaps,
            suspiciousGaps,
            duplicateTimestamps,
            outOfOrderTimestamps,
            datasetHash
        };

        return {
            htfWarmup,
            htfEvaluation,
            ltfEvaluation,
            quality
        };
    }
}
