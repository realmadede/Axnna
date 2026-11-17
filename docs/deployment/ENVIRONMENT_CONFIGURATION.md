# Environment Configuration

Axnna separates **local development**, **staging**, and **production** in `axnna-web/wrangler.toml`.

## Environment Matrix

| Setting | Local Development | Staging (`--env staging`) | Production (`--env production`) |
| --- | --- | --- | --- |
| Worker Name | `axnna-web` | `axnna-staging` | `axnna` |
| `ENVIRONMENT` var | `"development"` | `"staging"` | `"production"` |
| Expected Origin | `http://localhost:8787` / `http://127.0.0.1:8787` | `https://axnna-staging.madede.workers.dev` | `https://axnna.madede.workers.dev` |
| `ALLOWED_ORIGINS` | Implicit local origins or `.dev.vars` | `"https://axnna-staging.madede.workers.dev"` | `"https://axnna.madede.workers.dev"` |
| D1 Binding | `DB` (`axnna_db`, `local-db-id`) | `DB` (`axnna_db_staging`) | `DB` (`axnna_db_production`) |
| Migrations Dir | `./migrations` | `./migrations` | `./migrations` |
| Cron Triggers | `["*/5 * * * *", "0 21 * * *"]` | `["*/5 * * * *", "0 21 * * *"]` | `["*/5 * * * *", "0 21 * * *"]` |

## Required Worker Secrets (Per Environment)

Set these secrets separately for `staging` and `production` via Wrangler secrets (never inside `wrangler.toml` or Vite frontend environment variables):

- `TWELVEDATA_API_KEY`: Twelve Data market feed API key.
- `TELEGRAM_BOT_TOKEN`: Bot token from `@BotFather` (use a dedicated staging bot for staging).
- `TELEGRAM_WEBHOOK_SECRET`: Random high-entropy secret passed to Telegram `setWebhook` `secret_token` and verified via `X-Telegram-Bot-Api-Secret-Token`.
- `ADMIN_PASSPHRASE`: High-entropy passphrase for `/config` login.
- `ADMIN_SESSION_SECRET`: Separate 32+ byte random signing secret for HMAC-SHA256 admin cookies.
- `BACKTEST_SECRET`: Bearer token protecting `POST /api/dev/backtest`.

Optional:
- `ACTOR_HASH_SECRET`: Optional dedicated 32+ byte secret for HMAC actor hashing (`computeHmacActorHash`). When omitted, falls back to `ADMIN_SESSION_SECRET`.
- `FINNHUB_API_KEY`: Not required by `FreeEconomicCalendarProvider`; omit unless integrating an optional paid provider in the future.

## Local Files vs Build Variables vs Worker Secrets (`FND-19`)

- **`axnna-web/.dev.vars` (Local Worker Runtime):** Loaded exclusively by `wrangler dev --local` for Worker secret bindings (`TWELVEDATA_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc.). Git-ignored.
- **Root `.env` (Reference / Non-Wrangler Tools):** Not read by Wrangler or Cloudflare Workers; never rely on root `.env` for local Worker secrets.
- **`VITE_*` Build Variables:** Embedded into public browser JavaScript during `vite build`. **Never place API keys, passphrases, or secrets in `VITE_*` variables.**

## Placeholder Guards

- `axnna-web/wrangler.toml` contains `REPLACE_WITH_STAGING_D1_DATABASE_ID` and `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID`.
- `.github/workflows/cd.yml` inspects only `[env.${{ inputs.environment }}]` in `wrangler.toml`, allowing `staging` deployments even while `production` remains a placeholder, and failing cleanly when the selected environment lacks a real D1 UUID.
- Local development uses `axnna-web/.dev.vars` (git-ignored) and `.wrangler/state/v3/d1` (git-ignored).
