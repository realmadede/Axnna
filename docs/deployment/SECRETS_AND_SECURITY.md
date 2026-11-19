# Secrets & Security Architecture

Axnna uses a defense-in-depth Worker security boundary with zero client-exposed secrets, no browser login/password stores, and fail-closed verification across webhook, backtest, and execution paths.

## 1. Secret Boundary Rules

- Never place API keys, bot tokens, or shared secrets in `VITE_*` variables, `wrangler.toml`, client bundles, or git-tracked files.
- Worker secrets (`TWELVEDATA_API_KEY`, `TIINGO_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BACKTEST_SECRET`, `ACTOR_HASH_SECRET`) are stored exclusively in Cloudflare environment secrets (production/staging) or gitignored `axnna-web/.dev.vars` (local dev).
- Error messages persisted or returned by Worker handlers pass through `sanitizeErrorMessage` (`src/worker/http.ts`), stripping API keys or secrets before logging or storage.

## 2. Authentication & Webhook Controls

- **Telegram Webhook (`POST /api/telegram/webhook`):**
  - Fails closed with HTTP `503` if `TELEGRAM_WEBHOOK_SECRET` is missing or empty.
  - Verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` header using constant-time SHA-256 digest matching (`401` on mismatch, logged to `security_events`).
  - Validates JSON payload shape and integer `from.id` / `chat.id` bounds.
  - Enforces D1 sliding rate limits (`10` commands per 5 minutes per `telegram_user_id`).
- **Backtest Runner (`POST /api/dev/backtest`):**
  - Fails closed with HTTP `503` if `BACKTEST_SECRET` is unset, `401` if Bearer token mismatches (`constantTimeSecretMatch`).
  - Enforces strict instrument/timeframe allowlists, integer `limit` bounds (`100..400`), and date validation.
- **No Exposed Admin Surface:**
  - All system administration uses direct Cloudflare CLI (`wrangler secret`, `wrangler d1`, `wrangler rollback`) rather than a web admin login route. Legacy `/api/config/*` and `/api/auth/config*` paths are removed and return JSON `404`.

## 3. Public Endpoint Controls & Privacy

- **Telemetry & Abuse Prevention:**
  - `POST /api/telegram/session` enforces bounded D1 sliding rate limits (`15` requests/hour per hashed actor key via `computeHmacActorHash` / `getRequestActorHash`).
  - `POST /api/telegram/disconnect` requires the exact verified `sessionToken` before changing `axnna_users.status` to `'DISCONNECTED'`.
  - `GET /api/status` (`max-age=15`) and `GET /api/performance` (`max-age=300`) expose strictly aggregated/sanitized metrics and perform zero D1 writes.
  - User feedback uses a direct Telegram link on `/contact` (`https://t.me/mad_ede`), avoiding anonymous spam inbox endpoints.
- **CORS & Static Asset Guard:**
  - `buildCorsHeaders` checks `Origin` against the request origin, `ALLOWED_ORIGINS`, and loopback hosts (`localhost`/`127.0.0.1`) during local dev only. Wildcard `*` is never emitted.
  - Requests under `/assets/*` or static extensions never fall through to `index.html` on missing files (returns `404`).

## 4. Fail-Closed Risk Gate & Delivery Locking

- Before any live Telegram alert or simulated paper trade is written, `evaluateRiskGate` (`src/engine/RiskGate.ts`) verifies data integrity, FX session freshness, setup validity, geometry, duplicate suppression, and macro event risk, persisting decisions atomically with `env.DB.batch`.
- Telegram alert dispatch and daily recaps acquire atomic D1 `'SENDING'` claim locks so concurrent cron ticks never double-send identical notifications.
- `pruneOperationalTables` deletes transient rows cleanly on schedule (`90d` operational tables, `180d` resolved / `365d` unresolved security events, `2d` rate-limit buckets) while preserving `audit_events`.
