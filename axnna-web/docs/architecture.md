# Cloudflare Architecture

Axnna uses a simple Cloudflare-first foundation:
- **Frontend**: React + TypeScript + Vite. Hosted via Cloudflare Workers Static Assets.
- **Backend**: Cloudflare Worker. Acts as the API gateway (`/api/*`) and Telegram webhook listener.
- **Database**: Cloudflare D1.

## Market Data Abstraction
The market-data provider (e.g., FCS API or Twelve Data) is NOT permanently selected. The system uses a generic `MarketDataProvider` abstraction. Market ticks are not stored persistently in D1; they feed directly into the central strategy monitor. 

## Strategy Engine Boundary
The core strategy logic (Swings, Liquidity, FVGs) is completely decoupled from the Web API. The Web API only consumes the generated `signals` and pushes `notification_deliveries` to the Telegram Bot.

## Intentionally Unimplemented
- Live Market Ingestion
- Signal Generation Logic (Strategy Engine)
- Subscriptions/Billing (Stripe)
- Full Admin Dashboard
