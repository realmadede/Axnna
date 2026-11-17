# AXNNA STAGE C.1: INDEPENDENT IMPLEMENTATION, SECURITY AND QUALITY AUDIT

**Repository:** `realmadede/Axnna`  
**Audit Date:** 2026-11-17  
**Branch Audited:** `main` (`e1adc44`, uncommitted Stage B + Stage C working tree)  
**Audit Mode:** Strictly read-only (zero source, test, config, or remote changes made)

---

## 1. Executive Summary

Stage C substantially delivered a unified Cloudflare Worker + Static Assets configuration, separated `development`/`staging`/`production` environment blocks, D1 operational migration `0008_stage_c_operations.sql`, public `/status` and `/contact` functionality, interactive Telegram `/status` and `/recap` commands, scheduled daily recap delivery, and an 11-tab Admin Operations Console (`/config`) backed by real D1 queries and zero fallback secrets. The core trading strategy (`StrategyEngine`, `ScoringModel`, 65-point threshold, `1H`/`5M` completed candles, four FX/metals instruments) and marketing landing page visual design remain intact without regression.

However, independent inspection identified **0 CRITICAL**, **6 HIGH**, **7 MEDIUM**, **5 LOW**, and **2 INFORMATIONAL** findings that affect reliability, observability accuracy, analytics integrity, CI/CD independence, and operational readiness prior to Stage D live provisioning:

- **Analytics ingestion (`POST /api/analytics/event`)** lacks rate limiting, payload size caps, retention pruning, and server-side separation of conversion events, enabling unauthenticated metric inflation and D1 growth (`FND-01`).
- **Admin overview KPIs and tabs** silently cap D1 queries at `LIMIT 30`/`50`/`100` without server-side totals or pagination, causing KPI cards and Paper Trading visibility to under-report once row counts exceed those caps (`FND-02`).
- **Mixed SQLite `CURRENT_TIMESTAMP` vs UTC ISO-8601 string parsing** shifts `last_successful_fetch` freshness and displayed admin timestamps in non-UTC timezones (`new Date('YYYY-MM-DD HH:MM:SS')`), falsely triggering `>30m` stale health degradation locally (`FND-03`).
- **`runDailyRecap` (`0 21 * * *` UTC)** conflates failure with `'SUCCEEDED'` job completion when deliveries fail, lacks automated retry/timezone configurability, and counts risk-gated `ALERT_ELIGIBLE` setups alongside `ALERTED` signals (`FND-04`).
- **CD pipeline placeholder guard** blocks `staging` deployment if `production` still holds `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID` and omits GitHub `environment:` protection (`FND-05`).
- **`docs/deployment/D1_PROVISIONING.md`** lists four non-existent migration filenames (`0002`–`0005`), and **`POST /api/config/sync`** always returns `200 OK` / green UI success even when TwelveData fails (`FND-06`).

**Stage C Overall Status:** **COMPLETE WITH DEFECTS (REMEDIATION RECOMMENDED BEFORE STAGE D LIVE SIMULATION)**

---

## 2. Repository Baseline

Verified directly via read-only Git commands:

- **Workspace Path:** `/home/madede/BAGOMWA/PROJECTS/Axnna`
- **Current Branch:** `main`
- **HEAD Commit:** `e1adc44` (`feat: add CI/CD, free calendar, Telegram alerts, and /config admin console`)
- **Remote Tracking Branch:** `origin/main` at `791ebde` (`Initialized the backend Logic and the core functionality (#1)`)
- **Ahead/Behind State:** `main...origin/main [ahead 1]`
- **Local Branches:** `main` only
- **Remote Branches:** `remotes/origin/main` (`791ebde`), `remotes/origin/phase-7-work` (`43862cb`)
- **Sensitive/Generated Tracked Files Check:** `.env.example` tracked; `.env`, `.dev.vars`, and `*.sqlite` are NOT tracked. `axnna-web/tsconfig.tsbuildinfo` is staged for deletion (`D axnna-web/tsconfig.tsbuildinfo`).

---

## 3. Git State

The working tree carries combined uncommitted Stage B and Stage C work on top of `e1adc44`:

- **Staged changes:** `D axnna-web/tsconfig.tsbuildinfo`
- **Modified tracked files (30 files, `5835 insertions(+), 1167 deletions(-)`):**
  - Config/CI: `.env.example`, `.github/workflows/ci.yml`, `.github/workflows/cd.yml`, `axnna-web/wrangler.toml`, `axnna-web/package.json`, `axnna-web/package-lock.json`
  - Core Engine & Providers: `axnna-web/src/core-engine/StrategyEngine.ts`, `Types.ts`, `axnna-web/src/providers/MarketProvider.ts`
  - Worker & Admin: `axnna-web/src/worker.ts`, `axnna-web/src/admin/auth.ts`, `axnna-web/src/admin/routes.ts`
  - Frontend: `axnna-web/src/App.tsx`, `src/index.css`, `src/pages/Config.tsx`, `src/pages/ConnectTelegram.tsx`, `src/pages/Contact.tsx`
  - Tests & Docs: `src/__tests__/admin.test.ts`, `src/__tests__/worker.test.ts`, `src/core-engine/__tests__/*.ts`, `src/providers/__tests__/MarketProvider.test.ts` (and `D LiveMarketProvider.test.ts`), `tests/market_intelligence.test.ts`, `tests/telegram.test.ts`, `axnna-web/docs/architecture.md`, `data-ingestion.md`, `telegram-flow.md`, `docs/WORKFLOW.md`
- **Untracked files/directories:**
  - `axnna-web/migrations/0007_stage_b_integrity.sql`, `axnna-web/migrations/0008_stage_c_operations.sql`
  - `axnna-web/scripts/verify_live_provider.ts`
  - `axnna-web/src/core-engine/__tests__/StrategyState.test.ts`
  - `axnna-web/src/ops/` (`telemetry.ts`), `axnna-web/src/pages/Status.tsx`, `axnna-web/src/utils/` (`analytics.ts`)
  - `axnna-web/tests/database_migrations.test.ts`, `axnna-web/tests/helpers/`, `axnna-web/tests/stage_c_operations.test.ts`, `axnna-web/tests/stage_c_ui.test.tsx`
  - `docs/deployment/`, `docs/reports/`
- **Root `.gitignore` gap (`/.gitignore:1-32`):** Root `.gitignore` omits `.dev.vars` and `*.tsbuildinfo`; only `axnna-web/.gitignore` ignores `.dev.vars` and `*.tsbuildinfo`.

---

## 4. Stage B Dependency Verification

Independent inspection of the Stage B foundation underlying Stage C:

