# Axnna V1 Strategy Engine

## Architecture

`StrategyEngine` (`src/core-engine/StrategyEngine.ts`) is a deterministic, stateful/incremental state machine evaluating the frozen `AXNNA_V1_LIQUIDITY_FVG` rules (`ScoringModel.ts` + `MarketData.ts` + `core-engine/Types.ts`).

## State Machine (`processIncremental`)

For each instrument (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`), `StrategyEngine` processes newly closed `5M` candles sequentially against `1H` macro context:

1. **ATR & Range Tracking:** Updates smoothed True Range / ATR state deterministically.
2. **HTF Bias (`1H`):** Synchronizes completed `1H` structure to establish higher-timeframe directional bias.
3. **LTF Swing Confirmation (`5M`):** Identifies confirmed Buy-Side Liquidity (BSL) and Sell-Side Liquidity (SSL) levels strictly without lookahead (`t - N` confirmation).
4. **Setup Pipeline:** Evaluates liquidity penetration and sweep -> displacement impulse -> Fair Value Gap (FVG) zone -> retracement entry, structural Stop Loss / Take Profit, Risk:Reward geometry, and weighted technical score (`ScoringModel`, passing at `>= 65`).

## Persistence & Gap Recovery

- On each Worker sync tick (`src/worker/sync.ts`), `runStrategyEngine` restores `PersistedStrategyState` from D1 `strategy_state`, processes only completed `5M` bars strictly newer than `lastProcessed5mTimestamp`, and writes the updated payload back to D1.
- Missing or incompatible state triggers `STRATEGY_STATE_RESET` and reconstructs cleanly from the stored `1H` (`200`) + `5M` (`300`) candle window.

## Testing

Determinism, zero-lookahead swing confirmation, scoring weights, and incremental vs full-run parity are verified under Vitest (`src/core-engine/__tests__/` and `tests/`).
