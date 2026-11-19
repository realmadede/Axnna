# Architecture Decision Records (ADRs)

## ADR 001: Unified Cloudflare Worker + Static Assets Architecture
**Decision**: Build Axnna with React 18, TypeScript, Vite (`./dist`), and a single unified Cloudflare Worker (`run_worker_first = true` + `ASSETS` binding).
**Rationale**: Keeps SPA delivery, API endpoints, cron ingestion, and Telegram webhook handling inside one atomic deploy unit without cross-service routing drift or extra platform overhead.

## ADR 002: Cloudflare D1 as Operational & Time-Series Store
**Decision**: Use Cloudflare D1 (`DB`) for candle caches, `strategy_state`, `signals`, `risk_decisions`, `paper_trades`, `notification_deliveries`, `sync_leases`, and `audit_events`.
**Rationale**: Zero-egress native Worker binding with atomic SQL batches (`env.DB.batch`) and local parity via `node:sqlite` tests.

## ADR 003: Passwordless Telegram-First Identity & Disconnect Control
**Decision**: Anchor subscriber identity to Telegram's numeric `telegram_user_id` via 10-minute deep-link sessions, detect already-connected accounts, and allow one-click or `/disconnect` opt-out.
**Rationale**: Removes passwords, emails, and phone numbers while keeping subscriber state synchronized between Telegram chat and `/connect-telegram`.

## ADR 004: Provider-Independent Market Data Layer with Automatic Failover
**Decision**: Route OHLCV fetching through `IMarketDataProvider` + `MarketDataValidator` using `TwelveDataMarketProvider` primary and `TiingoMarketProvider` automatic fallback.
**Rationale**: Prevents upstream rate limits (`429`) or provider outages from halting signal evaluation while keeping `StrategyEngine` and `PaperTradingEngine` vendor-agnostic.

## ADR 005: Keyless Centralized Macroeconomic Calendar
**Decision**: Run macro event fetching centrally via `FreeEconomicCalendarProvider` (`biquote.io` + FairEconomy fallback) with D1 caching (`>= 25m` stale guard) and fail-closed `'UNKNOWN'` state on outage.
**Rationale**: Eliminates paid calendar API dependencies and per-user rate scaling while preserving strict pre-trade event-risk gating.

## ADR 006: Independent Fail-Closed Risk Gate & Read-Only Paper Track Record
**Decision**: Isolate `RiskGate.ts` and `PaperTradingEngine.ts` (`SIMULATION_ONLY`) from signal detection and delivery, exposing aggregate forward results read-only on `/api/performance` and `/strategies`.
**Rationale**: Preserves complete auditability between setup qualification (`signals`), risk rejection/approval (`risk_decisions`), and conservative simulated execution (`paper_trades`).

## ADR 007: No Web Admin Panel Surface
**Decision**: Keep all administration inside authenticated Wrangler CLI / D1 operations (`wrangler secret`, `wrangler d1`) rather than exposing web admin auth routes.
**Rationale**: Minimizes public attack surface and eliminates brute-force, session cookie, and admin inbox maintenance overhead.
