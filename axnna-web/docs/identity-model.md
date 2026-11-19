# Identity Model

## Visitor vs Axnna User

- **Visitor:** An anonymous web visitor does not exist in `axnna_users`. Requesting a pairing link stores only a short-lived (10-minute) UUID token in `telegram_connection_sessions`, rate-limited by hashed actor key in `rate_limit_counters`.
- **Connected Subscriber (`axnna_users`):** A user record is created or reactivated only after completing Telegram deep-link verification (`/start <token>`). Browser state stores only the `axnna_tg_session` token locally so `/connect-telegram` can verify active subscription state across page reloads.

## Canonical Identity (`telegram_user_id`)

- Identity is anchored to Telegram's immutable numeric `telegram_user_id`.
- `telegram_username` is stored only as an optional transient label.
- **Zero credentials:** No passwords, emails, or phone numbers are collected or stored.
- **Reconnection & Duplicate Guard:** When an already-subscribed user completes `/start <token>`, the Worker updates `last_seen_at` / `telegram_chat_id` idempotently without duplicating rows, flags `alreadyConnected: true` to `/connect-telegram`, and notifies the user inside Telegram.
- **Disconnection:** Either `/disconnect` / `/stop` in Telegram or `POST /api/telegram/disconnect` (matching the browser's `sessionToken`) sets `axnna_users.status = 'DISCONNECTED'`.

## Operations & Maintenance Model

- Axnna has no browser-facing admin login UI; all administrative actions (secrets, migrations, emergency notification kill-switch, and rollback) run through authenticated Cloudflare Wrangler CLI and D1 commands.
