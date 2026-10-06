# Fundamental Engine Architecture

The Axnna Fundamental Context Engine evaluates macroeconomic data and provides contextual filtering capabilities to technical setups.

## Data Flow
1. **Cloudflare Cron Worker**: Periodically accesses Finnhub securely and inserts upcoming/historical releases into the `economic_events` D1 cache table.
2. **API Endpoint (`/api/fundamentals/:instrument`)**: Selects the canonical cached events and processes them through the stateless `FundamentalEngine`.
3. **Frontend**: Requests normalized output from the API, never directly hitting Finnhub.

## Core Operations
- **Currency Exposure Mapping**: Automatically determines that USD events affect EURUSD, GBPUSD, etc. Evaluates the Base vs Quote context so that stronger USD is properly assessed as *bearish* for EURUSD.
- **Event Risk Classification**: Returns `NONE`, `LOW`, `ELEVATED`, `HIGH`, or `EXTREME` depending on configurable minute boundaries surrounding `HIGH`/`MEDIUM` impact events.
- **Directional Bias**: Weights indicator surprises (actual vs estimate). It knows that a *higher* Unemployment Rate is dovish, but a *higher* CPI is hawkish.
- **Macro Regime**: Tallies recent indicator surprises to label the environment (e.g., `HAWKISH` or `MIXED`).
- **Confluence**: Cross-references technical direction (`LONG`/`SHORT`) against fundamental score to determine if a setup aligns (`STRONG ALIGNMENT`) or contradicts (`CONFLICT`). High event risk supersedes scoring by enforcing `HIGH EVENT RISK`.

## Environment Variables
- `FINNHUB_API_KEY` (Required, Server-Side Only)

## Testing
Core calculations are fully backed by Vitest (`tests/fundamental.test.ts`), ensuring reliable directional scoring and risk assignment without lookahead bias.
