import { TwelveDataMarketProvider } from '../src/providers/MarketProvider';

async function test() {
    try {
        const url = 'https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=5min&outputsize=5000&apikey=demo&end_date=2026-09-20 00:00:00';
        const res = await fetch(url);
        const data = await res.json();
        if (data.values && data.values.length > 0) {
            console.log("First:", data.values[0].datetime);
            console.log("Last:", data.values[data.values.length - 1].datetime);
        }
    } catch (e: any) {
        console.log(e.message);
    }
}
test();
