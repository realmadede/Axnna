import fs from 'fs';
import { StrategyEngine } from '../src/core-engine/StrategyEngine';
const htf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_1H.json', 'utf8'));
const ltf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_5M.json', 'utf8'));

console.log("HTF length", htf.length, "start", new Date(htf[0].timestamp));
console.log("LTF length", ltf.length, "start", new Date(ltf[0].timestamp));

const engine = new StrategyEngine({
    swingLengthHTF: 3,
    swingLengthLTF: 5,
    fvgMaxCandlesAge: 10,
    fvgMinimumPips: 2,
    retracementDeep: 0.5,
    retracementShallow: 0.236
});

const res = engine.processCandles(htf, ltf);
console.log("Results length:", res.length);
if (res.length > 0) console.log(res[0]);
