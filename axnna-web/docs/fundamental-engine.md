# Fundamental Engine Architecture

`FundamentalEngine` (`src/engine/FundamentalEngine.ts`) evaluates macroeconomic releases and event proximity windows without altering raw price structure detection.

## Data Flow

1. **Scheduled Sync (`src/worker/sync.ts`):** `FreeEconomicCalendarProvider` periodically refreshes `USD,EUR,GBP,JPY` macro releases (`biquote.io` primary + FairEconomy weekly feed fallback) into D1 `economic_events`.
2. **Health Check (`src/worker/fundamentals.ts`):** Queries `provider_health_state` (`ECONOMIC_CALENDAR`) so stale (`> 2h`) or failing calendar feeds resolve fail-closed to `'UNKNOWN'` / `'FUNDAMENTAL UNAVAILABLE'`.
3. **Stateless Context Evaluation:** `FundamentalEngine.evaluateContext` normalizes events relative to the target instrument and timestamp.
4. **Public Endpoint (`GET /api/fundamentals/:instrument`):** Returns evaluated context from D1 cache for validated instruments (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`).

## Core Operations

- **Currency Exposure Mapping:** Evaluates base vs quote exposure (for example, hawkish `USD` surprises weigh bearish on `EURUSD` / `GBPUSD` / `XAUUSD` and bullish on `USDJPY`).
- **Event Risk Classification:** Classifies surrounding `HIGH`/`MEDIUM` releases into `NONE`, `LOW`, `ELEVATED`, `HIGH`, `EXTREME`, or `UNKNOWN`.
- **Indicator Sign Normalization:** Recognizes inverted vs direct releases (higher Unemployment Rate is dovish; higher CPI/NFP is hawkish).
- **Macro Regime & Confluence:** Tallies recent indicator surprises (`HAWKISH`, `DOVISH`, `MIXED`) and combines technical direction (`LONG`/`SHORT`) with fundamental bias, yielding alignment or `HIGH EVENT RISK` / `FUNDAMENTAL UNAVAILABLE` warnings checked by `RiskGate`.

## Environment Notes

- `FreeEconomicCalendarProvider` operates keylessly (no paid calendar key required).

## Testing

Unit tests in `tests/` (`fundamental.test.ts` and RiskGate tests) verify directional scoring, event proximity windows, fail-closed `UNKNOWN` handling, and zero lookahead bias.
