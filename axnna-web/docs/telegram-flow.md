# Telegram Connection, Webhook Security & Alert Delivery

## Deep-Link Pairing Lifecycle
1. **Visitor** opens `/connect-telegram` ([ConnectTelegram.tsx](file:///home/madede/BAGOMWA/PROJECTS/Axnna/axnna-web/src/pages/ConnectTelegram.tsx)).
2. **Browser** calls `POST /api/telegram/session` to create a `PENDING` pairing token (`telegram_connection_sessions`, 10-minute expiration).
3. **Browser** renders `https://t.me/AxnnaSignalsBot?start=<connection_token>` and polls `GET /api/telegram/session/:token`.
4. **Polling expiration:** If `expires_at` has passed while `status` is still `PENDING`, `GET /api/telegram/session/:token` marks the session `EXPIRED` and returns `{ "status": "EXPIRED" }`.
5. **Webhook execution:** Telegram delivers `/start <connection_token>` to `POST /api/telegram/webhook`, which atomically claims the `PENDING` session (`WHERE id = ? AND status = 'PENDING'`), creates or updates `axnna_users` keyed by `telegram_user_id`, and logs `TELEGRAM_CONNECTION_COMPLETED` to `audit_events`.

## Webhook Authentication & Registration
* `POST /api/telegram/webhook` requires `TELEGRAM_WEBHOOK_SECRET` on the Worker (`503` if unconfigured) and verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` header in constant time (`401` on mismatch).
* Incoming payloads are validated for JSON structure, message text, and valid integer `from.id` / `chat.id` before processing.
* **Operational requirement (Stage C):** Webhook registration is manual. When calling Telegram's `setWebhook` after Worker deployment, pass the same `secret_token`:
  ```text
  https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<WORKER_DOMAIN>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
  ```

## Independent Risk Gate & Bounded Alert Retry Policy
* Before Telegram delivery or simulated Paper Trading registration occurs, `evaluateRiskGate` (`src/engine/RiskGate.ts`) validates supported instrument allowlist, valid strategy state, market data availability and active-session wall-clock staleness (`<= 20m`, respecting FX Friday 22:00 UTC – Sunday 22:00 UTC market close), setup status (`ALERT_ELIGIBLE`), minimum technical score (`>= 65`), setup age (`<= 30m`), structural SL/TP geometry, minimum `structuralRR`, duplicate delivery suppression, and fundamental availability/risk (`FUNDAMENTAL_DATA_UNAVAILABLE` when `UNKNOWN` vs `HIGH_EVENT_RISK` when `HIGH`/`EXTREME`). Decisions are persisted atomically via `env.DB.batch` into `risk_decisions` + `audit_events` — if persistence fails, delivery and paper trade creation fail closed cleanly.
* Alerts are delivered only when `system_config.global_notifications_enabled !== 'false'`, `RiskGate` returns `'APPROVED'`, and the user has `status = 'CONNECTED'` and `signal_notifications_enabled = 1`.
* If live economic calendar ingestion has failed or `provider_health_state` is stale (`>2h`), `FundamentalEngine` reports `'UNKNOWN'` / `'FUNDAMENTAL UNAVAILABLE'` rather than `'NONE'` or `'NEUTRAL'`.
* **Delivery statuses & atomic claim locks in `notification_deliveries`:**
  * `SENDING`: Atomic pre-HTTP claim state preventing concurrent cron/manual retries from issuing duplicate `sendMessage` requests for the same row.
  * `SENT`: Confirmed by Telegram Bot API `200` response (`provider_message_id` and `delivered_at` recorded).
  * `PERMANENT_FAILURE`: Permanent client/user rejection (`HTTP 400`, `401`, `403` such as user blocked bot); never retried.
  * `RETRY_SCHEDULED`: Transient failure (`HTTP 429`, `5xx`, timeout/network error) with exponential backoff (`5m, 10m, 20m, 40m, 60m`) or Telegram `retry_after`. Due rows are retried by `retryScheduledDeliveries` during Cron synchronization.
  * `EXHAUSTED`: Transient failures reached `MAX_DELIVERY_ATTEMPTS = 5`; no further automatic retries.

## Interactive Bot Commands & Scheduled Daily Recap
* `/status [INSTRUMENT]` and `/status@BotUsername [INSTRUMENT]`: Available to connected subscribers (`axnna_users.status = 'CONNECTED'`); enforces per-user command rate limiting (`10` commands per 5m) and returns current macro regime, fundamental event risk, and latest recorded setup (`EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`; defaults to `EURUSD`).
* `/recap` and `/recap@BotUsername`: Returns today's UTC setup digest separating `ALERTED` setups from event-risk-gated / unsent eligible setups (or `"Silence is a valid signal."` when none qualified).
* Scheduled Daily Recap (`0 21 * * *` -> `runDailyRecap`): Runs explicitly at **21:00 UTC**, persists per-user status (`SENT` / `FAILED`, `attempt_count`, `last_error`, `next_retry_at`) in `daily_recap_deliveries` (`UNIQUE(recap_date, axnna_user_id)`), reports accurate `SUCCEEDED`/`DEGRADED`/`FAILED` job outcomes, and automatically retries failed same-day deliveries (`attempt_count < 3`) via `retryFailedDailyRecaps` during subsequent cron runs without re-sending `'SENT'` users.
* Manual Retry (`POST /api/config/deliveries/:id/retry`): Admins can trigger a single bounded retry on eligible `RETRY_SCHEDULED` or `FAILED` deliveries directly from the Admin Operations Console (`/config`), respecting `MAX_DELIVERY_ATTEMPTS`.
