# Data Ingestion & Strategy State Persistence

## Providers & Automatic Failover

- **Primary Market Data (`TwelveDataMarketProvider`, `src/providers/MarketProvider.ts`):** Fetches `5M` and `1H` candles for `EURUSD`, `GBPUSD`, `USDJPY`, and `XAUUSD`.
  - Missing, empty, or placeholder `TWELVEDATA_API_KEY` values throw on initialization; if no fallback provider is configured, `runSynchronization` marks `market_data_state` as `FAILED` without issuing requests.
  - If TwelveData returns HTTP `429` or an authentication failure during a sync cycle, `sync.ts` short-circuits remaining primary requests for that cycle and switches straight to fallback.
- **Fallback Market Data (`TiingoMarketProvider`, `src/providers/MarketProvider.ts`):** When `TIINGO_API_KEY` is configured, automatically supplies validated FX/metals OHLCV candles whenever TwelveData fails or hits rate/auth limits, bounding lookbacks to preserve Starter tier limits (`50/hr`, `1,000/day`, `1 GB/mo`).
- **Validation (`MarketDataValidator.validateAndNormalize`, `src/core-engine/MarketData.ts`):** Rejects impossible OHLC bars, deduplicates timestamps, drops unclosed forming candles (`isCompleted: false`), and sorts chronologically in UTC.
- **Economic Calendar (`FreeEconomicCalendarProvider`, `src/providers/FundamentalProvider.ts`):** Fetches keyless macro events (`USD,EUR,GBP,JPY`) from `biquote.io` with automatic fallback to FairEconomy's weekly calendar feed, normalizing into `economic_events`.

## Scheduled Request Budgeting

- `CRON_SYNC` (`*/15 * * * *`, `mode: '5M_AND_STRATEGY'`):
  - Refreshes calendar only when `ECONOMIC_CALENDAR` in `provider_health_state` is stale (`>= 25m`).
  - Fetches `5M` bars (`4 pairs * 4/hr * 24 = 384` req/24h on active weekdays) and skips `1H` if cached `1H` candles are `HEALTHY` and `< 2h` old.
- `CRON_1H_SYNC` (`2 * * * *`, `mode: '1H_ONLY'`):
  - Fetches `1H` bars once per hour (`4 * 24 = 96` req/24h on active weekdays).
- **Weekend Skip (`isFxMarketClosedUtc`):** When FX markets are closed (Fri 22:00 UTC to Sun 22:00 UTC) and cached post-close bars exist in D1, upstream fetches are skipped without marking providers degraded.
- **Active Weekday Total:** Maximum `480` TwelveData calls/24h across both crons (comfortably inside TwelveData's `800/day` and `8/min` free-tier limits).

## Strategy-State Persistence & Paper Evaluation

- **Concurrent Locking (`sync_leases`):** `acquireSyncLease` / `releaseSyncLease` hold a 10-minute D1 lease so overlapping ticks return `ALREADY_RUNNING`.
- **Delta Inserts:** Existing candle timestamps are checked so only genuinely new completed candles run through chunked `INSERT OR IGNORE` D1 batches (`50` statements/chunk).
- **Pre-Strategy Paper Trade Evaluation:** When `5M` ingestion succeeds for an instrument, `evaluateOpenPaperTrades` processes newly closed `5M` candles before `runStrategyEngine`, checking `>15m` entry expiration, strict chronological non-lookahead ordering, calibrated spread/slippage/commission costs (`getInstrumentCosts`), and conservative stop-first tie-breaking.
- **Incremental `StrategyEngine` State (`strategy_state`):** Restores per-instrument `PersistedStrategyState` (`schemaVersion`, `strategyVersion`, `lastProcessed5mTimestamp`, `currentHtfBias`, `activeBsl`, `activeSsl`, `activeCandidate`, `atr`, `trueRanges`, `recentLtfCandles`). Missing, malformed, or version-mismatched state triggers `STRATEGY_STATE_RESET` and rebuilds from D1 candles (`300 x 5M`, `200 x 1H`).

## Telemetry, Retention & Offline Fixtures

- `provider_health_state` and `scheduled_job_runs` record UTC-normalized outcomes (`parseUtcTimestampMs`).
- `pruneOperationalTables` clears rows beyond `90d` operational / `180d` resolved / `365d` unresolved security / `2d` rate-limit windows at 21:00 UTC while keeping `audit_events` permanently.
- Local D1 `market_candles` starts empty (`0` rows). JSON fixtures in `axnna-web/scripts/.cache/` (`EURUSD` / `USDJPY`) are offline test/research fixtures only.
