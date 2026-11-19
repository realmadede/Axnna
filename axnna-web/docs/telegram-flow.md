# Telegram Connection, Disconnect Flow & Alert Delivery

## Deep-Link Pairing Lifecycle

1. **Visitor** opens `/connect-telegram` (`src/pages/ConnectTelegram.tsx`). If `localStorage` holds a saved `axnna_tg_session` token, the UI validates it immediately via `GET /api/telegram/session/:token` and displays connected state + disconnect control if active.
2. **Browser** calls `POST /api/telegram/session` (rate-limited at `15/hour` per hashed actor in D1 `rate_limit_counters`) to create a 10-minute UUID pairing token in `telegram_connection_sessions`.
3. **Browser** links to `https://t.me/AxnnaSignalsBot?start=<connection_token>` and polls `GET /api/telegram/session/:token`.
4. **Polling outcomes:**
   - `PENDING`: Waiting for Telegram confirmation.
   - `EXPIRED`: 10-minute pairing window elapsed before confirmation.
   - `CONNECTED`: Pairing completed (`alreadyConnected: true` is returned when that Telegram user was already subscribed before tapping the link, so the UI informs the user instead of silently acting like a brand-new subscription).
   - `DISCONNECTED`: User disconnected via web or Telegram bot.
5. **Webhook confirmation:** When Telegram delivers `/start <connection_token>` to `POST /api/telegram/webhook`, the Worker atomically claims the `PENDING` session, upserts `axnna_users` (`status = 'CONNECTED'`, `signal_notifications_enabled = 1`), records `TELEGRAM_CONNECTION_COMPLETED` in `audit_events`, and replies in Telegram — explicitly notifying users who were already connected and explaining `/status`, `/recap`, and `/disconnect`.

## Disconnect Flow

Subscribers can pause/stop alerts at any time from two surfaces:
- **In Telegram (`/disconnect` or `/stop`):** Marks `axnna_users.status = 'DISCONNECTED'`, pauses deliveries, updates linked sessions so `/connect-telegram` reflects disconnected status, and confirms re-pairing is available anytime.
- **In Web UI (`POST /api/telegram/disconnect`):** From `/connect-telegram`, clicking **Disconnect Telegram** verifies the browser's `sessionToken` matches that subscriber's completed pairing session before setting `axnna_users.status = 'DISCONNECTED'` and clearing local session state on confirmation.

## Webhook Authentication & Registration

- `POST /api/telegram/webhook` fails closed (`503`) if `TELEGRAM_WEBHOOK_SECRET` is unset and verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` header in constant time (`401` on mismatch, logged to `security_events`).
- Validates JSON payload shape and integer `from.id` / `chat.id` bounds.
- After deployment or secret rotation, register Telegram's webhook manually:
  ```text
  https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://axnna.madede.workers.dev/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
  ```

## Independent Risk Gate & Bounded Retry Policy

- Before delivery or paper-trade registration, `evaluateRiskGate` (`src/engine/RiskGate.ts`) verifies supported instrument allowlist, valid strategy state, active-session FX candle freshness (`<= 20m`, respecting Fri 22:00 UTC – Sun 22:00 UTC market close), setup eligibility (`ALERT_ELIGIBLE`), score (`>= 65`), setup age (`<= 30m`), structural SL/TP geometry, duplicate suppression, and fundamental availability/event risk. Decisions commit atomically via `env.DB.batch` (`risk_decisions` + `audit_events`).
- Alerts dispatch only when `system_config.global_notifications_enabled !== 'false'`, `RiskGate` returns `'APPROVED'`, and `axnna_users.status = 'CONNECTED'` with `signal_notifications_enabled = 1`.
- **Delivery statuses & claim locks (`notification_deliveries`):**
  - `SENDING`: Atomic pre-HTTP claim state preventing concurrent runs from double-sending.
  - `SENT`: Confirmed by Telegram Bot API `200` (`provider_message_id`, `delivered_at`).
  - `PERMANENT_FAILURE`: Non-retryable `400`/`401`/`403` response (e.g., user blocked bot).
  - `RETRY_SCHEDULED`: Transient `429`/`5xx`/network error scheduled with backoff (`5m, 10m, 20m, 40m, 60m`) or Telegram `retry_after` up to `MAX_DELIVERY_ATTEMPTS = 5`.
  - `EXHAUSTED`: Reached `5` failed delivery attempts.

## Bot Commands & 21:00 UTC Daily Recap

- `/start` (bare): Explains pairing via `https://axnna.madede.workers.dev/connect-telegram` or shows active status if already connected.
- `/status [INSTRUMENT]` (alias `/status@BotUsername`): Returns live macro regime, event risk, and latest setup for `EURUSD`, `GBPUSD`, `USDJPY`, or `XAUUSD` (rate-limited at `10` commands per 5m per user).
- `/recap`: Returns today's UTC setup summary in the same format as the scheduled recap — showing `Silence Day` confirmation (`"Silence is a valid signal."`) on 0-setup days or `Active Day` per-pair breakdown (plus paper trade W/L and R outcomes) on signal days.
- `runDailyRecap` (`0 21 * * *`): Runs automatically at **21:00 UTC / 00:00 EAT** for both silence days and active/good signal days, sending one idempotent digest per connected user (`UNIQUE(recap_date, axnna_user_id)`), with `retryFailedDailyRecaps` retrying transient failures (`attempt_count < 3`) on subsequent cron runs.
