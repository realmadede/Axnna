# Axnna

Axnna is a web-based, Cloudflare-hosted automated market-analysis engine with Telegram-first user identity. It monitors financial markets 24/5, evaluates structural alignment using a purely deterministic pipeline, and delivers formatted setup signals natively through Telegram.

## Core Philosophy
Most retail traders lose money because they lack consistency. They chase price action, ignore macroeconomic context, and fail to filter out low-probability environments. Axnna evaluates setups geometrically and fundamentally. We assign a deterministic **Axnna score** to each candidate.

**Silence is a valid signal.** If a setup scores below our strict 65% threshold, Axnna stays silent. It only triggers a Telegram notification when strict structural geometry aligns with macro-economic safety.

## Architecture

Axnna operates as a strictly one-way deterministic data pipeline:

1. **Market Data:** Continuous ingestion of forex/commodity structural data via cron-triggered Cloudflare Workers.
2. **Macro Data:** Integration with Finnhub to identify economic events and "EXTREME EVENT RISK" periods that pause technical operations.
3. **State Engine:** A stateless evaluation pipeline mapping relative Swing Highs/Lows, Liquidity Sweeps, Displacement, and Fair Value Gaps (FVG) against structural thresholds.
4. **Telegram Native API:** Push notification delivery mapping setups strictly to authenticated users' Telegram clients.

There is NO customer login, NO password management, and NO email registration on the web. A visitor becomes an **Axnna User** strictly through authenticating with the Axnna Telegram bot.

## Repository Structure

- `axnna-web/`: The primary Cloudflare Pages / Worker monolith.
  - `src/pages/`: The React-based, CursorHop-inspired premium marketing layer. Includes dynamic hero elements, strict architectural visualization, and a secure `Config` route.
  - `src/worker.ts`: The Cloudflare Worker entry point routing API requests, running Cron triggers, and processing market strategy.
  - `src/engine/`: The purely functional deterministic strategy engines (`AxnnaV1Strategy`, `FundamentalEngine`).
  - `migrations/`: D1 Database schema migrations.
  - `docs/`: In-depth strategy logic and system specification documentation.

## Development

The project is built on Vite, React, TypeScript, and Cloudflare Workers (D1 + Cron).

```bash
cd axnna-web

# Install dependencies
npm install

# Run the frontend marketing layer locally (Vite)
npm run dev

# Run the Cloudflare backend/API and Database emulator locally
npx wrangler dev src/worker.ts --local
```

## Deployment

```bash
# Deploy the web/marketing static assets to Cloudflare Pages
npm run build
npx wrangler pages deploy dist --project-name axnna

# Deploy the Worker backend and Cron triggers
npx wrangler deploy src/worker.ts
```

## Disclaimer
Axnna is a structural analysis tool, not a registered investment advisor. The internal signal score is a reflection of geometric alignment, strictly **not a probability of profit**.
