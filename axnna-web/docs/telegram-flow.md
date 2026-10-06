# Telegram Connection Flow

The intended V1 experience requires no passwords, no email registration, and no manual data entry.

## Deep-Link Flow
1. **Visitor** clicks "Connect Telegram to Get Signals".
2. **Web Browser** requests a short-lived, one-time `connection_token` from the Worker API (`/api/telegram/session`).
3. **Web Browser** renders a deep-link: `https://t.me/<bot_username>?start=<connection_token>`.
4. **Visitor** clicks the link and opens the Telegram App.
5. **Visitor** presses "Start" in the Telegram bot interface.
6. **Telegram** sends an update containing `/start <connection_token>` to the Axnna webhook.
7. **Axnna Webhook** validates the token's single-use status and expiry.
8. **Axnna Webhook** creates or updates the `axnna_users` record using the Telegram `user_id`.
9. **Axnna Webhook** marks the session `CONNECTED`.
10. **Web Browser**, which is polling the session status, receives `CONNECTED` and shows a success message.

## Webhook Security
The webhook never exposes the bot token to the frontend. The `connection_token` is a secure UUID, strictly mapped to a 10-minute expiry window, and immediately consumed upon a valid webhook trigger.
