import fs from 'fs';
import { StrategyEngine } from '../src/core-engine/StrategyEngine';
const htf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_1H.json', 'utf8'));
const engine = new StrategyEngine({
    swingLengthHTF: 3,
    swingLengthLTF: 5,
    fvgMaxCandlesAge: 10,
    fvgMinimumPips: 2,
    retracementDeep: 0.5,
    retracementShallow: 0.236
});
// @ts-ignore
for (const c of htf) {
   engine['processHtfCandle'](c);
}
console.log("HTF Bias:", engine['htfBias']);