- **Database integrity (`0007_stage_b_integrity.sql`):** Verified PASS. `signals` supports all 11 lifecycle statuses (`DETECTED`, `QUALIFIED`, `REJECTED`, `EXPIRED`, `ALERT_ELIGIBLE`, `ALERTED`, `PENDING_ENTRY`, `ACTIVE_TRADE`, `TARGET_HIT`, `STOP_HIT`, `INVALIDATED`) with nullable `entry`, `structural_stop`, `structural_target`, `structural_rr`. `notification_deliveries` supports retry states with `UNIQUE(signal_id, axnna_user_id, channel)`. Foreign keys and indexes (`idx_signals_instrument_generated`, `idx_signals_status`, `idx_notification_deliveries_retry`) are intact.
- **Strategy state (`StrategyEngine.ts:32-145`, `worker.ts:356-417`):** Verified PASS for serialization, schema/strategy version validation, completed-candle filtering, and deterministic rebuild. **Limitation identified (`FND-09`):** No distributed D1 lock prevents overlapping `CRON_SYNC` and `MANUAL_SYNC` runs from racing on `strategy_state` read-modify-write.
- **Market provider (`MarketProvider.ts:1-234`):** Verified PASS for fail-closed missing/placeholder `TWELVEDATA_API_KEY`, 401/403 immediate throw, 429 retry handling, 8s timeout, UTC timestamp parsing, and `isCompleted` checking.
- **Telegram (`worker.ts:725-1041, 1143-1255, 1312-1374`):** Verified PASS for constant-time webhook secret validation (`503` when unset), payload/sender ID checks, 10m pairing expiry, atomic `WHERE id = ? AND status = 'PENDING'` claim, and bounded retry/permanent failure classification (`MAX_DELIVERY_ATTEMPTS = 5`).
- **Admin security (`admin/auth.ts`, `admin/routes.ts:1-355`):** Verified PASS for fail-closed missing secrets (`503`), HMAC-SHA256 cookies, `SameSite=Strict`, D1 revocation nonces, version rotation, `admin_login_attempts` lockout, CSRF (`Origin` + `X-Requested-With: AxnnaAdmin`), and server-side route auth on `/api/config/*`, `/api/signals`, `/api/markets`, `/api/calendar`. **Defect carried over (`FND-08`):** `admin_login_attempts.client_key` persists raw IP strings instead of hashed actor keys.

---

## 5. Deployment Architecture Findings

Verified directly against `axnna-web/wrangler.toml:1-63`, `axnna-web/src/worker.ts:191-199`, `axnna-web/vite.config.ts:1-14`, and Wrangler `3.114.17` internals (`node_modules/wrangler/wrangler-dist/cli.js:78966, 86950, 88320-88363, 155357-155400`) plus `wrangler deploy --dry-run`:

1. **Wrangler `[assets]` compatibility:** Confirmed valid in Wrangler `3.114.17`. `run_worker_first = true` (boolean), `binding = "ASSETS"`, `directory = "./dist"`, and `not_found_handling = "single-page-application"` pass schema validation cleanly, and `wrangler-dist/cli.js:86950` confirms `[assets]` is `inheritable` across `[env.staging]` and `[env.production]`.
2. **`wrangler deploy --dry-run` (default & `--env staging`):** Bundled `worker.js` (`140.72 KiB` / `32.34 KiB` gzip) and built `dist/` (`17` output assets) with zero config warnings.
3. **API routing & fallthrough (`worker.ts:95-199`):** Confirmed `/api/status`, `/api/feedback`, `/api/analytics/*`, `/api/telegram/*`, `/api/fundamentals/*`, `/api/dev/backtest`, `/api/auth/config*`, `/api/config/*`, `/api/markets`, `/api/calendar`, `/api/signals` route exclusively to Worker handlers, and unmatched `/api/*` returns `404` JSON (`{"error":"Not Found"}`). Minor path-prefix defect: `url.pathname.startsWith('/api')` matches non-API prefixes like `/apiary` (`FND-15`).
4. **Same-origin cookies & CORS (`admin/auth.ts:138-159`, `worker.ts:55-87`):** Unified origin allows same-origin `SameSite=Strict` cookies (`Secure` set whenever `url.protocol === 'https:'`) without relying on cross-origin credentials. Local dev (`vite.config.ts:7-11`) proxies `/api` from `5173` to `127.0.0.1:8787` cleanly over HTTP (`Secure` omitted on `http://`).
5. **Missing live runtime proof (`FND-11`):** While static bundling succeeded in `--dry-run`, missing static asset `404` vs SPA `200` behavior was only verified against a `vi.fn` mock of `env.ASSETS` (`stage_c_operations.test.ts:47-56`), not against real Miniflare/Wrangler runtime asset serving.

---

## 6. Environment Configuration Findings

- **Separated environments (`wrangler.toml:15-63`):** `development` (`axnna-web`, `axnna_db`), `staging` (`axnna-staging`, `axnna_db_staging`, `ALLOWED_ORIGINS = "https://axnna-staging.madede.workers.dev"`), and `production` (`axnna`, `axnna_db_production`, `ALLOWED_ORIGINS = "https://axnna.madede.workers.dev"`) define non-inherited `vars`, `d1_databases`, and `triggers`. Neither staging nor production silently inherits `local-db-id`.
- **Staging/Production D1 Placeholders:** Both `REPLACE_WITH_STAGING_D1_DATABASE_ID` (`wrangler.toml:40`) and `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID` (`wrangler.toml:59`) remain unprovisioned as expected prior to Stage D.
- **CI/CD workflow defects (`.github/workflows/cd.yml:15-57`, `FND-05`):**
  1. `grep -q "REPLACE_WITH_" wrangler.toml` checks the entire file rather than the target environment block, blocking independent `staging` deployment if `production` is unprovisioned.
  2. No GitHub `environment:` gate protects `production` deployments or scopes `CLOUDFLARE_API_TOKEN`.
- **Documentation drift (`docs/deployment/D1_PROVISIONING.md:5-11`, `FND-06`):** Lists incorrect filenames `0002_economic_calendar.sql`, `0003_market_candles.sql`, `0004_strategy_state.sql`, `0005_system_config_and_admin.sql` instead of actual files `0002_market_intelligence.sql`, `0003_data_ingestion.sql`, `0004_strategy_engine.sql`, `0005_strategy_engine_core.sql`.

---

## 7. Migration 0008 Findings

Inspected `axnna-web/migrations/0008_stage_c_operations.sql:1-85` and verified against `axnna-web/migrations/0001`-`0007`:

- **`analytics_events` (lines 3-25):** Supports Admin analytics queries (`visitor_id`, `session_id`, `event_type`, `path`, `referrer`, `utm_source`, `device_category`, `browser_category`, `country_code`, `created_at`). Indexed on `created_at`, `(event_type, created_at)`, and `(visitor_id, created_at)`. No FK or retention policy; subject to unbounded growth (`FND-01`).
- **`security_events` (lines 31-46):** Supports severity (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) and resolution (`OPEN`, `ACKNOWLEDGED`, `RESOLVED`) CHECK constraints and indexes. Stores `actor_id` and JSON `details` (bounded 500 chars).
- **`scheduled_job_runs` (lines 48-59):** Tracks `STARTED`, `SUCCEEDED`, `DEGRADED`, `FAILED`. Uses `.toISOString()` on `started_at`/`finished_at`. Unbounded growth without pruning (`FND-10`).
- **`contact_submissions` (lines 61-73):** Constrains `category` and `status` (`NEW`, `REVIEWED`, `RESOLVED`); stores `client_hash` for rate-limit queries.
- **`daily_recap_deliveries` (lines 75-83):** References `axnna_users(id)` and enforces `UNIQUE(recap_date, axnna_user_id)` and `status IN ('SENT', 'FAILED')`. Missing `retry_count` / `last_error` / `next_retry_at` (`FND-04`).
- **Timestamp format inconsistency (`FND-03`):** Migration `0008` tables default `created_at` to SQLite `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`), whereas `started_at` in `scheduled_job_runs` and `generated_at` in `signals` write ISO-8601 `Z` strings.

---

## 8. Telemetry and Privacy Findings

Inspected `axnna-web/src/ops/telemetry.ts:1-397`:

