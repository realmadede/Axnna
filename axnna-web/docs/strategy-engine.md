# Axnna V1 Strategy Engine

## Architecture
The engine is a purely functional state machine (`AxnnaV1Engine`) evaluating the frozen `AXNNA_V1_LIQUIDITY_FVG` v4 rules.

## State Machine
The core engine (`src/engine/AxnnaV1Strategy.ts`) processes candles sequentially:
1. Initialize ATR recursively.
2. Synchronize 1H candle closes for HTF Bias.
3. Detect 5M Swings (BSL/SSL).
4. Evaluate Setup Pipeline (Penetration -> Sweep -> Displacement -> FVG -> RR).

## Persistence Model
Since Cloudflare Workers are ephemeral, `strategy_state` table holds `state_payload` JSON. On every cron tick, the Worker deserializes the payload, feeds new canonical candles into the state machine, and serializes the new state.

## Gap Recovery
The engine explicitly chronologically processes arrays of candles. If the cron misses an interval, multiple candles will be fed in chronologically.

## No-Look-Ahead
Strict mathematical arrays prevent lookahead. Swings are only confirmed exactly $N$ periods later (`t - N`).

## Testing
Comprehensive vitest suite covers everything from ATR to Sweep logic.

