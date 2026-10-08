import fs from 'fs';
import path from 'path';
import { BacktestEngine } from '../src/core-engine/BacktestEngine';
import { StrategyConfig } from '../src/core-engine/Types';
import { TwelveDataMarketProvider } from '../src/providers/MarketProvider';
import { DatasetManager } from '../src/core-engine/DatasetManager';
const envPath = path.join(process.cwd(), '.dev.vars');
if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
        const [key, ...rest] = line.split('=');
        if (key && rest.length > 0) {
            process.env[key.trim()] = rest.join('=').replace(/^["']|["']$/g, '').trim();
        }
    }
}

let API_KEY = process.env.TWELVEDATA_API_KEY || 'demo';
if (API_KEY === 'THE_NEW_KEY') API_KEY = 'demo'; // Fallback to demo if user hasn't provided a real key, though demo limits might apply.

const provider = new TwelveDataMarketProvider(API_KEY);
const CACHE_DIR = path.join(process.cwd(), 'scripts', '.cache');

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function fetchAndCache(symbol: string, interval: string, limit: number) {
    const safeSymbol = symbol.replace('/', '');
    const cacheFile = path.join(CACHE_DIR, `${safeSymbol}_${interval}_V2.json`);
    
    if (fs.existsSync(cacheFile)) {
        console.log(`Using cached data for ${symbol} ${interval}`);
        return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    }

    console.log(`Fetching ${symbol} ${interval} (${limit} candles)...`);
    try {
        const data = await provider.fetchCandlesChunked(symbol, interval, limit);
        fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
        return data;
    } catch (e: any) {
        console.log(`Failed to fetch ${symbol} ${interval}: ${e.message}`);
        return null;
    }
}

const SYMBOLS = ['EURUSD', 'USDJPY'];
const LIMIT_1H = 5000;
const LIMIT_5M = 15000;

async function main() {
    const report: any = {
        limitations: [],
        datasets: [],
        instruments: {}
    };

    const strategyConfig: StrategyConfig = {
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
        fvgMaxCandlesAge: 10,
        fvgMinimumPips: 2,
        retracementDeep: 0.5,
        retracementShallow: 0.236
    } as any;

    for (const symbol of SYMBOLS) {
        console.log(`\n=== Processing ${symbol} ===`);
        const htf = await fetchAndCache(symbol, '1H', LIMIT_1H);
        const ltf = await fetchAndCache(symbol, '5M', LIMIT_5M);

        if (!htf || !ltf || htf.length === 0 || ltf.length === 0) {
            report.limitations.push(`Could not fetch data for ${symbol}. Likely API key restriction.`);
            report.instruments[symbol] = { status: 'FAILED_DATA_FETCH' };
            continue;
        }

        const aligned = DatasetManager.prepareDataset(htf, ltf, symbol);
        report.datasets.push(aligned.quality);

        const datasetFile = path.join(CACHE_DIR, `frozen_${aligned.quality.datasetHash}.json`);
        fs.writeFileSync(datasetFile, JSON.stringify(aligned, null, 2));

        report.instruments[symbol] = {};
        for (const costScenario of ['LOWER_COST', 'BASELINE', 'HIGHER_COST']) {
            const backtestEngine = new BacktestEngine({
                initialCapital: 10000,
                riskPerTradePercent: 1,
                symbol,
                strategyConfig,
                costScenario
            });

            const res = backtestEngine.run(
                [...aligned.htfWarmup, ...aligned.htfEvaluation], 
                aligned.ltfEvaluation
            );
            report.instruments[symbol][costScenario] = res;
        }
    }

    fs.writeFileSync(path.join(process.cwd(), 'scripts', 'experiment_results.json'), JSON.stringify(report, null, 2));
    console.log("Experiment finished. Results saved.");
}

main().catch(console.error);