- **Privacy hashing (`telemetry.ts:15-30`, `FND-08`):** `computePrivacyHash` computes unsalted `SHA-256` truncated to 16 hex chars. Without a server secret HMAC/salt or daily rotation, IPv4 hashes are trivially reversible offline and act as persistent cross-endpoint correlation IDs (`contact_submissions`, `security_events`, `audit_events`). Meanwhile `admin_login_attempts.client_key` (`routes.ts:126-132,185`) stores raw unhashed IPs.
- **Analytics (`worker.ts:617-685`, `utils/analytics.ts:1-51`, `FND-01`, `FND-13`):**
  - Event names constrained to 7 enum values, paths must start with `/` (`<=200` chars), referrer stripped to hostname (`<=120`), UA classified into broad categories (`mobile`/`tablet`/`desktop`/`unknown`, `Edge`/`Chrome`/`Firefox`/`Safari`/`Other`).
  - Unique visitors rely on `COUNT(DISTINCT visitor_id)` where `visitor_id` comes from browser `localStorage` or arbitrary API payloads — cleared browser storage or scripted requests inflate unique visitor counts, and there is no rate limit or body size guard on `POST /api/analytics/event`.
  - Conversion enum values `'REGISTRATION_STARTED'`, `'REGISTRATION_COMPLETED'`, `'ALERT_PREF_UPDATED'`, `'APP_ACTIVITY'` are never emitted by legitimate client/server code paths (`FND-13`), yet are accepted from public POST requests.
- **Secret status (`telemetry.ts:170-182`):** Confirmed `getSecretStatus` exposes only `{ key, configured: boolean, scope }` and rejects placeholder `'your_*'` / `'mock_key'` values. Minor mismatch: `isConfiguredAdminAuth` in `admin/routes.ts:22-29` does NOT reject placeholder `'your_*'` values or short secrets (`FND-16`).
- **System health (`telemetry.ts:191-397`, `FND-03`, `FND-07`):**
  - Database health executes actual `d1_migrations` / `SELECT 1` queries.
  - **Defects in `evaluateSystemHealth`:**
    1. `marketRows.last_successful_fetch` parses SQLite `CURRENT_TIMESTAMP` via `new Date(...)` (`telemetry.ts:253`), shifting timestamps by timezone offset outside UTC and misclassifying fresh local syncs as stale `DEGRADED`.
    2. `provider_health_state` checks calendar `status` without staleness timeout; `recordProviderHealth` (`telemetry.ts:82,85`) sets `'FAILED'` on initial error but `'DEGRADED'` on first error after recovery (inconsistent state machine).
    3. Telegram health (`telemetry.ts:335`) only triggers `'DEGRADED'` when `sent_cnt === 0 && fail_cnt > 0` — any historical sent delivery permanently suppresses degradation alerts even if 100% of recent deliveries fail.
    4. Scheduled job health (`telemetry.ts:357-370`) classifies `'STARTED'` (crashed/orphaned) and stale (>15m unrun) cron jobs as `'HEALTHY'`.
    5. `Application & Admin Auth` returns `lastUpdated: new Date().toISOString()` dynamically (`telemetry.ts:384`), masking lack of real activity.

---

## 9. Worker Endpoint Findings

- **`GET /api/status` (`worker.ts:493-530`):** Returns sanitized `overallStatus` (`OPERATIONAL` | `INITIALIZING` | `DEGRADED`), `checkedAt`, `monitoredInstruments`, and subsystem `{ name, status, lastUpdated }`, stripping `detail`, secret values, and D1 user/signal rows. Inherits `evaluateSystemHealth` defects (`FND-03`, `FND-07`).
- **`POST /api/feedback` (`worker.ts:532-615`):** Validates category enum, message length `10..2000`, optional email or `@telegram` format (`<=120`), honeypot (`website`), hashed-IP `3/hour` limit using SQLite UTC format, and persists cleanly to `contact_submissions`. Honest copy confirms storage ("Your message has been saved and queued for review") without claiming email dispatch. **Remaining gaps (`FND-12`):** No payload byte-size cap prior to `request.json()`, no duplicate-submission suppression within the 3 allowed messages, and `getRequestActorHash` honors client-supplied `X-Forwarded-For` when `CF-Connecting-IP` is absent.
- **`POST /api/analytics/event` (`worker.ts:617-685`):** Unauthenticated, un-rate-limited, no payload byte cap, trusts client-supplied `visitorId` and privileged conversion `eventType` (`FND-01`).
- **Telegram commands (`worker.ts:1247-1310`, `FND-14`):**
  - Authorized strictly via `axnna_users WHERE telegram_user_id = ? AND status = 'CONNECTED'`, excluding disconnected/unregistered users cleanly.
  - `/status EURUSD` reads live `economic_events` + latest `signals` row; `/recap` returns UTC digest or `"Silence is a valid signal."`.
  - **Defect (`FND-14`):** Telegram group-style suffixes (`/status@BotName XAUUSD`, `/recap@BotName`) break exact command matching (`/status` falls back to `EURUSD`; `/recap` is ignored), and connected users have no per-user webhook command rate limit.

---

## 10. Cron and Daily Recap Findings

- **Dual CRON schedules (`wrangler.toml:25`, `worker.ts:202-208`):** `*/5 * * * *` executes `runSynchronization(env, 'CRON_SYNC')`; `0 21 * * *` executes `runDailyRecap(env)`.
- **Timezone & Product Schedule (`FND-04`):** `0 21 * * *` runs strictly at **21:00 UTC** (00:00+1 EAT / 22:00 WAT / 16:00 EST / 17:00 EDT). Strategy specs standardize internally on UTC (`Axnna_Strategy_Specification_Final_v4.md:22`), whereas subscriber local timezones are not modeled and NY Forex rollover occurs at `21:00 UTC` (EDT) / `22:00 UTC` (EST). More importantly, `axnna_users` lacks a separate `daily_recap_enabled` preference, reusing `signal_notifications_enabled = 1`.
- **Idempotency & Failures (`worker.ts:1091-1141`, `FND-04`):**
  - Re-runs on the same `recapDate` skip users already marked `'SENT'` in `daily_recap_deliveries`, preventing duplicate sends across retries for successful users.
  - **Bug:** If `sendTelegramMessage` fails for ALL users (e.g., Telegram 503 or blocked bot), `daily_recap_deliveries` records `'FAILED'`, **there is no automatic retry schedule** (since `0 21 * * *` only runs once per day, so tomorrow `recapDate` changes!), AND `finishJobRun` still marks `DAILY_RECAP` as `'SUCCEEDED'` (`worker.ts:1139`)!
  - **Content discrepancy (`FND-04`):** `buildDailyRecapText` counts `status IN ('ALERTED', 'ALERT_ELIGIBLE')`, mixing risk-gate-suppressed setups (`HIGH EVENT RISK` leaves status as `ALERT_ELIGIBLE`) into the `"Alert-eligible setups"` count rather than clearly separating alerted vs risk-gated setups, and omits the analyzed candle count shown in the Landing preview (`Landing.tsx:180`).

---

## 11. Admin Console Findings

Audited all 11 tabs of `axnna-web/src/pages/Config.tsx:1-1490` and backend `axnna-web/src/admin/routes.ts:356-666`:

