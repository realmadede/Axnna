import fs from 'fs';
import { StrategyEngine } from '../src/core-engine/StrategyEngine';
const htf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_1H.json', 'utf8'));
const ltf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_5M.json', 'utf8'));

const engine = new StrategyEngine({
    swingLengthHTF: 3,
    swingLengthLTF: 5,
    fvgMaxCandlesAge: 10,
    fvgMinimumPips: 2,
    retracementDeep: 0.5,
    retracementShallow: 0.236
});

let state = 'unknown';
// @ts-ignore
engine.originalProcess = engine.processCandles;
// @ts-ignore
engine.processCandles = function(h, l) {
    if (h.length < 7) { state = 'no_htf'; return []; }
    if (l.length < 11) { state = 'no_ltf'; return []; }
    return this.originalProcess(h, l);
}

const availableHTF = htf.filter(c => c.timestamp <= ltf[1000].timestamp);
const availableLTF = ltf.slice(0, 1000);
engine.processCandles(availableHTF, availableLTF);
console.log("State:", engine.htfBias, engine.activeBsl, engine.activeSsl);
