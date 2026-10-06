# Identity Model

## Visitor vs Axnna User
A **Visitor** is an anonymous browser user. They do NOT exist in the Axnna database. They may receive a temporary `telegram_connection_sessions` record, but this does not grant them user rights.

An **Axnna User** is created ONLY when a Telegram account successfully completes the deep-link connection flow.

## The Axnna User Record
The canonical identity is anchored to the `telegram_user_id`, which is a stable, unique numeric identifier provided by the Telegram Bot API.

- `telegram_username` is treated as a transient snapshot, as users can change it.
- **No passwords, emails, or phone numbers** are requested or stored.
- **Reconnection**: If an existing Telegram user reconnects, the system updates their `last_seen_at` and `telegram_chat_id` idempotently without creating duplicate records.

## Admin Identity
Public users use Telegram. The Admin uses a protected `Cloudflare Access` boundary (or similar Zero Trust proxy) wrapping the `/admin` path. The admin panel relies on this external authorization layer, completely separate from the Telegram identity model.
