# Market Data Abstraction

Axnna separates raw market data ingestion from analytical strategy execution.

## The Canonical Layer
Strategies rely exclusively on normalized, provider-agnostic data structures. 
- **Initial Instruments**: EURUSD, GBPUSD, USDJPY, XAUUSD.
- **Initial Timeframes**: 5M, 1H.

## Provider Adapters
External providers (FCS API, Twelve Data) are wrapped in adapter modules. These adapters handle:
- API authentication
- Symbol mapping (e.g., matching external `EUR/USD` to internal `EURUSD`)
- Timezone/Timestamp normalization to UTC
- Rate limiting and error parsing

## State Tracking
The `market_data_state` database table tracks the health of the incoming data pipeline:
- `last_completed_candle`
- `last_successful_fetch`
- `status` (`HEALTHY`, `DEGRADED`, `FAILED`)

This allows administrators to instantly diagnose whether signal delays are caused by strategy logic or upstream data provider failures.
