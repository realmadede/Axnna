# Fundamental Architecture

Axnna isolates technical `StrategyEngine` rules from macroeconomic analysis (`FundamentalEngine`) to preserve deterministic signal logic and clean auditability.

## Domain Boundaries

1. **Macro Currencies:** `USD`, `EUR`, `GBP`, `JPY` mapped across `EURUSD`, `GBPUSD`, `USDJPY`, and `XAUUSD`.
2. **Economic Events (`economic_events`):** Scheduled and released macro indicators fetched centrally by `FreeEconomicCalendarProvider`.
3. **Context vs Technical Rules:** Technical setup detection, scoring (`>= 65`), and SL/TP geometry run strictly on price structure (`1H` + `5M` candles). `FundamentalEngine` evaluates macro context and proximity risk afterward; `RiskGate` (`src/engine/RiskGate.ts`) then decides fail-closed whether an eligible setup can be alerted or paper-traded.

## Cost Control & Caching

Because macroeconomic releases update on a coarse schedule relative to `5M` price bars, ingestion executes centrally on Worker cron syncs when calendar state is `>= 25m` stale and stores normalized events in D1 `economic_events`. Both `GET /api/fundamentals/:instrument` and `/status` commands query Axnna's D1 cache rather than triggering per-visitor upstream requests.
