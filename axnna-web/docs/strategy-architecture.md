# Strategy Architecture

Axnna operates on a versioned strategy architecture decoupled from external providers, Risk Gate enforcement, and paper/alert delivery modules.

## Strategy Registry & Versioning

- Every active rule set is registered in D1 (`strategies` and `strategy_versions`, seeded with `AXNNA_V1_LIQUIDITY_FVG`), pairing a deterministic rule implementation with explicit `strategyVersion` and `schemaVersion` checks inside `strategy_state`.
- State mismatches or schema bumps trigger a deterministic rebuild from the D1 `market_candles` history window (`STRATEGY_STATE_RESET`).

## Signal & Risk Separation

- **Candidate Detection (`StrategyEngine`):** Consumes normalized `1H` and `5M` `InternalCandle` feeds (`MarketDataValidator`) to score setups (`>= 65` threshold) without reading calendar or Telegram tables.
- **Fail-Closed Gate (`RiskGate.ts`):** Independently validates data freshness, session timing, structural geometry, duplicate signal suppression, and `FundamentalEngine` event risk before committing `'APPROVED'` / `'REJECTED'` to `risk_decisions` and `audit_events`.
- **Simulated Track Record (`PaperTradingEngine.ts`):** Every `RiskGate`-approved signal spawns one `SIMULATION_ONLY` paper trade tracked conservatively on subsequent completed `5M` bars and exposed read-only via `GET /api/performance` and `/strategies`.
