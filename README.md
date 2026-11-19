# Axnna

Axnna is an automated market structure analysis and Telegram signal intelligence platform focused on intraday liquidity sweeps, displacement, fair value gaps, macroeconomic event risk gating, and conservative simulated forward tracking.

## Monitored Instruments

- `EURUSD` (`5M` / `1H`)
- `GBPUSD` (`5M` / `1H`)
- `USDJPY` (`5M` / `1H`)
- `XAUUSD` (`5M` / `1H`)

## Core Architecture

- **Frontend (`/axnna-web/src`):** React 18, TypeScript, Vite SPA bundled into `./dist` and served by the unified Cloudflare Worker via the `ASSETS` binding (`run_worker_first = true`). Pure CSS design system (`src/index.css`) with dark obsidian (`#080b10`) and light slate (`#f5f7fa`) themes, shared `<SetupDiagram />` SVG visuals, Sweep-to-Signal Pulse logo and favicons, collapsible FAQ accordions, and responsive mobile drawer navigation.
  - Public routes: `/`, `/about`, `/strategies` (`/methodology` redirects to `/strategies`), `/faq`, `/status`, `/contact`, `/connect-telegram`, `/legal/:page` (`privacy`, `terms`, `risk`, `cookies`).
- **Modular Cloudflare Worker (`axnna-web/src/worker.ts` & `src/worker/*`):**
  - `src/worker.ts` routes API requests, serves SPA static assets, and handles three scheduled cron triggers (`*/15 * * * *`, `2 * * * *`, `0 21 * * *`).
  - `src/worker/http.ts`: Origin allowlist CORS handling, bounded JSON body parsing, `/api/status`, `/api/performance` (read-only aggregate paper trading track record), and bearer-authenticated `/api/dev/backtest`.
  - `src/worker/sync.ts`: D1-leased (`sync_leases`) market data synchronization (`TwelveDataMarketProvider` primary with automatic `TiingoMarketProvider` fallback), keyless economic calendar sync (`FreeEconomicCalendarProvider`), weekend FX closure skipping, `PaperTradingEngine` evaluation, incremental `StrategyEngine` evaluation, fail-closed `evaluateRiskGate`, and alert/recap retries.
  - `src/worker/telegram.ts`: Deep-link pairing sessions (`/api/telegram/session`, `/api/telegram/session/:token`), web & chat disconnect (`POST /api/telegram/disconnect`, `/disconnect`, `/stop`), constant-time `X-Telegram-Bot-Api-Secret-Token` webhook handling (`/status [PAIR]`, `/recap`, `/start`), atomic `SENDING` claim locks, and 21:00 UTC daily recaps.
  - `src/worker/fundamentals.ts`: `GET /api/fundamentals/:instrument` macro context evaluation via `FundamentalEngine`.
- **Core Strategy & Risk Engine (`axnna-web/src/core-engine/`, `axnna-web/src/engine/`):**
  - `StrategyEngine.ts` (`AXNNA_V1_LIQUIDITY_FVG`): Incremental multi-timeframe (`1H` HTF bias + `5M` liquidity sweeps, displacement, FVG retracement) with deterministic state persistence in `strategy_state` and quality threshold (`>= 65`).
  - `FundamentalEngine.ts`: Currency exposure mapping (`USD`, `EUR`, `GBP`, `JPY`), macro regime tallying, and event proximity risk classification (`NONE`, `LOW`, `ELEVATED`, `HIGH`, `EXTREME`, or `UNKNOWN`).
  - `RiskGate.ts`: Independent fail-closed pre-delivery gate (`evaluateRiskGate`) validating instrument support, active-session freshness (`<= 20m`), setup age (`<= 30m`), structural SL/TP geometry, duplicate suppression, and event risk before persisting `risk_decisions` atomically.
  - `PaperTradingEngine.ts`: Conservative `SIMULATION_ONLY` forward tracker (`PENDING_ENTRY` -> `ACTIVE_TRADE` -> `TARGET_HIT` / `STOP_HIT` / `EXPIRED` / `INVALIDATED`) with spread, slippage, and commission modeling.

## Repository Structure

```text
/
├── axnna-web/                  # Vite React SPA, Cloudflare Worker, D1 migrations, and Vitest suites
│   ├── src/core-engine/        # StrategyEngine, BacktestEngine, ScoringModel, MarketData validator
│   ├── src/engine/             # FundamentalEngine, RiskGate, PaperTradingEngine
│   ├── src/providers/          # TwelveDataMarketProvider, TiingoMarketProvider, FreeEconomicCalendarProvider
│   ├── src/worker/             # Modular HTTP, sync, fundamental, and Telegram handlers
│   ├── src/ops/                # D1 leases, sliding rate limits, provider/system health, retention pruning
│   ├── src/pages/              # Public SPA routes
│   ├── migrations/             # Sequential Cloudflare D1 SQL migrations (0001 through 0011)
│   └── docs/                   # Subsystem design docs & ADRs
├── docs/
│   ├── deployment/             # Cloudflare architecture, D1 provisioning, runbook, env & secrets guides
│   ├── WORKFLOW.md             # Local dev, CI/CD, and Worker deployment workflow
│   └── Axnna_*Specification*   # Historical strategy & engine research specifications
└── .github/workflows/          # Node 24 CI (ci.yml) & Cloudflare Worker CD (cd.yml)
```

## Quick Start

```bash
cd axnna-web
npm ci
npm run db:init
npm run typecheck && npm run lint && npm test
npm run dev
```

For full deployment instructions, Cloudflare D1 provisioning, and environment secrets, see [docs/WORKFLOW.md](docs/WORKFLOW.md) and [docs/deployment/DEPLOYMENT_RUNBOOK.md](docs/deployment/DEPLOYMENT_RUNBOOK.md).
