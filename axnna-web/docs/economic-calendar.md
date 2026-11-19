# Economic Calendar Integration

Axnna tracks scheduled macroeconomic releases to identify high-risk event windows before alerts are approved.

## Keyless Provider Design (`FreeEconomicCalendarProvider`)

Macro event ingestion (`src/providers/FundamentalProvider.ts`) implements the `FundamentalDataProvider` contract without requiring paid calendar API keys:

1. **Primary feed:** `biquote.io` calendar endpoint filtered to `US,EU,GB,JP` currencies.
2. **Automatic fallback:** FairEconomy weekly JSON calendar feed (`nfs.faireconomy.media`) filtered cleanly to `USD,EUR,GBP,JPY`.
3. **Sync frequency (`src/worker/sync.ts`):** Refreshed on `CRON_SYNC` (`*/15 * * * *`) whenever `ECONOMIC_CALENDAR` in `provider_health_state` is absent, unhealthy, or older than `25` minutes, writing changed actual/estimate updates into `economic_events`.

## Currency Exposure Mapping & Event Risk

- `USD` events expose `EURUSD`, `GBPUSD`, `USDJPY`, and `XAUUSD`.
- `EUR` events expose `EURUSD`.
- `GBP` events expose `GBPUSD`.
- `JPY` events expose `USDJPY`.

`FundamentalEngine` classifies proximity around `HIGH`/`MEDIUM` releases into `NONE`, `LOW`, `ELEVATED`, `HIGH`, `EXTREME`, or `UNKNOWN` (fail-closed if calendar sync is unhealthy or stale beyond 2 hours).

## Event Surprise Normalization

Indicator definitions (`GDP`, `CPI`, `NFP`, `RATE`, `UNEMP`, `PMI`, etc.) retain native `Actual`, `Estimate`, and `Previous` values in `economic_events` and normalize surprise direction per indicator sign convention so hawkish vs dovish surprises map accurately without leaking upstream JSON structures into the core strategy engine.
