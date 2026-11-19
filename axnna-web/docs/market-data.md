# Market Data Abstraction

Axnna decouples external market data vendors from `StrategyEngine`, `PaperTradingEngine`, and `BacktestEngine` through a normalized candle contract.

## Canonical Scope

- **Supported Instruments (`SUPPORTED_INSTRUMENTS`):** `EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`.
- **Supported Timeframes (`SUPPORTED_TIMEFRAMES`):** `5M`, `1H`.
- **Normalized Interface (`IMarketDataProvider` & `InternalCandle` in `src/core-engine/MarketData.ts`):** Every provider returns UTC-millisecond OHLCV bars tagged with `symbol`, `timeframe`, and `isCompleted` completeness flags.

## Active Provider Implementations (`src/providers/MarketProvider.ts`)

1. **`TwelveDataMarketProvider` (Primary):**
   - Uses `TWELVEDATA_API_KEY` (fails closed on missing or placeholder keys).
   - Maps internal symbols (`EUR/USD`, `GBP/USD`, `USD/JPY`, `XAU/USD`), converts exchange timestamps to UTC epoch milliseconds, filters unclosed forming candles, and supports chunked historical ranges for backtests.
2. **`TiingoMarketProvider` (Automatic Fallback):**
   - Uses `TIINGO_API_KEY` when configured.
   - Automatically invoked per instrument/timeframe if `TwelveDataMarketProvider` errors, fails validation, or hits `429`/auth limits (at which point TwelveData is short-circuited for the remainder of that sync cycle).
   - Bounds lookback windows to respect Tiingo free Starter bandwidth (`1 GB/mo`) and rate ceilings (`50/hr`, `1,000/day`).

## Validation & State Tracking

- Every fetched series passes through `MarketDataValidator.validateAndNormalize` before hitting D1 `market_candles`.
- `market_data_state` tracks per `(instrument, timeframe)` health (`last_completed_candle`, `last_successful_fetch`, `source_provider`, `status`: `HEALTHY`, `DEGRADED`, `FAILED`).
- `provider_health_state` (`MARKET_DATA`) records subsystem-level recovery and failure counts evaluated by `/api/status` and `evaluateRiskGate`.
