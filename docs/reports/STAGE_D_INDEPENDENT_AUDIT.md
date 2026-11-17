# Axnna Stage D.1: Independent Production Readiness and Release Audit

**Repository:** `realmadede/Axnna`  
**Branch:** `main` (`ahead 1` of `origin/main` at `791ebde`)  
**HEAD Commit:** `e1adc44` (plus uncommitted Stage B, C, C.2, D, and branding changes)  
**Audit Mode:** Independent, strictly read-only technical audit  
**Report Date:** 2026-11-17

---

## 1. Executive Summary

An independent, code-level and runtime-execution audit of Axnna Stage D confirms strong foundational engineering in Admin authentication, CSRF protection, HMAC session revocation, strategy-state determinism, Miniflare static-asset routing, and zero-emoji hygiene, while identifying **zero Critical**, **five High**, **six Medium**, **four Low**, and **one Informational** findings that preclude immediate staging or production release.

The five **High** findings center on:
1. Missing fail-closed handling when economic calendar data is unavailable (`'UNKNOWN'`) or market candles are stale during Risk Gate evaluation (`axnna-web/src/worker.ts:511-522, 1618`; `FundamentalEngine.ts:162-165`; `RiskGate.ts:62-63`).
2. Broad `try/catch {}` swallowing around `risk_decisions` D1 persistence, allowing downstream Telegram alerts and paper trades even if Risk Gate logging fails (`axnna-web/src/worker.ts:524-595`).
3. Paper-trading accounting and equity-curve defects: non-atomic balance vs trade-row D1 updates (`PaperTradingEngine.ts:355-406`), out-of-order equity curve / drawdown calculation sorted by `signal_timestamp` rather than `exit_timestamp` (`PaperTradingEngine.ts:446, 526-535`), and Admin `starting_balance` updates that desynchronize `current_balance` (`admin/routes.ts:816-822`).
4. Lifecycle status overwriting (`UPDATE signals SET status = ...`) breaking both Daily Recap signal counts (`worker.ts:1286-1293`) and Admin `alertedSignals` / `alertEligibleSignals` KPIs (`admin/routes.ts:421-422`).
5. `/api/dev/backtest` passing price-unit decimals (`0.00015`) into pip-denominated `BacktestEngine` overrides, collapsing modeled transaction costs by ~10,000x (`worker.ts:1837-1843`).

**Staging Verdict:** **NOT READY** (remediate High/Medium findings in one consolidated Stage D.2 pass before staging provisioning).  
**Production Verdict:** **NOT READY**.

---

## 2. Verified Git Baseline

Verified directly via `git branch -vv`, `git branch -a`, `git status -sb`, `git diff --stat HEAD`, `npx wrangler d1 migrations list DB --local`, and `axnna-web/package.json`:

- **Current Branch & HEAD:** `main` at `e1adc44` (`feat: add CI/CD, free calendar, Telegram alerts, and /config admin console`), tracking `origin/main` at `791ebde` (`[ahead 1]`).
- **Remote Branches:** `origin/main`, `origin/phase-7-work`.
- **Working Tree Status:** `35` tracked files modified (`8,748` insertions, `1,367` deletions; including `AxnnaLogo` branding edits in `index.html`, `favicon.svg`, `App.tsx`, `index.css` plus `D LiveMarketProvider.test.ts` and `D tsconfig.tsbuildinfo`) and `21` untracked files/directories including `migrations/0007` through `0010`, `src/engine/RiskGate.ts`, `src/engine/PaperTradingEngine.ts`, `src/components/`, `public/apple-touch-icon.png`, `public/favicon-32x32.png`, `src/ops/`, `src/utils/`, `tests/stage_d_pipeline.test.ts`, `docs/deployment/`, and `docs/reports/`. No staged changes.
- **Local D1 Migrations:** `No migrations to apply!` (`0001` through `0010` applied locally).
- **Installed Package Versions (`axnna-web/package.json`):** React `^18.2.0`, React Router `^6.22.0`, Vite `^5.4.21`, Vitest `^1.6.1`, TypeScript `^5.5.4`, Wrangler `^3.28.1`, Glisse `^0.6.0`, Framer Motion `^14.0.0`, Lucide React `^1.52.0`. `tsx` is **not** installed.
- Repository left completely unmodified aside from creating this audit report.

---

## 3. Scope and Methodology

Every claim in `docs/reports/STAGE_D_IMPLEMENTATION_REPORT.md` was cross-checked directly against source code, SQL migrations `0001`–`0010`, CI/CD workflows, wrangler configuration, mathematical trace verification, and independent execution of `npm run typecheck`, `npm run lint`, `CI=1 npm test`, and `npm run build` inside `axnna-web/`. No source code, migrations, config, or tests were modified.

---

## 4. Implementation Areas Inspected

- **Engines:** `src/engine/RiskGate.ts`, `src/engine/PaperTradingEngine.ts`, `src/engine/FundamentalEngine.ts`, `src/core-engine/StrategyEngine.ts`, `src/core-engine/ScoringModel.ts`, `src/core-engine/BacktestEngine.ts`, `src/core-engine/MarketData.ts`
- **Worker & Providers:** `src/worker.ts`, `src/providers/MarketProvider.ts`, `src/providers/FundamentalProvider.ts`, `src/ops/telemetry.ts`
- **Admin, Auth & Frontend:** `src/admin/auth.ts`, `src/admin/routes.ts`, `src/pages/Config.tsx`, `src/pages/Status.tsx`, `src/App.tsx`, `src/index.css`, `index.html`, `src/components/AxnnaLogo.tsx`, `public/*`
- **Database & Deployment:** `migrations/0001`–`0010`, `wrangler.toml`, `.github/workflows/ci.yml`, `.github/workflows/cd.yml`
- **Test Suites:** `tests/stage_d_pipeline.test.ts`, `tests/database_migrations.test.ts`, `tests/stage_c2_remediation.test.ts`, `tests/stage_c2_miniflare_routing.test.ts`, `tests/stage_c_ui.test.tsx`, `src/__tests__/worker.test.ts`, `src/core-engine/__tests__/StrategyState.test.ts`

---

## 5. Findings Summary by Severity

