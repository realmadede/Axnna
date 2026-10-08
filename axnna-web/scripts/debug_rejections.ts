import fs from 'fs';
import { StrategyEngine } from '../src/core-engine/StrategyEngine';
const htf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_1H.json', 'utf8'));
const ltf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_5M.json', 'utf8'));

const engine = new StrategyEngine({
        htfTimeframe: '1H',
        ltfTimeframe: '5M',
        swingLengthHTF: 3,
        swingLengthLTF: 5,
        atrLength: 14,
        displacementSizeMultiplier: 1.5,
        displacementBodyRatio: 0.5,
        displacementCloseLocation: 0.5,
        fvgMinAtrRatio: 0.1,
        alertScoreThreshold: 65,
});

const res = engine.processCandles(htf, ltf);
const rejections = res.filter(r => r.status === 'REJECTED');
const alerts = res.filter(r => r.status === 'ALERT_ELIGIBLE');

console.log("Total Setups Processed:", res.length);
console.log("Rejections:", rejections.length);
console.log("Alerts:", alerts.length);

