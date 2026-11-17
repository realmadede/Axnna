# Data Ingestion & Strategy State Persistence

## Providers & Fail-Closed Behavior

* **Market Data (`TwelveDataMarketProvider`):** Fetches `5M` and `1H` candles for `EURUSD`, `GBPUSD`, `USDJPY`, and `XAUUSD`.
  * Missing, empty, or placeholder `TWELVEDATA_API_KEY` values fail closed immediately (`TwelveDataMarketProvider` throws and `runSynchronization` marks `market_data_state` as `FAILED` without issuing HTTP requests or altering `last_completed_candle` / `last_successful_fetch`).
  * `MarketDataValidator.validateAndNormalize` rejects invalid/impossible OHLC data, detects duplicate timestamps, removes forming (`isCompleted: false`) candles, and sorts chronologically in UTC.
* **Economic Calendar (`FreeEconomicCalendarProvider`):** Fetches keyless macro events from `biquote.io` (`US,EU,GB,JP`) with automatic fallback to FairEconomy's weekly calendar feed, normalizing into `economic_events`.

## Strategy-State Persistence & Recovery

* `runStrategyEngine` restores per-instrument state (`schemaVersion`, `strategyVersion`, `lastProcessed5mTimestamp`, `currentHtfBias`, `activeBsl`, `activeSsl`, `activeCandidate`, `atr`, `trueRanges`, and a bounded tail of completed `recentLtfCandles`) from D1 `strategy_state`.
* Only newly completed `5M` candles strictly newer than `lastProcessed5mTimestamp` are processed via `StrategyEngine.processIncremental`, preserving active setups across Worker restarts and rolling query windows without duplicating setups.
* If persisted state is missing, malformed, or has a mismatched `strategyVersion` or `schemaVersion`, the engine logs `STRATEGY_STATE_RESET` and rebuilds deterministically from the latest D1 candle window (`300 x 5M`, `200 x 1H`).

## Operational Observability & Remaining Limits

* **Concurrent Sync Locking (`sync_leases`):** Both `CRON_SYNC` and `MANUAL_SYNC` acquire an atomic 10-minute D1 lease (`acquireSyncLease` / `releaseSyncLease`) so concurrent runs return `ALREADY_RUNNING` (`409` on manual sync) rather than corrupting `strategy_state` or duplicating TwelveData API calls.
* **Provider Health & Freshness (`provider_health_state` + `time.ts`):** Both `FreeEconomicCalendarProvider` (`ECONOMIC_CALENDAR`) and `TwelveDataMarketProvider` (`MARKET_DATA`) update `provider_health_state` (`HEALTHY`, `DEGRADED`, `FAILED`), using UTC-normalized parsing (`parseUtcTimestampMs`) so SQLite `CURRENT_TIMESTAMP` strings work identically across all host timezones.
* **Scheduled Job History & Retention:** Every sync and daily recap logs execution duration and status (`SUCCEEDED`, `DEGRADED`, `FAILED`, or orphaned `STARTED` detection), while `pruneOperationalTables` deletes expired rows beyond 90–180/365d retention windows in bounded batches.
* Historical `BacktestEngine` runs remain synchronous over `POST /api/dev/backtest` with `limit` bounded to `100..400` (`1H` bars, `1200..4800` `5M` bars) using calibrated instrument pip defaults (`getInstrumentCosts`) and optional validated pip overrides (`0..50`).
* **Batched Candle Persistence & Request Budgeting:** Market candle upserts run via chunked `env.DB.batch(...)` (`50` statements/chunk). `5M` feeds poll every 5-minute cycle, while `1H` feeds skip redundant mid-hour fetches once the current completed `1H` candle is persisted and `HEALTHY` (~`52` calls/hour vs `96`/hour; `~900–960` active FX trading-hour calls/day / `~1,248` 24h max, requiring a paid TwelveData tier above `800`/day free quota).
* **Paper Trading Pre-Strategy Evaluation:** During `runSynchronization`, when `5M` ingestion succeeds for an instrument, `evaluateOpenPaperTrades` runs against newly fetched completed `5M` candles prior to `runStrategyEngine`, checking `>15m` expiry before fill/invalidation, enforcing strict no-lookahead ordering (`candle.timestamp > last_evaluated_candle_timestamp` and `> signal_timestamp`), conservative spread/slippage/commission deductions via `getInstrumentCosts`, and stop-first tie-breaking.
* **Calendar Availability & Retention:** Economic calendar availability checks `provider_health_state` (`status = 'HEALTHY'` within 2h freshness) rather than counting historical `economic_events` rows, while `pruneOperationalTables` removes obsolete `economic_events` older than `90d`.
* **Local Historical Dataset Scope:** Local Wrangler D1 `market_candles` contains `0` rows by default. Cached JSON fixtures under `axnna-web/scripts/.cache/` (`EURUSD_1H*.json`, `EURUSD_5M*.json`, `USDJPY_1H*.json`, `USDJPY_5M*.json`, with `GBPUSD` and `XAUUSD` absent from `.cache/`) are research/offline fixtures only and must not be treated as a full multi-year 4-pair statistical validation sample without live D1 accumulation across all four pairs.
