# Secrets and Security Model

## Core Security Invariants

1. **Fail-Closed Secret Handling**:
   - Missing or placeholder (`your_*`, `mock_key`, weak `<32`-char session secret) `ADMIN_PASSPHRASE` or `ADMIN_SESSION_SECRET` returns `503` on `/api/auth/config` and `/api/config/*`; no fallback password exists in source code or migrations.
   - Missing `TELEGRAM_WEBHOOK_SECRET` returns `503` on `/api/telegram/webhook`.
   - Missing `BACKTEST_SECRET` rejects `POST /api/dev/backtest` (`401`).
   - Missing or placeholder `TWELVEDATA_API_KEY` fails closed without making external API requests and marks subsystem health `MISCONFIGURED`.
2. **Never Expose Secret Values**:
   - Admin overview (`GET /api/config/overview`) returns only boolean/status presence (`CONFIGURED` / `MISSING`) for each secret binding, never secret material or key prefixes.
   - `sanitizeErrorMessage` redacts `TWELVEDATA_API_KEY` and `TELEGRAM_BOT_TOKEN` before logging or persisting `last_error` / `error_message`.
   - Landing page and `/api/status` expose zero internal endpoints, credentials, or D1 user records.
3. **Admin Authentication & CSRF Defense**:
   - Sessions use HMAC-SHA256 signed cookies bound to `admin_session_version` in D1 (`HttpOnly; Secure; SameSite=Strict; Path=/`).
   - Logout (`/api/auth/config/logout`) increments `admin_session_version`, revoking existing cookies server-side.
   - Failed logins track hashed actor identifiers in `admin_login_attempts` and enforce lockout after 5 failed attempts.
   - State-changing `/api/config/*` requests require both an allowlisted `Origin` (`ALLOWED_ORIGINS` + request origin check) and header `X-Requested-With: AxnnaAdmin`.
4. **Telegram Webhook & Delivery Integrity**:
   - Constant-time comparison verifies `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET`.
   - Malformed payloads, invalid sender IDs, or unauthorized requests log structured entries to `security_events` without throwing unhandled exceptions.
5. **Privacy-Safe Analytics, Feedback & Actor Hashing**:
   - **Algorithm & Key Source:** Client IP identifiers (strictly `CF-Connecting-IP` in staging/production; `X-Forwarded-For` accepted only in local dev) are hashed using keyed **HMAC-SHA256** (`computeHmacActorHash` in `src/ops/telemetry.ts`) signed with `ACTOR_HASH_SECRET` (falling back to `ADMIN_SESSION_SECRET` or an isolate-ephemeral random salt if unconfigured).
   - **Domain Separation:** Inputs are prefixed by subsystem purpose (`admin_auth`, `feedback`, `analytics`, `security`, `telegram`) so hashes cannot be correlated across unrelated subsystems.
   - **No Raw IP Persistence:** `admin_login_attempts.client_key` and `contact_submissions.client_hash` store domain-separated HMAC pseudonyms only; migration `0009` clears any legacy unhashed IP entries. Rotating `ACTOR_HASH_SECRET` or `ADMIN_SESSION_SECRET` rotates all active pseudonymous actor buckets immediately.
   - **Retention Policy:** Executed daily (02:00/21:00 UTC job window -> 21:00 UTC cron) in bounded 500-row batches via `pruneOperationalTables`: `analytics_events` = 90 days, `scheduled_job_runs` = 90 days, resolved `security_events` = 180 days (unresolved = 365 days), `rate_limit_counters` = 2 days; `audit_events` are retained permanently.
   - **Abuse Controls:** `POST /api/analytics/event` enforces a 4 KB streaming body cap, 60 req/hr actor limit, max 5 distinct `visitorId` values per actor per hour, 10s deduplication, and rejects spoofed server conversion events (`TELEGRAM_CONNECT_COMPLETED` is emitted only server-side). `POST /api/feedback` enforces an 8 KB body cap, honeypot, 3 req/hr limit, and 1-hour duplicate suppression.

## Generating Required Secrets

Run locally in a secure shell (do not commit outputs):

```bash
# High-entropy 32-byte hex secret (run separately for TELEGRAM_WEBHOOK_SECRET, ADMIN_SESSION_SECRET, BACKTEST_SECRET, ACTOR_HASH_SECRET)
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store values in `axnna-web/.dev.vars` locally (git-ignored) or upload per environment via `npx wrangler secret put <NAME> --env <staging|production>`.

## GitHub Actions & Environment Configuration

- `.github/workflows/cd.yml` scopes `environment: ${{ inputs.environment }}` on the `deploy` job so GitHub Environment protection rules, required reviewers, and environment-scoped secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) can be configured per target (`staging` vs `production`) inside GitHub Settings -> Environments.