| # | Tab | UI Exists | Backend Real Data | Auth Enforced | Defects / Limitations Observed |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Overview** | Yes | Yes | Yes (`401`) | KPI counts read `overview.*.length` on capped `LIMIT 30`/`50`/`100` arrays (`FND-02`) |
| 2 | **Users** | Yes | Yes (`axnna_users`) | Yes (`401`) | Honest Telegram-first subscriber table; shows `analytics.summary.uniqueVisitors` separately in KPI card (not falsely merged), missing pagination (`LIMIT 100`, `FND-02`), toggle ignores nonexistent IDs (`FND-17`) |
| 3 | **Market Data** | Yes | Yes (`market_data_state`, `provider_health_state`) | Yes (`401`) | Displays real `last_completed_candle` & `last_successful_fetch`, but `formatTime` parses SQLite `CURRENT_TIMESTAMP` without `Z` (`FND-03`), `Run Sync Now` shows green success even on sync failure (`FND-06`) |
| 4 | **Signals** | Yes | Yes (`signals`, `strategy_state`) | Yes (`401`) | Shows score, R:R, rejection/macro context; omits `strategy_version` column from main signals table despite fetching it (`Config.tsx:844-872`, `FND-17`) |
| 5 | **Telegram** | Yes | Yes (`notification_deliveries`) | Yes (`401`) | Statuses accurate; bounded `Retry Once` (`RETRY_SCHEDULED` & `<5` attempts) audited; `Config.tsx:941` hardcodes UI retry eligibility to `RETRY_SCHEDULED` while API also allows retrying `FAILED` (`worker.ts:903`) |
| 6 | **Paper Trading** | Yes | Yes (`signals` filtered) | Yes (`401`) | Honest `STAGE_D_PENDING` banner & empty state (zero fake metrics); **bug (`FND-02`)**: derives `paperTrades` by filtering `signals` `LIMIT 50` in memory, dropping older active/completed trades if >50 newer setups exist |
| 7 | **Analytics** | Yes | Yes (`analytics_events`) | Yes (`401`) | 7/30/90d selector, real SQL aggregations (`dailyTrends` is returned by API at `routes.ts:523` though not rendered in UI!); vulnerable to un-rate-limited ingestion (`FND-01`) |
| 8 | **Security** | Yes | Yes (`security_events`) | Yes (`401`) | Filters work; `Resolve` writes `RESOLVED` + audit entry; truncated at `LIMIT 50` (`FND-02`) |
| 9 | **System Health** | Yes | Yes (`evaluateSystemHealth`, `scheduled_job_runs`) | Yes (`401`) | Honest subsystem table + job history; subject to `evaluateSystemHealth` stale/orphan bugs (`FND-03`, `FND-07`) |
| 10 | **Config & Inbox** | Yes | Yes (`system_config`, `strategies`, `contact_submissions`) | Yes (`401`) | Hides secret values cleanly (`configured` boolean only); audits toggles & feedback triage; truncated at `LIMIT 30` (`FND-02`) |
| 11 | **Audit Log** | Yes | Yes (`audit_events`) | Yes (`401`) | Append-only from app (`INSERT` only); truncated at `LIMIT 50` (`FND-02`); mixes UTC `CURRENT_TIMESTAMP` strings (`FND-03`) |

---

## 12. Security Findings

- **Auth & Authorization:** All `/api/config/*`, `/api/signals`, `/api/markets`, `/api/calendar` enforce server-side HMAC session validation + D1 nonce revocation + version check. Failed attempts on `/api/auth/config` fail closed cleanly. No IDOR on admin routes (`axnna-web` uses single admin passphrase role).
- **SQL Injection:** All D1 queries across `worker.ts`, `admin/routes.ts`, and `ops/telemetry.ts` use `.prepare(...).bind(...)` parameterized bindings. No string interpolation of user input in SQL.
- **XSS / HTML Injection:** Frontend pages (`Config.tsx`, `Status.tsx`, `Contact.tsx`, `ConnectTelegram.tsx`) render all dynamic fields via React JSX text nodes with zero `dangerouslySetInnerHTML`.
- **CSRF / CORS:** State-changing `/api/config/*` and `/api/auth/config/logout` check both `isAllowedAdminOrigin` (`Origin`/`Referer`) and `X-Requested-With: AxnnaAdmin`. CORS never emits `Access-Control-Allow-Origin: *`.
- **Rate Limiting & Abuse Surfaces:**
  - `POST /api/analytics/event` has **zero rate limiting, zero body size limit, and accepts spoofable conversion events** (`FND-01`).
  - `POST /api/feedback` rate limits at 3/hour per actor hash, but honors `X-Forwarded-For` when `CF-Connecting-IP` is absent (`FND-12`) and stores up to 3 duplicates.
  - `POST /api/telegram/webhook` authenticates Telegram secret token, but connected users can spam `/status` and `/recap` with no cooldown (`FND-14`).
- **Concurrency & Secrets:** Concurrent cron/manual sync lacks a D1 lock (`FND-09`). Zero secrets leaked in `dist/` bundles or `/api/config/overview` or `/api/status` (verified by `NO_FALLBACK_SECRETS` scan).

---

## 13. Test Quality Findings

Independently ran full verification inside `axnna-web/` during this audit:
- `npm run typecheck`: **Passed** (0 errors)
- `npm run lint`: **Passed** (0 errors, 0 warnings; advisory TypeScript `5.9.3` version warning from `@typescript-eslint/typescript-estree`)
- `npm test`: **Passed** (`14` test files, `68` tests passed in `2.49s` using Vitest `v1.6.1` + `node:sqlite`)
- `npm run build`: **Passed** (`vite build` transformed `2333` modules cleanly in `9.94s`)

Audit of test depth and validity (`FND-11`):
- **Genuine integration tests (strong):** `database_migrations.test.ts` (real schema upgrade + `0007`/`0008` constraints), `admin.test.ts` (real HMAC auth, lockout, CSRF, revocation), `telegram.test.ts` (real pairing, expiry, webhook secret, retry lifecycle), `stage_c_operations.test.ts` (real D1 routing, feedback 429 rate limit + triage, analytics 30d aggregation, security resolution, `provider_health_state`, `scheduled_job_runs`, `/status`, `/recap`, `runDailyRecap` idempotency, manual retry), `StrategyState.test.ts` (real D1 incremental replay).
- **Weak / Missing test coverage (`FND-11`):**
  1. `tests/stage_c_ui.test.tsx` tests ONLY initial synchronous `renderToStaticMarkup` (`Config.tsx` only asserts `html.length > 20` on `"Checking session..."`!). Zero tests render or verify the login screen, 11 authenticated tabs, filters, error states, loading-to-loaded transitions in `Status.tsx` / `Contact.tsx` / `Config.tsx`, or interactive button clicks.
  2. Unified `[assets]` routing test (`stage_c_operations.test.ts:47-80`) uses a mock `env.ASSETS` stub rather than real Wrangler/Miniflare static asset handling.
  3. Zero negative/edge tests exist for `evaluateSystemHealth` stale/orphan `'STARTED'` jobs, `runDailyRecap` when Telegram fails (`503`), `CRON` concurrent execution, or `POST /api/analytics/event` abuse.

---

## 14. Original Product Requirement Regression Findings

