# Axnna System Architecture

Axnna combines a React + TypeScript + Vite SPA with a modular Cloudflare Worker (`src/worker.ts` dispatching to `src/worker/{types,http,fundamentals,sync,telegram}.ts`) and Cloudflare D1 SQLite (`DB`).

## Runtime Topology

- **Unified Worker + Static Assets:** `wrangler.toml` serves Vite `./dist` assets via the `ASSETS` binding (`not_found_handling = "single-page-application"`, `run_worker_first = true`). Unmatched `/api` and `/api/*` paths return JSON `404`, missing `/assets/*` or static extensions return HTTP `404` (never falling back to `index.html`), and valid client routes serve the SPA.
- **Modular Worker Layout (`src/worker/`):**
  - `types.ts`: `Env`, `SyncActionResult`, `SupportedInstrument`, `SupportedTimeframe`, static extension guard.
  - `http.ts`: Allowlist CORS headers, bounded JSON reader, `/api/status`, `/api/performance`, and bearer-authenticated `/api/dev/backtest`.
  - `fundamentals.ts`: `evaluateInstrumentFundamentalContext` serving `/api/fundamentals/:instrument`.
  - `sync.ts`: D1-leased `runSynchronization` (`CRON_SYNC` & `CRON_1H_SYNC`), calendar sync, dual-provider FX ingestion (`TwelveDataMarketProvider` + `TiingoMarketProvider` fallback), weekend session checks, `PaperTradingEngine` evaluation, incremental `StrategyEngine` execution, fail-closed `evaluateRiskGate`, and retry loops.
  - `telegram.ts`: Pairing session creation/polling (`POST /api/telegram/session`, `GET /api/telegram/session/:token`, `alreadyConnected` state), disconnect flow (`POST /api/telegram/disconnect`, `/disconnect`, `/stop`), constant-time webhook handling (`/start`, `/status [PAIR]`, `/recap`), atomic `SENDING` claim locks, and 21:00 UTC daily recaps.
- **Frontend SPA (`src/`):**
  - Routes: `/`, `/about`, `/strategies` (`/methodology` redirects to `/strategies`), `/faq`, `/status`, `/contact`, `/connect-telegram`, `/legal/:page`.
  - Design system: Pure CSS tokens (`src/index.css`) supporting dark obsidian (`#080b10`) and light slate (`#f5f7fa`) themes, shared `<SetupDiagram />` SVG visuals, Sweep-to-Signal Pulse logo and favicons (`public/favicon*`, `public/apple-touch-icon.png`), collapsible FAQ accordions, read-only forward track record on `/strategies`, direct Telegram feedback link (`https://t.me/mad_ede`) on `/contact`, and `localStorage` connection persistence on `/connect-telegram`.

## End-to-End Pipeline (`SIMULATION_ONLY`)

```text
TwelveData (+ Tiingo fallback) + FreeEconomicCalendarProvider
  -> MarketDataValidator -> market_candles (D1)
  -> evaluateOpenPaperTrades (PaperTradingEngine)
  -> StrategyEngine (1H HTF Bias -> 5M Liquidity/Displacement/FVG, score >= 65)
  -> FundamentalEngine (currency exposure + event proximity + macro regime)
  -> evaluateRiskGate (fail-closed -> risk_decisions + audit_events)
  -> deliverTelegramAlerts (atomic SENDING claim) + registerPaperTradeFromApprovedSignal
```

Real-money broker execution does not exist (`SIMULATION_ONLY`). `signals.status` preserves qualification/delivery history (`ALERT_ELIGIBLE`, `ALERTED`, `REJECTED`), while simulated execution lives strictly in `paper_trades` (`PENDING_ENTRY` -> `ACTIVE_TRADE` -> `TARGET_HIT` / `STOP_HIT` / `EXPIRED` / `INVALIDATED`).

## Public & Protected API Surface

| Route | Method | Access | Behavior |
| :--- | :--- | :--- | :--- |
| `/api/status` | `GET` | Public | Sanitized overall status + subsystem health (`max-age=15`) |
| `/api/performance` | `GET` | Public | Aggregate read-only paper trading KPIs, per-instrument & score bands (`65-74`, `75-84`, `85+`), 0 D1 writes (`max-age=300`) |
| `/api/fundamentals/:instrument` | `GET` | Public | Validated currency macro context (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`) |
| `/api/telegram/session` | `POST` | Public | Creates 10m UUID pairing token (D1 rate-limited `15/hr` per hashed actor) |
| `/api/telegram/session/:token` | `GET` | Public | Polls `PENDING`, `CONNECTED` (`alreadyConnected?: true`), `DISCONNECTED`, `EXPIRED`, or `NOT_FOUND` |
| `/api/telegram/disconnect` | `POST` | Public | Disconnects verified session owner (`axnna_users.status = 'DISCONNECTED'`) |
| `/api/telegram/webhook` | `POST` | Telegram Webhook | Constant-time `X-Telegram-Bot-Api-Secret-Token` auth (`503` if unset); `10/5m` command throttling |
| `/api/dev/backtest` | `POST` | Bearer Secret | Constant-time `Authorization: Bearer <BACKTEST_SECRET>` (`503` if unset); bounded `100..400` `1H` bars |

## CORS & Environment Isolation

- `buildCorsHeaders` checks `Origin` against the request origin, `ALLOWED_ORIGINS`, and local dev loopback hosts (`localhost`/`127.0.0.1` only when running locally). Wildcard `*` is never emitted.
- Production crons run `*/15 * * * *`, `2 * * * *`, and `0 21 * * *`; staging disables cron triggers (`crons = []`) so staging deploys never double quota consumption.