| Severity | Count | Identifiers |
| :--- | :---: | :--- |
| **CRITICAL** | 0 | None |
| **HIGH** | 5 | `AUD-D1-01`, `AUD-D1-02`, `AUD-D1-03`, `AUD-D1-04`, `AUD-D1-05` |
| **MEDIUM** | 6 | `AUD-D1-06`, `AUD-D1-07`, `AUD-D1-08`, `AUD-D1-09`, `AUD-D1-10`, `AUD-D1-11` |
| **LOW** | 4 | `AUD-D1-12`, `AUD-D1-13`, `AUD-D1-14`, `AUD-D1-15` |
| **INFORMATIONAL** | 1 | `AUD-D1-16` |
| **Total** | **16** | |

---

## 6. Detailed Findings

### AUD-D1-01: Risk Gate Approves `'UNKNOWN'` Calendar Data & Omits Wall-Clock Market Staleness Checks
- **Severity:** **HIGH**
- **Affected Files & Lines:** `axnna-web/src/worker.ts:511-522, 1601-1625`; `axnna-web/src/engine/RiskGate.ts:62-63, 94-105, 197-204`; `axnna-web/src/engine/FundamentalEngine.ts:162-165`
- **Actual Behavior:**
  1. `worker.ts:511-522` calls `evaluateRiskGate` without `requireFundamentalAvailability: true`, so `UNKNOWN` calendar availability passes (`RiskGate.ts:63` defaults `false`) and `FundamentalEngine.getConfluence` (`FundamentalEngine.ts:162-165`) returns `'NEUTRAL'` for `'UNKNOWN'`.
  2. `worker.ts:1618` computes `const calendarDataAvailable = eventsArr.length > 0 || calHealthStatus === 'HEALTHY'`. Because `economic_events` is never pruned (`telemetry.ts:356-431`), any historical events keep `eventsArr.length > 0` permanently `true` even during extended calendar outages (`calHealthStatus === 'FAILED'`), causing `FundamentalEngine` (`line 62`) to report `'NONE'` instead of `'UNKNOWN'`.
  3. `worker.ts:520` passes `nowMs: latestCompletedCandleMs ?? Date.now()` and omits `maxMarketStalenessMs` (`null` default). If market data feeds fail (`worker.ts:325-326` still runs `runStrategyEngine`) and `STRATEGY_STATE_RESET` occurs or stale candles are present, `evaluateRiskGate` evaluates freshness relative to the stale candle's own timestamp (`0` age) and approves signals from old data.