Verified via `git diff 791ebde` against `StrategyEngine.ts`, `ScoringModel.ts`, `BacktestEngine.ts`, `MarketData.ts`, `Landing.tsx`, and `Config.tsx`:
- **Strategy logic & parameters:** `ScoringModel.ts`, `BacktestEngine.ts`, `MarketData.ts` have **zero diff** vs `origin/main`. `StrategyEngine.ts` only added `exportState`, `restoreState`, and `processIncremental` while preserving HTF Bias -> Liquidity Reference -> Sweep -> Displacement -> FVG -> Retracement -> Entry -> Structural Target, weights, and `alertScoreThreshold: 65`.
- **Instruments & timeframes:** Preserved (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`; `1H` & `5M`; completed candles only via `isCompleted`).
- **Landing page (`Landing.tsx`):** Single string edit only (`Finnhub Events` -> `Economic Calendar` at line 307); design system and marketing-only isolation preserved. Zero internal secrets or backtest internals leaked on public marketing pages.

---

## 15. Stage D Readiness Assessment

| Prerequisite | Classification | Justification |
| :--- | :--- | :--- |
| 1. Deployment architecture readiness | **READY WITH LIMITATIONS** | `wrangler.toml` `[assets]` + Worker router validated by Wrangler `3.114.17` dry-run; needs real `wrangler dev` runtime verification for missing asset `404` and fix to `/api` prefix check (`FND-11`, `FND-15`). |
| 2. Staging configuration readiness | **BLOCKED** | Staging D1 `database_id` is placeholder `REPLACE_WITH_STAGING_D1_DATABASE_ID` (expected before provisioning), and `.github/workflows/cd.yml:46` fails staging deploy while production placeholder remains (`FND-05`). |
| 3. D1 migration readiness | **READY WITH LIMITATIONS** | `0001`-`0008` apply cleanly on local D1; `D1_PROVISIONING.md` filenames need correction (`FND-06`) and retention pruning is missing (`FND-10`). |
| 4. Secret configuration readiness | **READY WITH LIMITATIONS** | Runtime code fails closed with zero fallbacks and hides secret values cleanly; Cloudflare secrets not yet uploaded to staging/prod, and `isConfiguredAdminAuth` should reject `your_*` placeholders (`FND-16`). |
| 5. Market data synchronization readiness | **READY WITH LIMITATIONS** | `TwelveDataMarketProvider` and `FreeEconomicCalendarProvider` are solid, but sync lacks concurrency lock (`FND-09`), local non-UTC timestamp parsing triggers false staleness (`FND-03`), and manual sync masks failures (`FND-06`). |
| 6. Strategy execution reliability | **READY** | Incremental `strategy_state`, version reset, completed-candle filtering, and deterministic replay are implemented and verified. |
| 7. Telegram integration readiness | **READY WITH LIMITATIONS** | Pairing, secret validation, bounded delivery retry, `/status`, `/recap`, and daily recap idempotency work; daily recap lacks failure retry/status accuracy (`FND-04`), and bot `@username` suffix parsing breaks commands (`FND-14`). |
| 8. Operational monitoring readiness | **READY WITH LIMITATIONS** | All 11 tabs and `/status` exist over real D1 data, but `LIMIT 30/50/100` truncates KPIs & Paper Trading (`FND-02`), `evaluateSystemHealth` masks stale/failed Telegram/cron states (`FND-07`), and `analytics_events` is unprotected (`FND-01`). |
| 9. Risk-gate observability | **READY** | `HIGH EVENT RISK` suppression sets `market_context` and leaves setup `ALERT_ELIGIBLE` visibly distinct from `ALERTED` in Signals tab. |
| 10. Paper trading foundation | **NOT IMPLEMENTED** | Intentionally scoped for Stage D; Stage C honestly marks `STAGE_D_PENDING` without fake trades (`paperTrades` query cap `LIMIT 50` should be widened in Stage D, `FND-02`). |

---

## 16. Findings Ranked by Severity

### FND-01 | HIGH | Unauthenticated `POST /api/analytics/event` lacks rate limiting, body limits, and conversion-event isolation
- **Affected File and Line:** `axnna-web/src/worker.ts:39-47, 617-685`; `axnna-web/migrations/0008_stage_c_operations.sql:3-25`
- **Evidence:** `handleAnalyticsIngest` accepts arbitrary `visitorId` (8–64 chars) and all `ALLOWED_ANALYTICS_EVENTS` (including `'TELEGRAM_CONNECT_COMPLETED'` and `'REGISTRATION_COMPLETED'`) with zero per-IP rate limiting and zero payload size guard.
- **Impact:** Anyone can inflate unique visitor metrics, forge funnel conversion numbers in `/config` Analytics, and grow `analytics_events` unboundedly in D1.
- **Reproduction:** Send 100 `POST /api/analytics/event` requests with `{"eventType":"TELEGRAM_CONNECT_COMPLETED","path":"/connect-telegram","visitorId":"fake_visitor_0001","sessionId":"fake_sess_0001"}` — all return `202` and appear in Admin Analytics as conversions.
- **Recommended Correction:** Reject client-submitted server-milestone events (`TELEGRAM_CONNECT_COMPLETED`, `REGISTRATION_COMPLETED`), enforce a JSON payload byte limit (e.g., 4 KB) + per-IP-hash rate limit, and schedule rolling retention cleanup.

### FND-02 | HIGH | Hardcoded `LIMIT 30/50/100` truncates Admin KPIs, Signals, Paper Trading, and Security visibility
- **Affected File and Line:** `axnna-web/src/admin/routes.ts:389-417, 483-508`; `axnna-web/src/pages/Config.tsx:464-471, 520-546`
- **Evidence:** `/api/config/overview` loads at most `100` users, `50` signals, `50` deliveries, `50` audit events, `50` security events, and `30` contact rows without returning `COUNT(*)` totals or accepting pagination params. `paperTrading.trades` filters the `50`-row `signals` array in JS (`routes.ts:484`), and KPI cards compute counts from `.length` of these truncated arrays.
- **Impact:** Once >50 signals or security events exist, Admin KPI cards (`Signals Generated`, `Open Security Events`, `New Inbox Items`) under-report counts and older active/completed paper trades vanish from the Paper Trading tab.
- **Reproduction:** Insert 51 `REJECTED` signals newer than an `ACTIVE_TRADE` signal; `overview.paperTrading.trades` becomes empty and KPI shows `50`.
- **Recommended Correction:** Query dedicated `COUNT(*)` aggregates for KPI badges, query `paperTrading.trades` directly with `WHERE status IN (...) LIMIT 50`, and add `limit`/`offset` pagination to `/api/config/overview` or per-tab endpoints.

### FND-03 | HIGH | SQLite `CURRENT_TIMESTAMP` strings parsed without `Z` corrupt freshness checks and UI timestamps
- **Affected File and Line:** `axnna-web/src/ops/telemetry.ts:252-257`; `axnna-web/src/worker.ts:287-295`; `axnna-web/src/pages/Config.tsx:195-205`; `axnna-web/src/pages/Status.tsx:24-29`
- **Evidence:** SQLite `CURRENT_TIMESTAMP` writes `'YYYY-MM-DD HH:MM:SS'` without `T`/`Z`. Verified via `node -e "new Date('2026-11-17 14:47:03').toISOString()"` on `+03:00`: JavaScript shifts SQLite `CURRENT_TIMESTAMP` strings by local timezone offset (`-180` min = 3 hours stale).
- **Impact:** `evaluateSystemHealth` falsely marks healthy local `Market Data` syncs as `DEGRADED: Market data is stale (>30m since last fetch)`, and browsers outside UTC display shifted timestamps in Admin Audit, Security, Contact, and Market Data tabs.
- **Recommended Correction:** Normalize SQLite `YYYY-MM-DD HH:MM:SS` strings to UTC (`str.replace(' ', 'T') + 'Z'` when lacking timezone suffix) in a shared parser on both backend `telemetry.ts` and frontend `formatTime()`, or store explicit ISO-8601 `Z` timestamps consistently.

### FND-04 | HIGH | `runDailyRecap` marks failed batches `SUCCEEDED`, lacks retry & recap preference, and conflates risk-gated signals
- **Affected File and Line:** `axnna-web/src/worker.ts:202-206, 1043-1141`; `axnna-web/migrations/0008_stage_c_operations.sql:75-83`
- **Evidence:** (1) `runDailyRecap` logs `finishJobRun(..., 'SUCCEEDED', ...)` at line 1139 even when `sentCount === 0` out of N users due to Telegram API errors. (2) `daily_recap_deliveries` has no automatic retry schedule before UTC midnight changes `recapDate`. (3) `buildDailyRecapText` lumps `ALERT_ELIGIBLE` (including risk-gated `HIGH EVENT RISK` suppressed signals) into `"Alert-eligible setups"` without noting suppressed vs alerted setups, and `0 21 * * *` is fixed to 21:00 UTC with no user timezone or separate recap opt-out toggle.
- **Impact:** Failed daily recaps go undetected in `scheduled_job_runs` and are never retried.
- **Recommended Correction:** Set job status to `'FAILED'` when all deliveries fail (`DEGRADED` on partial failures), add retry support for `'FAILED'` recap rows of the current UTC day, separate `"Alerted"` vs `"Suppressed (Event Risk)"` counts, and confirm 21:00 UTC schedule against target user hours.

### FND-05 | HIGH | CD placeholder check blocks independent staging deploy and omits GitHub Environment protection
- **Affected File and Line:** `.github/workflows/cd.yml:15-57`; `axnna-web/wrangler.toml:40, 59`
- **Evidence:** `cd.yml:46` runs `grep -q "REPLACE_WITH_" wrangler.toml` over the whole file instead of scoping to the selected `inputs.environment`, and job `deploy` lacks `environment: ${{ inputs.environment }}`.
- **Impact:** Provisioning staging D1 alone still fails staging CD because `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID` remains in `wrangler.toml`, while production deploys lack GitHub Environment approval gating.
- **Recommended Correction:** Inspect the target `--env` D1 binding (or `awk` section for `[env.${{ inputs.environment }}]`) and add `environment: ${{ inputs.environment }}` on the `deploy` job.

### FND-06 | HIGH | `D1_PROVISIONING.md` cites wrong migration names, and manual `/api/config/sync` masks sync failures as UI success
- **Affected File and Line:** `docs/deployment/D1_PROVISIONING.md:5-11`; `axnna-web/src/admin/routes.ts:659-663`; `axnna-web/src/pages/Config.tsx:373-391`; `axnna-web/src/worker.ts:210-329`
- **Evidence:** `D1_PROVISIONING.md` names non-existent files `0002_economic_calendar.sql`..`0005_system_config_and_admin.sql`. Separately, `runSynchronization` swallows errors cleanly into `finishJobRun`, so `POST /api/config/sync` returns `200 { ok: true }` and `Config.tsx:384` displays a green success banner even when `TWELVEDATA_API_KEY` is missing or all feeds fail.
- **Impact:** Operators clicking `Run Sync Now` receive a false-positive success notice during provider outages, and operators following `D1_PROVISIONING.md` see incorrect filenames.
- **Recommended Correction:** Fix the filenames in `D1_PROVISIONING.md`, and have `runSynchronization` return its job status (`SUCCEEDED` / `DEGRADED` / `FAILED`) so `/api/config/sync` returns it and `Config.tsx` warns cleanly on `DEGRADED`/`FAILED`.

### FND-07 | MEDIUM | `evaluateSystemHealth` and `recordProviderHealth` misclassify stale cron, failed Telegram, and post-recovery provider errors
- **Affected File and Line:** `axnna-web/src/ops/telemetry.ts:80-90, 278-296, 320-376, 384`
- **Evidence:**
  1. `provider_health_state` inserts `'FAILED'` on a brand-new failure (line 82) vs `'DEGRADED'` on first failure after recovery (`error_count >= 2` -> `'FAILED'`, line 85).
  2. Telegram health (`telemetry.ts:335`) checks `fail_cnt > 0 && sent_cnt === 0`, so 1 old `SENT` row suppresses alerts even if recent deliveries are 100% failing.
  3. Scheduled job health (`telemetry.ts:360-369`) marks `'STARTED'` (crashed) or very old runs as `'HEALTHY'`.
  4. Calendar health (`telemetry.ts:284-290`) omits staleness age checks; App health injects `new Date().toISOString()` on every request.
- **Impact:** Dashboard and `/api/status` can report `HEALTHY`/`OPERATIONAL` despite dead cron triggers, crashed jobs, or failing Telegram delivery.
- **Recommended Correction:** Unify `recordProviderHealth` initial/recovery states, check Telegram failure rate on recent deliveries (`ORDER BY created_at DESC LIMIT 20`), flag `STARTED` jobs >10m old or missing runs >20m as `DEGRADED`/`UNAVAILABLE`, and add calendar staleness checks.

### FND-08 | MEDIUM | Unsalted IP hashing (`computePrivacyHash`) and raw IP storage in `admin_login_attempts.client_key`
- **Affected File and Line:** `axnna-web/src/ops/telemetry.ts:15-30`; `axnna-web/src/admin/routes.ts:126-132, 185`
- **Evidence:** `computePrivacyHash` runs unsalted `SHA-256(raw).slice(0, 16)`, while `admin_login_attempts.client_key` stores the raw IP string unhashed in D1.
- **Impact:** Unsalted IPv4 hashes are trivially brute-forceable offline and link actors indefinitely across endpoints, contradicting `SECRETS_AND_SECURITY.md` ("Raw IP addresses ... are never stored in D1").
- **Recommended Correction:** Compute HMAC-SHA256 keyed with a server secret (e.g. `ADMIN_SESSION_SECRET` or dedicated salt) for `getRequestActorHash` and store hashed `actorHash` in `admin_login_attempts.client_key`.

### FND-09 | MEDIUM | Concurrent `CRON_SYNC` / `MANUAL_SYNC` lacks a D1 execution lock
- **Affected File and Line:** `axnna-web/src/worker.ts:210-329, 356-417`
- **Evidence:** Overlapping cron and manual sync calls both fetch all 8 TwelveData series concurrently and perform unsynchronized read-modify-write on `strategy_state`.
- **Impact:** Double TwelveData API quota burn and potential `strategy_state` last-writer-wins regression.
- **Recommended Correction:** Acquire a lease row (e.g., `system_config` or `scheduled_job_runs` active `'STARTED'` lock with 10-minute expiry) at the start of `runSynchronization`.

### FND-10 | MEDIUM | No automated retention pruning for `analytics_events`, `security_events`, `scheduled_job_runs`, or `audit_events`
- **Affected File and Line:** `axnna-web/migrations/0008_stage_c_operations.sql:3-73`; `axnna-web/src/worker.ts:202-208`
- **Evidence:** Only `revoked_admin_sessions` deletes expired rows on logout (`routes.ts:302-304`). All operational tables grow indefinitely.
- **Impact:** D1 storage growth and slower analytics/admin table scans over months of operation.
- **Recommended Correction:** Prune rows older than configured retention (e.g. 90–180 days) once daily during the `0 21 * * *` scheduled handler.

### FND-11 | MEDIUM | Stage C UI & Workers Assets tests rely on initial SSR-only mount and mocked `env.ASSETS`
- **Affected File and Line:** `axnna-web/tests/stage_c_ui.test.tsx:14-48`; `axnna-web/tests/stage_c_operations.test.ts:46-80`
- **Evidence:** `stage_c_ui.test.tsx` renders `Config` only in initial `checkingSession = true` state (`expect(html.length).toBeGreaterThan(20)`), never testing login, tabs, filters, errors, or retry/resolve clicks. `stage_c_operations.test.ts` stubs `env.ASSETS` with a mock function rather than running Wrangler/Miniflare asset routing.
- **Impact:** UI regressions across any of the 11 Admin tabs or real static-asset 404 edge cases would pass CI undetected.
- **Recommended Correction:** Add `jsdom` + `@testing-library/react` tests covering `Config`, `Status`, and `Contact` state transitions, and add a Miniflare/Wrangler local integration check for SPA vs missing-asset 404 routing.

### FND-12 | MEDIUM | `POST /api/feedback` lacks body-size cap, duplicate guard, and strict IP header handling
- **Affected File and Line:** `axnna-web/src/worker.ts:532-615`
- **Evidence:** `request.json()` parses unbounded bodies before checking string lengths; identical spam within 3 attempts/hr creates duplicate rows; `X-Forwarded-For` is trusted when `CF-Connecting-IP` is absent.
- **Impact:** Duplicate feedback noise and minor rate-limit bypass risk outside Cloudflare edge proxies.
- **Recommended Correction:** Check `Content-Length`/text length before JSON parse (`<= 8 KB`), deduplicate identical `(client_hash, message)` within 1 hour, and trust `X-Forwarded-For` only in local dev.

### FND-13 | MEDIUM | Unused analytics event enum values + unrendered `dailyTrends` chart data
- **Affected File and Line:** `axnna-web/src/worker.ts:39-47`; `axnna-web/src/utils/analytics.ts:1-8`; `axnna-web/src/admin/routes.ts:523`; `axnna-web/src/pages/Config.tsx:161-176, 1034-1146`
- **Evidence:** `REGISTRATION_STARTED`, `REGISTRATION_COMPLETED`, `ALERT_PREF_UPDATED`, and `APP_ACTIVITY` are never emitted by any code path; `/api/config/overview` queries and returns `analytics.dailyTrends` (`routes.ts:462-468,523`), yet `Config.tsx` Analytics tab never renders `dailyTrends`.
- **Impact:** Conversion funnel reports empty rows for unimplemented events and drops daily trend visibility.
- **Recommended Correction:** Remove unused enum values (or emit `ALERT_PREF_UPDATED` from user webhook/toggle flows) and render `dailyTrends` in the Analytics tab.

### FND-14 | LOW | Telegram `/status@BotName` / `/recap@BotName` fails parsing; no command cooldown
- **Affected File and Line:** `axnna-web/src/worker.ts:1247-1251, 1270`
- **Evidence:** Group/bot-suffixed commands (`/status@AxnnaSignalsBot XAUUSD`, `/recap@AxnnaSignalsBot`) break exact matching (`text === '/recap'`, `text.slice('/status'.length)`). No per-user command throttle exists.
- **Recommended Correction:** Strip optional `@BotUsername` from the first token before parsing command and arguments, and add simple per-user cooldown if abused.

### FND-15 | LOW | `/api` prefix check matches non-API paths like `/apiary`
- **Affected File and Line:** `axnna-web/src/worker.ts:191-193`
- **Evidence:** `if (url.pathname.startsWith('/api'))` intercepts any SPA route starting with `/api` without a slash.
- **Recommended Correction:** Change condition to `if (url.pathname === '/api' || url.pathname.startsWith('/api/'))`.

### FND-16 | LOW | `isConfiguredAdminAuth` accepts placeholder `'your_*'` passphrases/secrets unlike `getSecretStatus`
- **Affected File and Line:** `axnna-web/src/admin/routes.ts:22-29`; `axnna-web/src/ops/telemetry.ts:170-182`
- **Evidence:** If an operator leaves `.env.example` placeholder strings in `.dev.vars` or Cloudflare secrets, `isConfiguredAdminAuth` allows login against `'your_admin_passphrase'` even though `getSecretStatus` marks it `MISSING`.
- **Recommended Correction:** Share the same placeholder-rejection check (`!val.includes('your_') && val !== 'mock_key'`) in `isConfiguredAdminAuth` and enforce minimum `ADMIN_SESSION_SECRET` entropy.

### FND-17 | LOW | Admin `Config.tsx` Signals table omits `strategy_version`; mutation endpoints omit `404` on 0-row updates
- **Affected File and Line:** `axnna-web/src/pages/Config.tsx:844-872, 941`; `axnna-web/src/admin/routes.ts:569-601, 631-656`
- **Evidence:** `Signals` table hides `sig.strategy_version` even though `SignalRow` fetches it. Admin `toggle`, `security/:id/resolve`, and `contact/:id/status` return `200 OK` even when `meta.changes === 0` (unknown ID). Also `Config.tsx:941` restricts retry UI button to `RETRY_SCHEDULED` whereas backend accepts `FAILED` too (`worker.ts:903`).
- **Recommended Correction:** Add `Version` column in Signals table, show `Retry Once` for `FAILED` as well as `RETRY_SCHEDULED`, and return `404` when `meta.changes === 0`.

### FND-18 | LOW | Root `.gitignore` omits `.dev.vars` and `*.tsbuildinfo`
- **Affected File and Line:** `.gitignore:1-32`; `axnna-web/.gitignore:28-36`
- **Evidence:** Root `.gitignore` only lists `.env`/`.env.*`; `.dev.vars` and `*.tsbuildinfo` are ignored only inside `axnna-web/.gitignore`. Staged deletion `D axnna-web/tsconfig.tsbuildinfo` remains uncommitted.
- **Recommended Correction:** Add `.dev.vars` and `*.tsbuildinfo` to root `.gitignore` as defense-in-depth.

### FND-19 | INFORMATIONAL | Root `.env` exists locally while Wrangler loads `axnna-web/.dev.vars`
- **Affected File and Line:** `.env.example:1-4`; `docs/WORKFLOW.md:22`
- **Evidence:** Both documentation and active user editor metadata show root `.env` alongside `axnna-web/.dev.vars`. Wrangler local runs read `axnna-web/.dev.vars` exclusively.
- **Recommended Correction:** Keep `axnna-web/.dev.vars` clearly distinguished from Vite `VITE_*` client files during Stage D local tests.

### FND-20 | INFORMATIONAL | TypeScript `5.9.3` advisory warning in ESLint
- **Affected File and Line:** `axnna-web/package.json` (`npm run lint` output)
- **Evidence:** `@typescript-eslint/typescript-estree` prints an unsupported-version warning for TypeScript `5.9.3` (`>=4.7.4 <5.6.0`), though lint completes with exit code `0`.

---

## 17. Exact Files and Line References

- `axnna-web/wrangler.toml`: 1–63 (`[assets]`, `[env.staging]`, `[env.production]`, `REPLACE_WITH_*` IDs)
- `.github/workflows/cd.yml`: 15–57 (`workflow_dispatch`, placeholder check, deploy commands)
- `.gitignore`: 1–32; `axnna-web/.gitignore`: 1–43
- `axnna-web/migrations/0007_stage_b_integrity.sql`: 1–110
- `axnna-web/migrations/0008_stage_c_operations.sql`: 1–85
- `axnna-web/src/ops/telemetry.ts`: 15–30 (hashing), 56–96 (provider health), 98–143 (job runs), 170–182 (secret status), 191–397 (`evaluateSystemHealth`)
- `axnna-web/src/admin/auth.ts`: 1–160
- `axnna-web/src/admin/routes.ts`: 22–29 (`isConfiguredAdminAuth`), 126–132 (`getClientKey`), 184–252 (login attempts), 356–530 (overview + truncation), 532–666 (mutations)
- `axnna-web/src/worker.ts`: 39–53 (enums), 108–199 (routing), 202–329 (cron + sync), 493–530 (`/api/status`), 532–615 (`/api/feedback`), 617–685 (`/api/analytics/event`), 884–925 (retry), 1043–1141 (daily recap), 1241–1310 (Telegram commands)
- `axnna-web/src/pages/Config.tsx`: 195–205 (`formatTime`), 373–391 (`handleManualSync`), 464–546 (KPIs), 844–872 (Signals table), 941 (retry UI), 987–1032 (Paper Trading), 1034–1146 (Analytics)
- `axnna-web/src/pages/Status.tsx`: 24–29 (`formatTime`), 55–117
- `axnna-web/src/pages/Contact.tsx`: 1–126
- `axnna-web/src/utils/analytics.ts`: 1–51
- `axnna-web/tests/stage_c_operations.test.ts`: 46–80 (`ASSETS` mock)
- `axnna-web/tests/stage_c_ui.test.tsx`: 14–48 (SSR-only assertions)
- `docs/deployment/D1_PROVISIONING.md`: 5–11 (migration filenames)

---

## 18. Reproduction Steps for Important Defects

1. **Analytics Metric Inflation (`FND-01`):** Run a local loop sending 10 `POST /api/analytics/event` requests with distinct `visitorId` values (`"test_vis_0001"`..`"test_vis_0010"`) and `eventType: "TELEGRAM_CONNECT_COMPLETED"`. Inspect `GET /api/config/overview?days=7`: `uniqueVisitors` and funnel `TELEGRAM_CONNECT_COMPLETED` both increase without authentication or rate limiting.
2. **Timestamp Stale False-Positive (`FND-03`):** On any host/browser in non-UTC timezone (e.g., `TZ=Africa/Nairobi` / `UTC+3`), run `node -e "console.log(Date.now() - new Date('2026-11-17 15:00:00').getTime())"` when current UTC time is `15:00:00Z`. Output exceeds `10800000` ms (`> 30m`), causing `evaluateSystemHealth` line 257 (`nowMs - maxTs > 30 * 60 * 1000`) to return `DEGRADED`.
3. **KPI & Paper Trading Truncation (`FND-02`):** Insert 1 `ACTIVE_TRADE` row into `signals` dated `10:00Z`, then insert 50 `REJECTED` rows dated `11:00Z`–`12:00Z`. Query `GET /api/config/overview`: `paperTrading.trades` returns `[]` because line 404 caps `signals` at `LIMIT 50`.
4. **Daily Recap Failed-as-Succeeded (`FND-04`):** Connect 1 user, stub Telegram `sendMessage` to return HTTP `503`, run `await runDailyRecap(env, '2026-11-17')`. Query `scheduled_job_runs` (`status = 'SUCCEEDED'`) and `daily_recap_deliveries` (`status = 'FAILED'`).
5. **Sync UI False Success (`FND-06`):** Omit `TWELVEDATA_API_KEY`, log into `/config`, and click **Run Sync Now**. `POST /api/config/sync` returns `200 OK` and UI displays green notice `"Market, economic calendar, and strategy sync completed."` despite `scheduled_job_runs` recording `FAILED`.

---

## 19. Recommended Remediation

Execute a focused **Stage C.2 Remediation** pass before Stage D:
1. Add per-IP-hash rate limiting, 4 KB body cap, conversion-event whitelist (`PAGE_VIEW`, `TELEGRAM_CONNECT_STARTED` only from clients), and 90-day retention pruning for `analytics_events` / `scheduled_job_runs`.
2. Add `normalizeUtcTimestamp()` helper across `telemetry.ts`, `Config.tsx`, and `Status.tsx` to append `'Z'` cleanly to SQLite `YYYY-MM-DD HH:MM:SS` strings.
3. Replace truncated `.length` KPIs with real SQL `COUNT(*)` totals, query `paperTrading.trades` independently of `LIMIT 50`, and add pagination/offsets for Admin tables.
4. Fix `runDailyRecap` job status reporting (`FAILED`/`DEGRADED`), add same-day failed-recap retry in `CRON_SYNC`, and clarify alerted vs event-risk-gated setups in recap messages.
5. Scope `.github/workflows/cd.yml` `REPLACE_WITH_` check to the target `--env` block and add GitHub `environment: ${{ inputs.environment }}` gating.
6. Fix `evaluateSystemHealth` (cron orphan/staleness, Telegram recent failure rate), unify `recordProviderHealth`, add a D1 sync lease lock, return real sync status from `/api/config/sync`, fix `D1_PROVISIONING.md` filenames, and expand React UI + Wrangler local runtime tests.

---

## 20. Final Recommendation

- **Stage C Overall Status:** **COMPLETE WITH DEFECTS** (Core unified deployment model, security baseline, schema, endpoints, and 11-tab Admin console exist on real data without strategy regressions, and all 68 existing checks pass, but telemetry abuse gaps, KPI truncation, timestamp parsing drift, and recap/health status bugs should be fixed first).
- **Critical Blockers:** None (`0 CRITICAL`).
- **High-Priority Blockers:** `FND-01` through `FND-06` (analytics rate-limit/forgery, KPI/paper truncation, UTC timestamp parsing, daily recap error reporting/retry, CD staging placeholder block, and `D1_PROVISIONING.md` / `/api/config/sync` false success).
- **Medium and Low-Priority Improvements:** `FND-07` through `FND-18` (system health heuristics, salted IP hashing including `admin_login_attempts`, CRON D1 lock, retention pruning, interactive UI + Wrangler asset tests, feedback size/duplicate guards, `@BotName` command parsing, `/api/` prefix exactness, placeholder secret check, version column, root `.gitignore`).
- **Stage D Readiness:** **CONDITIONAL — Address Stage C.2 HIGH findings before live staging/production provisioning and 24/7 production simulation.**
- **Exact Next Recommended Action:** Authorize **Stage C.2 Targeted Remediation** on branch `main` to resolve `FND-01`–`FND-18` (prioritizing `FND-01`–`FND-06`) and expand interactive UI + local Wrangler asset tests, followed by committing consolidated Stage B/C/C.2 work and provisioning staging D1 (`axnna_db_staging`) to begin Stage D.

---

## 21. Stage C.2 Remediation Disposition Appendix

Original findings in Sections 1–20 above are preserved unaltered. All **20 findings (`FND-01`–`FND-20`)** were resolved and locally verified during Stage C.2 (see full evidence and verification output in `docs/reports/STAGE_C_REMEDIATION_REPORT.md`):

- **High (`FND-01`–`FND-06`):** All **6** marked **FIXED AND VERIFIED**.
- **Medium (`FND-07`–`FND-13`):** All **7** marked **FIXED AND VERIFIED**.
- **Low & Informational (`FND-14`–`FND-20`):** All **7** marked **FIXED AND VERIFIED**.
