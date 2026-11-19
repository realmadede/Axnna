# Axnna Web & Worker Platform

Unified Vite + React frontend and Cloudflare Worker API/scheduler (`axnna-web/`).

## Directory Layout

- `src/App.tsx`, `src/pages/`, `src/components/`, `src/index.css`: React 18 SPA UI, pure CSS design tokens, shared `<SetupDiagram />`, Sweep-to-Signal Pulse logo, and responsive navigation.
- `src/worker.ts` & `src/worker/`: Cloudflare Worker entrypoint, HTTP routing (`http.ts`), D1-leased market & calendar sync (`sync.ts`), fundamental queries (`fundamentals.ts`), and Telegram webhook/pairing (`telegram.ts`).
- `src/providers/`: `TwelveDataMarketProvider`, `TiingoMarketProvider` fallback, and `FreeEconomicCalendarProvider`.
- `src/core-engine/` & `src/engine/`: `StrategyEngine`, `BacktestEngine`, `ScoringModel`, `MarketDataValidator`, `FundamentalEngine`, `RiskGate`, and `PaperTradingEngine`.
- `src/ops/telemetry.ts`: Atomic `sync_leases`, D1 rate limiting, `provider_health_state`, `evaluateSystemHealth`, and `pruneOperationalTables`.
- `migrations/`: Sequential Cloudflare D1 schema (`0001_initial_schema.sql` through `0011_stage_d2_release_integrity.sql`).
- `docs/`: Deep-dive subsystem architecture notes (`architecture.md`, `data-ingestion.md`, `telegram-flow.md`, etc.).

## Scripts

Run from `axnna-web/`:

```bash
npm run dev        # Start Vite frontend dev server
npm run build      # Build production Vite bundle into ./dist
npm run typecheck  # TypeScript check (tsc --noEmit)
npm run lint       # ESLint over src
npm test           # Run Vitest suite (uses local node:sqlite in-memory DB)
npm run test:live  # Optional live provider sanity verification script
npm run db:init    # Apply local D1 migrations (wrangler d1 migrations apply DB --local)
npm run deploy     # Deploy unified Worker + Assets via Wrangler
```

## Active Public & Bot Surfaces

- **SPA Routes:** `/`, `/about`, `/strategies` (`/methodology` redirects), `/faq`, `/status`, `/contact`, `/connect-telegram`, `/legal/:page`.
- **Worker Endpoints:** `GET /api/status`, `GET /api/performance`, `GET /api/fundamentals/:instrument`, `POST /api/telegram/session`, `GET /api/telegram/session/:token`, `POST /api/telegram/disconnect`, `POST /api/telegram/webhook`, and `POST /api/dev/backtest` (bearer secret protected).
- **Scheduled Crons:** `*/15 * * * *` (`CRON_SYNC`: `5M` ingestion, stale-guarded `1H`/calendar sync, strategy & paper evaluation, deliveries), `2 * * * *` (`CRON_1H_SYNC`: `1H` candle refresh), `0 21 * * *` (daily recap + operational pruning).

See [docs/architecture.md](docs/architecture.md) and [../docs/WORKFLOW.md](../docs/WORKFLOW.md) for details.