- **Expected Behavior:** Stale/failed calendar health (e.g., no recent sync or `calHealthStatus !== 'HEALTHY'` without recent events) should resolve to `'UNKNOWN'`, `requireFundamentalAvailability` policy should be explicit and enforced conservatively (`REJECTED` / `'FUNDAMENTAL_DATA_UNAVAILABLE'`), and `evaluateRiskGate` should receive wall-clock `nowMs: Date.now()` with bounded `maxMarketStalenessMs` during active market sessions.
- **Reproduction Steps:** Seed 1 expired yesterday row in `economic_events`, set `provider_health_state` (`ECONOMIC_CALENDAR`) to `'FAILED'`, run `evaluateInstrumentFundamentalContext(db, 'EURUSD')` -> returns `eventRisk: 'NONE', dataAvailable: true`. Run `evaluateRiskGate` from `worker.ts:511` with `eventRisk: 'UNKNOWN'` -> returns `APPROVED`.
- **Technical Root Cause:** Permissive OR condition (`eventsArr.length > 0`) masking stale calendar feeds + omitted policy flags in `worker.ts` caller.
- **Impact:** Risk Gate can approve live alerts and paper trades during prolonged economic calendar failures or stale market feeds.
- **Recommended Correction:** Require recent calendar sync health (not legacy `eventsArr.length > 0`) for `calendarDataAvailable`; enable `requireFundamentalAvailability: true` (or explicit `'UNKNOWN'` policy blocking) in `runStrategyEngine`; pass `nowMs: Date.now()` and appropriate `maxMarketStalenessMs` (skipping `runStrategyEngine` cleanly when `marketFailures` affects that instrument's `5M` feed).
- **Regression Test Required:** Integration test verifying calendar outage + stale past DB rows yields `'UNKNOWN'` and Risk Gate `REJECTED`, plus stale `5M` candle rejection in `runStrategyEngine`.

### AUD-D1-02: Broad `try/catch {}` Around `risk_decisions` Allows Downstream Alerts/Trades Without Persisted Decision
- **Severity:** **HIGH**
- **Affected Files & Lines:** `axnna-web/src/worker.ts:524-595`
- **Actual Behavior:** `INSERT INTO risk_decisions` and `INSERT INTO audit_events` (`lines 525-565`) are wrapped in `try { ... } catch {}` (`lines 566-568`). If the D1 insert fails for any reason (lock timeout, constraint mismatch, schema drift), execution falls through into `else { await deliverTelegramAlerts(...); await registerPaperTradeFromApprovedSignal(...); }`.
- **Expected Behavior:** Failing to persist `risk_decisions` must fail closed and prevent Telegram delivery and paper trade creation.
- **Reproduction Steps:** Trigger any constraint/DB error on `risk_decisions` while `riskDecision.decision === 'APPROVED'` -> Telegram delivery and `paper_trades` insert still execute.
- **Technical Root Cause:** Unfiltered catch block left for hypothetical schema-less legacy fixtures.
- **Impact:** Breaks the audit invariant that every delivered alert and paper trade is backed by a persisted Risk Gate decision.
- **Recommended Correction:** Remove the silent catch-all (or strictly block delivery/paper registration whenever `risk_decisions` persistence fails) and record a `security_events`/job warning on DB write errors.
- **Regression Test Required:** Test forcing `risk_decisions` DB failure and asserting `deliverTelegramAlerts` and `registerPaperTradeFromApprovedSignal` do not execute.

### AUD-D1-03: Paper Trading Accounting Race, Out-of-Order Equity Curve / Max Drawdown, and Admin Balance Desynchronization
- **Severity:** **HIGH**
- **Affected Files & Lines:** `axnna-web/src/engine/PaperTradingEngine.ts:355-406, 445-447, 526-535`; `axnna-web/src/admin/routes.ts:809-823`
- **Actual Behavior:**
  1. `evaluateOpenPaperTrades` updates `paper_accounts.current_balance` (`line 356`) before updating `paper_trades` (`line 380`) and `signals` (`line 405`) as separate non-atomic queries rather than `env.DB.batch([...])`. An interruption between queries leaves `current_balance` permanently out of sync with `paper_trades.net_pnl`.
  2. `getPaperPortfolioOverview` loads trades `ORDER BY signal_timestamp ASC, id ASC` (`line 446`) and walks that list to compute `runningBalance`, `equityCurve`, and `maxDrawdown` (`lines 526-535`). When Trade A (`signal_timestamp = 10:00`) closes after Trade B (`signal_timestamp = 10:15`, `exit_timestamp = 11:00` vs `14:00`), closed equity and drawdown are calculated out of chronological close order.
  3. `POST /api/config/paper/account` (`routes.ts:816-822`) with `resetAccount = false` updates `paper_accounts.starting_balance` without recalculating `current_balance = startingBalance + realizedPnl`, breaking balance reconciliation (`startingBalance + realizedPnl !== currentBalance`).
- **Expected Behavior:** Account balance and trade status transitions execute atomically per trade via D1 `batch`; `equityCurve` and `maxDrawdown` sort closed trades chronologically by `exit_timestamp ASC`; updating `startingBalance` without resetting trades adjusts `current_balance` by the delta (or recalculates `startingBalance + SUM(net_pnl)`).
- **Reproduction Steps:** Close two multi-pair trades whose close timestamps invert their `signal_timestamp` order and inspect `equityCurve`; or call `POST /api/config/paper/account` (`startingBalance: 25000`, `resetAccount: false`) after a `+$180` closed win -> `currentBalance` remains `$10,180` while `startingBalance` is `$25,000` and `realizedPnl` is `$180`.
- **Technical Root Cause:** Sequential non-batched D1 statements, entry-order query reused for exit-order equity curve, and partial account update SQL.
- **Impact:** Misleading virtual balance, inaccurate equity curve, and incorrect maximum drawdown reporting in Admin Console.
- **Recommended Correction:** Batch close updates (`paper_accounts`, `paper_trades`, `signals`) atomically; sort closed trades by `exit_timestamp ASC, id ASC` when constructing `equityCurve` and `maxDrawdown`; reconcile `current_balance` whenever `starting_balance` changes.
- **Regression Test Required:** Add regression tests for out-of-order trade closes, atomic balance reconciliation, and non-reset `startingBalance` updates.

### AUD-D1-04: Updating `signals.status` for Paper Trades Corrupts Daily Recap & Admin Signal KPIs
- **Severity:** **HIGH**
- **Affected Files & Lines:** `axnna-web/src/engine/PaperTradingEngine.ts:404-406`; `axnna-web/src/worker.ts:1270-1316`; `axnna-web/src/admin/routes.ts:420-423`
- **Actual Behavior:** `PaperTradingEngine.ts:405` overwrites `signals.status` from `'ALERTED'` to `'ACTIVE_TRADE'`, `'TARGET_HIT'`, `'STOP_HIT'`, `'EXPIRED'`, or `'INVALIDATED'`. Both `buildDailyRecapText` (`worker.ts:1286-1293`) and Admin `totals` (`routes.ts:421-422`) count only `status = 'ALERTED'` / `'ALERT_ELIGIBLE'`. Once paper trades fill or close, those signals vanish from `alerted` metrics—causing Daily Recap at 21:00 UTC (and `/recap`) to emit **`Alerted setups: 0` / `Silence is a valid signal.`** even when alerted trades closed earlier that UTC day, and causing Admin `alertedSignals` to drop over time.
- **Expected Behavior:** Alert delivery counts and Daily Recap totals must reflect whether a signal was actually alerted/risk-approved regardless of downstream paper trade lifecycle transitions.
- **Reproduction Steps:** Mark a signal `'ALERTED'`, let `evaluateOpenPaperTrades` transition it to `'TARGET_HIT'`, then call `runDailyRecap` or `GET /api/config/overview` -> `alerted` / `alertedSignals` drops to `0`.
- **Technical Root Cause:** Overloading `signals.status` with both alert state (`ALERTED`) and trade execution state (`TARGET_HIT`) without updating downstream SQL queries (`notification_deliveries` / `risk_decisions` / `IN (...)`).
- **Impact:** False Daily Recap notifications ("Silence is a valid signal") and inaccurate Admin signal KPIs.
- **Recommended Correction:** Include paper lifecycle statuses (or join `risk_decisions`/`notification_deliveries` `'SENT'`) in Daily Recap and Admin `totals` SQL queries.
- **Regression Test Required:** Test verifying `buildDailyRecapText` and Admin `totals.alertedSignals` still report closed (`TARGET_HIT`/`STOP_HIT`) alerted trades accurately.

### AUD-D1-05: `/api/dev/backtest` Supplies Decimal Price Units Into Pip-Scaled `BacktestEngine` Cost Overrides
- **Severity:** **HIGH**
- **Affected Files & Lines:** `axnna-web/src/worker.ts:1837-1843`; `axnna-web/src/core-engine/BacktestEngine.ts:27-50`
- **Actual Behavior:** `handleBacktestRun` constructs `BacktestConfig` with `spreadPips: body.spreadPips ?? 0.00015`, `commissionPercent: body.commissionPercent ?? 0.00005`, and `slippagePips: body.slippagePips ?? 0.00005`. Inside `BacktestEngine.getInstrumentCosts`, `spreadPips`, `commissionPercent`, and `slippagePips` are multiplied by `pipSize` (`0.0001`, `0.01`, `0.1`), producing `0.00015 * 0.0001 = 1.5e-8` (~10,000x below real `1.0–2.0` pip costs) and overriding per-instrument defaults with near-zero cost, plus lacking numeric `>= 0` validation on user-supplied cost overrides.
- **Expected Behavior:** Default backtest runs should omit `spreadPips`/`commissionPercent`/`slippagePips` so `getInstrumentCosts` applies calibrated `INSTRUMENT_CONFIGS` (`1.0–2.0` pips), and optional overrides must be validated as finite non-negative numbers.
- **Reproduction Steps:** Inspect `worker.ts:1840-1842` -> `spreadPips: 0.00015` -> `BacktestEngine.run` emits `spreadModel: "0.00015 pips"`.
- **Technical Root Cause:** Legacy decimal price-space values left over from before `getInstrumentCosts` standardized on pip units.
- **Impact:** Any `/api/dev/backtest` invocation systematically understates transaction friction by 4 orders of magnitude.
- **Recommended Correction:** Omit cost overrides when unset in request body and validate optional overrides (`Number.isFinite(v) && v >= 0 && v <= 50`).
- **Regression Test Required:** Worker test calling `POST /api/dev/backtest` (with mocked TwelveData fetch) asserting `metadata.spreadModel` equals `'1 pips'` / `'1.5 pips'` / `'2 pips'` rather than `'0.00015 pips'`.

### AUD-D1-06: `PENDING_ENTRY` Evaluates Fill/Stop Before `15m` Expiry on Delayed Candles
- **Severity:** **MEDIUM**
- **Affected Files & Lines:** `axnna-web/src/engine/PaperTradingEngine.ts:246-307`; `axnna-web/src/core-engine/BacktestEngine.ts:189-228`
- **Actual Behavior:** In both engines, when a candle arrives with `c.timestamp - signalMs > PENDING_EXPIRY_MS` (e.g., after a feed outage or weekend gap), `stopPreHit` and `entryHit` execute before checking expiration (`line 292` in `PaperTradingEngine.ts`, `line 224` in `BacktestEngine.ts`). An already-expired pending order can still fill if that later candle touches `intended_entry`.
- **Expected Behavior:** Check `c.timestamp - signalMs > PENDING_EXPIRY_MS` strictly before fill/invalidation checks on the candle.
- **Impact:** Overdue limit setups can fill after their 15-minute validity window.
- **Recommended Correction:** Move the expiry check (`> PENDING_EXPIRY_MS`) above `stopPreHit`/`entryHit` in both `PaperTradingEngine.ts` and `BacktestEngine.ts`.
- **Regression Test Required:** Unit test feeding a candle at `t0 + 20m` touching `intended_entry` directly and verifying outcome is `'EXPIRED'`, not `'ACTIVE_TRADE'`.

### AUD-D1-07: Daily Recap (`21:00 UTC`) Cron Overlap and Unclaimed Manual Delivery Retry Can Duplicate Messages
- **Severity:** **MEDIUM**
- **Affected Files & Lines:** `axnna-web/wrangler.toml:25`; `axnna-web/src/worker.ts:200-217, 1107-1147, 1318-1389`
- **Actual Behavior:** At `21:00 UTC`, `"0 21 * * *"` invokes `runDailyRecap` simultaneously with `"*/5 * * * *"` invoking `runSynchronization` (`retryFailedDailyRecaps`); `runDailyRecap` does not acquire `sync_leases` or claim rows before `sendTelegramMessage`. Similarly, `retrySingleDeliveryById` (`worker.ts:1107`) does not atomically claim `'RETRY_SCHEDULED'`/`'FAILED'` prior to calling Telegram.
- **Expected Behavior:** Outbound recap and retry flows should coordinate via lease or atomic status transitions before issuing HTTP `sendMessage` requests.
- **Impact:** Rare duplicate Telegram messages during overlapping cron or manual retry clicks.
- **Recommended Correction:** Protect `runDailyRecap` with a separate `DAILY_RECAP` lease (or shared lease awareness) and atomically update/lock delivery row state before calling Telegram.
- **Regression Test Required:** Concurrency test verifying concurrent retry/recap calls cannot send twice to the same user.

### AUD-D1-08: Sequential Unbatched D1 `market_candles` Upserts Create Cron Scalability Bottleneck
- **Severity:** **MEDIUM**
- **Affected Files & Lines:** `axnna-web/src/worker.ts:291-306`
- **Actual Behavior:** Up to `800` individual `await env.DB.prepare(...).run()` statements (`4` instruments x `2` timeframes x `100` candles) run sequentially in every 5-minute sync cycle before `evaluateOpenPaperTrades`, `runStrategyEngine`, and `retryScheduledDeliveries`.
- **Expected Behavior:** Chunked `env.DB.batch([...])` (e.g., 50–100 statements per batch) reduces D1 round-trips by 10x–20x and protects Worker CPU/wall-clock execution budgets as user count grows.
- **Recommended Correction:** Batch `market_candles` upserts with `env.DB.batch(...)`.
- **Regression Test Required:** Verify `runSynchronization` behaves identically with batched candle persistence.

### AUD-D1-09: Admin Console Filtered Pagination & Summary Metrics Mismatch; No Paper Account Reset Action in UI
- **Severity:** **MEDIUM**
- **Affected Files & Lines:** `axnna-web/src/pages/Config.tsx:516-544, 1252-1383, 1450`; `axnna-web/src/engine/PaperTradingEngine.ts:568-605`
- **Actual Behavior:** When filtering **Paper Trading** by `paperInstrumentFilter` or `paperVersionFilter`, `getPaperPortfolioOverview` returns unfiltered KPIs (`summary`, `equityCurve`, `byInstrument`, `byStrategyVersion`) and `Config.tsx:1450` passes unfiltered `totals.paperTradesTotal` to `renderPagination`, creating empty pages. Client-side filters in Users, Signals, and Security also only filter the current 25-row page rather than server SQL results, and the Paper Account Config form has no Reset button (`resetAccount: false` hardcoded).
- **Expected Behavior:** Pagination totals should match the filtered result set, KPIs/filter semantics should be clear or filtered consistently, and Admins should have an explicit confirmed reset control matching the backend `resetAccount` capability.
- **Recommended Correction:** Return `filteredTotal` from `getPaperPortfolioOverview` for `Config.tsx` pagination and add a guarded **Reset Simulation Account** action alongside `Save Account Config`.
- **Regression Test Required:** Multi-page + filtered Admin overview UI/API test asserting accurate page counts and reset behavior.

### AUD-D1-10: `worker.test.ts` Event-Risk Test Passes via False-Positive Reason (`STALE_SIGNAL` Instead of `HIGH_EVENT_RISK`)
- **Severity:** **MEDIUM**
- **Affected Files & Lines:** `axnna-web/src/__tests__/worker.test.ts:45-95`
- **Actual Behavior:** Test `suppresses Telegram alerts during HIGH EVENT RISK while persisting market_context` uses a 2023 signal timestamp (`1700000000000`) against a 2026 candle (`2026-11-17T00:00:00Z`), causing `RiskGate` to reject with `STALE_SIGNAL` rather than `HIGH_EVENT_RISK` (visible in test stdout: `ALERT_SUPPRESSED_RISK_GATE: ... - STALE_SIGNAL`). Because `line 88` only asserts `expect(fetchMock).not.toHaveBeenCalled()`, the test passes without exercising `HIGH_EVENT_RISK`. (Direct `HIGH_EVENT_RISK` suppression was later independently tested in `stage_d_pipeline.test.ts:350-425`.)
- **Recommended Correction:** Align timestamps in `worker.test.ts:50-82` and assert `risk_decisions.reason_code === 'HIGH_EVENT_RISK'`.
- **Regression Test Required:** Self-correcting assertion in `src/__tests__/worker.test.ts`.

### AUD-D1-11: Unprovisioned Remote D1/Secrets, Free-Tier TwelveData Rate Exposure, and Unpruned `economic_events`
- **Severity:** **MEDIUM**
- **Affected Files & Lines:** `axnna-web/wrangler.toml:25, 40, 59`; `axnna-web/src/worker.ts:277-281`; `axnna-web/src/ops/telemetry.ts:356-431`
- **Actual Behavior:**
  1. Remote D1 databases (`REPLACE_WITH_STAGING_D1_DATABASE_ID`, `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID`), Cloudflare secrets, and Telegram webhooks are unprovisioned.
  2. Polling `4 x 2 = 8` TwelveData feeds every 5 minutes (`"*/5 * * * *"`) produces up to `2,304` calls per 24 hours (`~1,600–1,700` on active FX market hours), exceeding TwelveData's basic free tier (`800` calls/day, `8`/min) unless backed by a paid plan or throttled `1H` fetches.
  3. `pruneOperationalTables` never prunes `economic_events`, allowing unbounded table growth (and triggering `AUD-D1-01`).
- **Recommended Correction:** Provision staging first with confirmed TwelveData plan capacity (or optimize `1H` polling to hourly boundaries / >15m intervals) and add bounded `>90d` pruning for `economic_events`.
- **Regression Test Required:** Retention test for `economic_events` pruning.

### AUD-D1-12: Missing Request Body Size Limits on Secondary Admin/Webhook JSON Endpoints
- **Severity:** **LOW**
- **Affected Files & Lines:** `axnna-web/src/worker.ts:1532, 1775`; `axnna-web/src/admin/routes.ts:217, 628, 649, 679, 740, 767, 788`
- **Actual Behavior:** While `/api/feedback` (8KB) and `/api/analytics/event` (4KB) use `readJsonBodyWithLimit`, the Telegram webhook and Admin/Backtest POST handlers call bare `await request.json()`.
- **Recommended Correction:** Apply `readJsonBodyWithLimit` (e.g., 16KB–64KB) uniformly.

### AUD-D1-13: Missing `tsx` Dependency for `npm run test:live`, Missing Local Multi-Pair Dataset, and Root Non-`/assets/*` Static Fallbacks
- **Severity:** **LOW**
- **Affected Files & Lines:** `axnna-web/package.json:13`; `axnna-web/scripts/.cache/`; `axnna-web/src/worker.ts:193-201`
- **Actual Behavior:** `npm run test:live` invokes `npx tsx` without `tsx` in `devDependencies`; local Wrangler D1 `market_candles` has `0` rows; `.cache/` lacks `GBPUSD` and `XAUUSD`; missing files outside `/assets/*` (e.g. `/missing.png`) receive SPA HTML under `not_found_handling = "single-page-application"`, whereas `/assets/*.js` properly returns `404`.
- **Recommended Correction:** Add `tsx` to `devDependencies` (or update `test:live` to bundle via `esbuild`), accumulate staging D1 data across all 4 pairs, and extend the `404` HTML-fallback guard to common static file extensions (`.png`, `.ico`, `.svg`, `.css`, `.js`, `.json`, `.txt`).

### AUD-D1-14: Non-Atomic `checkD1RateLimit` Increment & Duplicate Pairing Audit Row on Concurrent Webhook Retries
- **Severity:** **LOW**
- **Affected Files & Lines:** `axnna-web/src/ops/telemetry.ts:307-345`; `axnna-web/src/worker.ts:1722-1738`
- **Actual Behavior:** `checkD1RateLimit` reads then updates in separate queries; `processTelegramConnection` writes `audit_events` even if `UPDATE telegram_connection_sessions ... WHERE status = 'PENDING'` modified `0` rows during concurrent webhook retries.
- **Recommended Correction:** Use single-statement conditional SQL upsert for `checkD1RateLimit` and verify `meta.changes > 0` before inserting `TELEGRAM_CONNECTION_COMPLETED`.

### AUD-D1-15: Recent Branding Changes Not Yet Reflected in `STAGE_D_IMPLEMENTATION_REPORT.md` Inventory
- **Severity:** **LOW**
- **Affected Files & Lines:** `docs/reports/STAGE_D_IMPLEMENTATION_REPORT.md`; `axnna-web/src/components/AxnnaLogo.tsx`; `axnna-web/public/favicon-32x32.png`; `axnna-web/public/apple-touch-icon.png`
- **Actual Behavior:** Post-Stage-D branding updates (`AxnnaLogo.tsx`, `favicon.svg`, PNG icons, `App.tsx`, `index.css`, `index.html`) were implemented cleanly after `STAGE_D_IMPLEMENTATION_REPORT.md` was written. All builds and tests already passed cleanly with them included.

### AUD-D1-16: Strategy Rules Preserved; Local Historical Sample Remains Unsuitable for Profitability Claims
- **Severity:** **INFORMATIONAL**
- **Affected Files & Lines:** `axnna-web/src/core-engine/StrategyEngine.ts`; `axnna-web/src/core-engine/ScoringModel.ts`; `axnna-web/scripts/.cache/`
- Confirmed zero alterations to `StrategyEngine` rules, `ScoringModel` weights, `65` threshold, `EURUSD`/`GBPUSD`/`USDJPY`/`XAUUSD`, `1H`/`5M`, or completed-candle filtering. Local `.cache/` datasets contain `EURUSD` and `USDJPY` (~`52` days `5M`, `~5,000–15,000` bars) and lack `GBPUSD` and `XAUUSD`.

---

## 7. Risk Gate Assessment

`evaluateRiskGate` (`src/engine/RiskGate.ts:50-212`) deterministically enforces: `UNSUPPORTED_INSTRUMENT`, `INVALID_STRATEGY_STATE`, `MISSING_MARKET_DATA`, `INVALID_SETUP_STATUS`, `SCORE_BELOW_THRESHOLD` (`< 65`), `STALE_SIGNAL`, `INVALID_SETUP_GEOMETRY` (LONG `stop < entry < target`, SHORT `target < entry < stop`), `INSUFFICIENT_RR` (`< 1.0`), `DUPLICATE_ALERT`, `HIGH_EVENT_RISK`, and `FUNDAMENTAL_DATA_UNAVAILABLE`.
- **Single Entry Point Verified:** All live setup deliveries and paper trade registrations route solely through `worker.runStrategyEngine` -> `evaluateRiskGate` (`worker.ts:511`). No alternate API route can create signals, alerts, or paper trades.
- **Defects Identified (`AUD-D1-01`, `AUD-D1-02`):** Production caller omits `requireFundamentalAvailability: true`, uses `latestCompletedCandleMs` instead of wall-clock time without `maxMarketStalenessMs`, masks calendar failures behind legacy `economic_events` rows (`line 1618`), and silently catches DB errors when writing `risk_decisions` (`lines 566-568`).

---

## 8. Paper Trading Assessment

- **Account & Idempotency:** `ensureDefaultPaperAccount` uses `INSERT OR IGNORE`; `registerPaperTradeFromApprovedSignal` uses deterministic IDs (`paper_${setupId}`) and `UNIQUE(signal_id)`.
- **Fill / Ambiguity Logic:** Enforces strictly future candle evaluation (`c.timestamp > last_evaluated_candle_timestamp` and `> signal_timestamp`), blocks same-bar fill+exit (`line 289`), invalidates on pre-fill stop breach, and applies conservative stop-first tie-breaking when both target and stop hit in the same `5M` bar (`lines 321-323`).
- **Defects Identified (`AUD-D1-03`, `AUD-D1-04`, `AUD-D1-06`):** Non-atomic balance/trade updates, signal-timestamp-ordered equity curve/drawdown calculation, `startingBalance` config edits breaking balance reconciliation, expiry checked after `entryHit`/`stopPreHit`, and `signals.status` overwrite corrupting recap/KPI metrics.

---

## 9. Financial Calculation Verification

Independently traced `EURUSD` (`pipSize 0.0001`), `GBPUSD` (`0.0001`), `USDJPY` (`0.01`), and `XAUUSD` (`0.1`) across `LONG` and `SHORT`:
- **Trade P&L & Cost Math (`PaperTradingEngine.ts:340-350`):**
  - Entry slippage shifts `entryPrice` unfavorably (`intended_entry + slippageRaw` LONG, `- slippageRaw` SHORT); stop slippage shifts `exitPrice` unfavorably; target exit receives no positive slippage (`exitPrice = target_price`).
  - `initialRiskRaw = |entryPrice - stop_loss|` is measured from **actual fill price** (`entryPrice`), `costRaw = (spread_pips + commission_pips) * pipSize`, `rMultiple = grossR - costR`, and `netPnl = rMultiple * risk_amount`.
  - **Example (`EURUSD LONG`, `entry=1.1000`, `stop=1.0950`, `target=1.1100`, `risk=$100`):** `slip=0.5p (0.00005)` -> `entryPrice=1.10005`, `initialRiskRaw=0.00505 (50.5p)`. Win at `1.1100`: `grossR = 0.00995/0.00505 = 1.9703R`, `costR = 0.00015/0.00505 = 0.0297R`, `rMultiple = 1.9406R`, `netPnl = $194.06`. Loss at `1.0950 - 0.00005`: `grossR = -0.00510/0.00505 = -1.0099R`, `netPnl = -$103.96`. Identical formula across all 4 `pipSize` definitions.
- **Unrealized P&L (`lines 498-510`):** Uses latest `5M` D1 close (`mark - halfSpread` LONG / `+ halfSpread` SHORT); note entry half-spread/commission remainder (~`1.0` pip) is only deducted upon realize.
- **Portfolio Reconciliation Defects (`AUD-D1-03`):** Valid per-trade math is compromised at portfolio level by entry-ordered `equityCurve` / `maxDrawdown`, non-atomic balance update, and non-reconciled `starting_balance` updates. Also `profitFactor` returns `null` (not `Infinity`) when `grossLossAbs === 0` (`line 595`, handled gracefully in UI as `'-'`).

---

## 10. Look-Ahead Bias Assessment

- **`StrategyEngine`:** Processes completed candles sequentially; HTF/LTF swing detection confirms pivots only after `n` subsequent bars (`lines 185-197`, `236-250`); `MarketDataValidator` filters `isCompleted === true`. Zero lookahead detected.
- **`PaperTradingEngine`:** Rejects candles `<= signal_timestamp` (`line 242`) and `<= last_evaluated_candle_timestamp` (`line 195`) and skips same-candle exit on fill (`line 289`). Pending-order expiry bug (`AUD-D1-06`) is an expiration-ordering issue, not future-data leakage.
- **`BacktestEngine`:** Slices strictly `availableHTF <= currentTimestamp` and `ltf.slice(0, i + 1)` (`lines 309-310`), zero lookahead.

---

## 11. Backtest Consistency

`BacktestEngine.ts` and `PaperTradingEngine.ts` share `getInstrumentCosts`, identical bid/ask midpoint approximations (`± halfSpread`), identical slippage application on limit fill and stop exit, identical `initialRiskRaw = |actualEntry - stop|` formula, identical stop-first tie-breaking, and identical 15m pending expiry—with **intentional** divergence (`RiskGate` event-risk gating and multi-position concurrency vs single-position `BacktestEngine`). However, **`AUD-D1-05`** renders `/api/dev/backtest` HTTP execution inconsistent with `BacktestEngine` defaults until cost overrides in `worker.ts:1840-1842` are fixed.

---

## 12. Database and Concurrency Assessment

- Schema (`0001`–`0010`) uses proper foreign keys (`signal_id`, `account_id`, `axnna_user_id`), unique constraints (`paper_trades.signal_id`, `risk_decisions.signal_id`, `(signal_id, axnna_user_id, channel)`, `daily_recap_deliveries(recap_date, axnna_user_id)`), and `CHECK` enums.
- Atomic lease `sync_leases` (`telemetry.ts:248-264`) uses conditional `INSERT ... ON CONFLICT DO UPDATE WHERE expires_at <= excluded.acquired_at`.
- Remaining gaps: `AUD-D1-03` (non-atomic balance update), `AUD-D1-07` (`runDailyRecap` / manual retry overlap), `AUD-D1-08` (800 unbatched candle writes), `AUD-D1-11` (`economic_events` unpruned), `AUD-D1-14` (`checkD1RateLimit` & concurrent `/start` audit).

---

## 13. Market Data Assessment

`TwelveDataMarketProvider` (`src/providers/MarketProvider.ts`) enforces UTC (`timezone=UTC`, `+ 'Z'`), computes `isCompleted = now >= timestamp + timeframeMs`, bounds requests with `8s` timeout and `3` attempts (`401`/`403` fail immediately without retry), sanitizes secrets in error logs (`worker.ts:91-95`), and passes through `MarketDataValidator` rejecting `NaN`, non-positive prices, inverted OHLC, duplicate timestamps, and uncompleted candles. Missing `TWELVEDATA_API_KEY` fails closed cleanly preserving stale D1 `last_successful_fetch`.

---

## 14. Telegram Assessment

Pairing (`POST /api/telegram/session` + `10m` expiry + `/start <token>` webhook claim), constant-time `X-Telegram-Bot-Api-Secret-Token` validation (`503` if unset, `401` on mismatch), delivery classification (`SENT`, `PERMANENT_FAILURE` on `400/401/403`, exponential `RETRY_SCHEDULED` up to `5` attempts -> `EXHAUSTED`), `/status`, `/recap`, and command rate limiting (`10/5m`) are implemented cleanly. Exceptions are **`AUD-D1-04`** (recap missing transitioned paper-trade signals), **`AUD-D1-07`** (21:00 UTC overlap / manual retry race), and **`AUD-D1-14`**.

---

## 15. Admin and User Experience Assessment

All 11 tabs (`Overview`, `Users`, `Market Data`, `Signals`, `Telegram`, `Paper Trading`, `Analytics`, `Security`, `System Health`, `Config & Inbox`, `Audit Log`), `/status`, `/contact`, `/connect-telegram`, legal routes, and brand assets ([AxnnaLogo.tsx](file:///home/madede/BAGOMWA/PROJECTS/Axnna/axnna-web/src/components/AxnnaLogo.tsx), [favicon.svg](file:///home/madede/BAGOMWA/PROJECTS/Axnna/axnna-web/public/favicon.svg)) load real persisted data without mock arrays or secret exposure. Pagination, reset button, and KPI accuracy require remediation per **`AUD-D1-03`**, **`AUD-D1-04`**, and **`AUD-D1-09`**.

---

## 16. Security Assessment

Verified strong across every security boundary:
- Constant-time passphrase comparison (`SHA-256` + `constantTimeEqual`), HMAC-SHA256 `HttpOnly` `SameSite=Strict` cookies requiring dedicated `>=32`-char `ADMIN_SESSION_SECRET` (zero fallback secrets), `revoked_admin_sessions` nonce revocation, `admin_session_version` rotation, and 5-attempt / 15-minute D1 login lockout (`429`).
- Origin allowlist + `X-Requested-With: AxnnaAdmin` CSRF enforcement on all admin mutations.
- Privacy-safe HMAC actor hashing (`extractClientIp` ignoring spoofable headers outside local dev) and strict `ANALYTICS_EVENTS` / SQLite UTC normalization.
- Remaining minor gap: **`AUD-D1-12`** (`readJsonBodyWithLimit` coverage on remaining POST handlers).

---

## 17. Deployment Assessment

`wrangler.toml` isolates development, `[env.staging]`, and `[env.production]`, configures `[assets]` with `run_worker_first = true` + `single-page-application`, and enforces separate crons. `cd.yml` validates D1 UUIDs are not `REPLACE_WITH_*` before deploying. Unresolved operational risks: remote provisioning remains unexecuted, `AUD-D1-11` (`8` feeds / `5m` vs free TwelveData quota), and `AUD-D1-13` (missing root static-extension 404 handling outside `/assets/`).

---

## 18. Test Quality and Actual Test Results

Independently executed inside `axnna-web/` on current working tree:
- `npm run typecheck`: **PASS** (0 errors)
- `npm run lint`: **PASS** (0 errors)
- `CI=1 npm test`: **PASS** (`Test Files 17 passed (17)`, `Tests 82 passed (82)`, 0 skipped)
- `npm run build`: **PASS** (`2335 modules transformed`, `built in 9.98s`)

Test quality observations:
- `stage_d_pipeline.test.ts`, `database_migrations.test.ts`, `stage_c2_remediation.test.ts`, `stage_c2_miniflare_routing.test.ts`, `StrategyState.test.ts`, and `stage_c_ui.test.tsx` exercise real SQLite D1, Miniflare worker+assets runtime, and React DOM interactions meaningfully (with standard `ResizeObserver`/`matchMedia` `jsdom` shims for `glisse`).
- Defect found in **`worker.test.ts:45-95` (`AUD-D1-10`)**: false-positive suppression test checks `HIGH EVENT RISK` only via `fetchMock` non-call while actually hitting `STALE_SIGNAL`.

---

## 19. Live Integration Evidence

- **Observed / Verified:** No unnecessary live API calls were initiated during this audit. Prior Stage D bundled execution of `scripts/verify_live_provider.ts` verified live TwelveData HTTP retrieval of `2` completed `EURUSD` `5M` candles using the key in `.dev.vars` (which exits non-interactively only via `esbuild` bundle because `tsx` is absent from `devDependencies`).
- **Local-Only (Unverified Live):** Live D1 candle ingestion under production Worker cron, live `biquote.io` / `faireconomy` fetching inside deployed Workers, outbound live Telegram Bot API alerts, live webhook invocation from Telegram servers, and Admin cookies over TLS on `axnna-staging.madede.workers.dev` / `axnna.madede.workers.dev`.

---

## 20. Release Gate Table

| Area | Decision | Evidence / Basis |
| :--- | :---: | :--- |
| Git integrity | **PASS** | `main` (`e1adc44`, ahead 1 of `origin/main`), clean uncommitted working tree, secrets gitignored |
| Database integrity | **FAIL** | `AUD-D1-02`, non-atomic balance update (`AUD-D1-03`), unpruned `economic_events` (`AUD-D1-11`) |
| Market data | **PASS** | `MarketProvider.ts` + `MarketDataValidator` UTC/completion checks & fail-closed behavior |
| Strategy-state reliability | **PASS** | Incremental replay, state schema/version validation, restart preservation (`StrategyState.test.ts`) |
| Strategy preservation | **PASS** | Zero strategy/weight/threshold (`65`)/pair/timeframe changes verified |
| Fundamental context | **FAIL** | `AUD-D1-01` (`worker.ts:1618` stale `eventsArr.length > 0` bug & `getConfluence` `'UNKNOWN'` -> `'NEUTRAL'`) |
| Risk Gate | **FAIL** | `AUD-D1-01` (calendar `'UNKNOWN'` + stale candle approval) & `AUD-D1-02` (swallowed SQL errors) |
| Paper Trading | **FAIL** | `AUD-D1-03`, `AUD-D1-04`, `AUD-D1-06` |
| Financial calculations | **FAIL** | `AUD-D1-03` (entry-ordered drawdown/equity + starting-balance divergence) & `AUD-D1-05` (`0.00015` pips) |
| Backtest consistency | **FAIL** | `AUD-D1-05` & `AUD-D1-06` |
| Telegram | **FAIL** | `AUD-D1-04` (Daily Recap skips `TARGET_HIT`/`STOP_HIT` alerted trades) & `AUD-D1-07` (`21:00 UTC`/retry race) |
| Admin | **FAIL** | `AUD-D1-03`, `AUD-D1-04`, `AUD-D1-09` (pagination/summary filter mismatch & missing UI reset button) |
| User experience | **PASS** | Branding, routes, Status, Contact, ConnectTelegram, Legal & Console UI verified |
| Security | **PASS** | HMAC session, lockout, revocation, CSRF, webhook secret & SQLi/traversal boundaries verified |
| CI/CD | **PASS** | `ci.yml` gates & `cd.yml` D1 placeholder guard verified |
| Staging readiness | **FAIL** | Blocked by High findings `AUD-D1-01`–`AUD-D1-05` plus remote D1/secret provisioning |
| Documentation | **PASS** | Architecture, workflow, ingestion, Telegram & runbook docs align with codebase (`AUD-D1-15` minor lag) |

---

## 21. Staging Readiness Verdict

**NOT READY**  
While no critical security vulnerability exists, five High-severity defects (`AUD-D1-01` through `AUD-D1-05`) affect Risk Gate fail-closed guarantees, Paper Trading financial reconciliation, Daily Recap accuracy, and Backtest cost scaling. These must be fixed in a consolidated remediation pass before creating and deploying the remote `axnna-staging` environment.

---

## 22. Production Readiness Verdict

**NOT READY**  
Production remains blocked on: (1) Stage D.2 remediation of High/Medium findings, (2) remote Cloudflare D1 provisioning and secret uploads for staging & production, (3) sustained live staging simulation across all 4 pairs (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`) with verified TwelveData plan capacity, (4) live Telegram webhook/alert/recap smoke testing, and (5) final release sign-off.

---

## 23. Prioritized Remediation Requirements (Next Consolidated Stage D.2 Pass)

1. **P0 — Fix `RiskGate` & Calendar Availability (`AUD-D1-01`, `AUD-D1-02`):** Enforce recent calendar health (`calHealthStatus === 'HEALTHY'`) instead of unpruned `eventsArr.length > 0`; fail closed when `'UNKNOWN'` (or explicitly gate via `requireFundamentalAvailability: true`); pass wall-clock `nowMs: Date.now()` and `maxMarketStalenessMs` in `worker.runStrategyEngine`; remove broad `catch {}` swallowing around `risk_decisions` persistence.
2. **P0 — Fix Paper Trading Reconciliation, Equity Ordering & Signal KPI Preservation (`AUD-D1-03`, `AUD-D1-04`, `AUD-D1-06`):** Batch balance + trade + signal updates atomically with `env.DB.batch`; compute `equityCurve` and `maxDrawdown` ordered chronologically by `exit_timestamp ASC, id ASC`; reconcile `current_balance` on `starting_balance` updates; include paper lifecycle statuses in Daily Recap and Admin `totals` SQL; evaluate pending-order `15m` expiry before fill/invalidation.
3. **P0 — Fix `/api/dev/backtest` Cost Defaults (`AUD-D1-05`):** Remove `0.00015`/`0.00005` decimal cost overrides and validate numeric overrides cleanly.
4. **P1 — Harden Concurrency, Performance & Admin UX (`AUD-D1-07`, `AUD-D1-08`, `AUD-D1-09`, `AUD-D1-11`):** Coordinate `runDailyRecap` and atomic delivery retries; batch `market_candles` upserts (`env.DB.batch`); fix filtered Paper Trading pagination/summaries and add confirmed Reset Account UI; prune stale `economic_events`; add regression test fixes including `worker.test.ts` (`AUD-D1-10`).
5. **P2 — Hardening & Polish (`AUD-D1-12`–`AUD-D1-15`):** Apply `readJsonBodyWithLimit` across remaining POST routes, add `tsx` devDependency or bundle `test:live`, guard root static extensions against SPA HTML fallback, atomic `checkD1RateLimit` & `/start` audit guard, and sync report inventory.
