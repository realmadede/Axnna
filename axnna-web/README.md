# Axnna Web Platform

This is the foundation for the Axnna Market Analysis platform, a Telegram-first product built on Cloudflare Workers and React/Vite.

## Architecture
- **Frontend**: React + Vite + TypeScript
- **Backend API**: Cloudflare Worker (src/worker.ts)
- **Database**: Cloudflare D1
- **Authentication**: None (Telegram deep link handles identity securely)

## Development
```bash
npm install
npm run db:init
npm run dev
```

For documentation on the architecture and identity model, see the `docs/` directory.
