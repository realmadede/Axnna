# Strategy Architecture

Axnna operates on a **Multi-Strategy Architecture**. The application does NOT hardcode a single strategy into the core codebase.

## The Strategy Registry
Every formally defined strategy (e.g., `AXNNA_V1_LIQUIDITY_FVG`) is registered in the database via the `strategies` and `strategy_versions` tables.
- A strategy must have an explicit version.
- Only explicitly `ACTIVE` strategies participate in signal generation.

## Signal Independence
Each strategy receives the same Canonical Market Data layer (e.g., EURUSD 5M). 
If two strategies are evaluated:
```text
Canonical Data -> Strategy A -> Signal 101
Canonical Data -> Strategy B -> Signal 102
```
There is **NO** automatic confluence. The system does not average signals or attempt to resolve contradictions. Every signal is firmly traceable to the specific strategy ID and version that generated it.

## The Mock Strategy
For frontend and pipeline testing, a deterministic mock strategy is implemented. It exists solely to test the `Strategy -> Signal Store -> Notification Delivery` flow and must never be enabled in production.
