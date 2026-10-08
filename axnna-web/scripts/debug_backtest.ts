import fs from 'fs';
import { BacktestEngine } from '../src/core-engine/BacktestEngine';
const htf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_1H.json', 'utf8'));
const ltf = JSON.parse(fs.readFileSync('scripts/.cache/EURUSD_5M.json', 'utf8'));

const engine = new BacktestEngine({
    initialCapital: 10000,
    riskPerTradePercent: 1,
    symbol: 'EUR/USD',
    strategyConfig: {
        swingLengthHTF: 3,
        swingLengthLTF: 5,
        fvgMaxCandlesAge: 10,
        fvgMinimumPips: 2,
        retracementDeep: 0.5,
        retracementShallow: 0.236
    }
});

const res = engine.run(htf, ltf);
console.log("Total Setups:", res.totalSetups, "Executed:", res.executedTrades);
