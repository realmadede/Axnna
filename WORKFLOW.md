# Axnna Development Workflow

This document outlines the standard development, testing, and deployment lifecycle for authorized developers working on the proprietary Axnna repository.

## 1. Local Development Environment

Axnna operates as a monolithic repository containing both the frontend (React/Vite) and the backend (Cloudflare Worker).

### Frontend (Marketing & Config UI)
The frontend is a standard React SPA built with Vite. It runs locally on port 5173.

```bash
cd axnna-web
npm install
npm run dev
```

### Backend (API & State Engine)
The backend is a Cloudflare Worker (`src/worker.ts`). It handles Cron triggers, Finnhub/FCS integrations, Telegram bot commands, and the core Axnna strategy state engine.

To run the Worker backend locally (including local D1 database emulation):
```bash
cd axnna-web
npx wrangler dev src/worker.ts --local
```

**Note:** For the frontend to successfully communicate with the local backend during development, ensure your local environment variables (`.env`) are configured correctly.

## 2. Database (D1) Workflow

Axnna relies on Cloudflare D1 for serverless SQLite. 

When making changes to the database schema:
1. Update or create a new SQL migration file in `axnna-web/migrations/`.
2. Apply the migration to your local development database:
   ```bash
   npx wrangler d1 migrations apply DB --local
   ```
3. Once tested and approved, the CI/CD pipeline or deployment manager will apply it to production.

## 3. Code Standards & Linting

Before pushing any code, ensure it adheres to the internal styling rules:

* **Type-checking:** Run `npm run typecheck` to ensure no TypeScript compilation errors.
* **Linting:** Run `npm run lint` to catch ESLint warnings.
* **Formatting:** Rely on the `.editorconfig` rules (2 spaces, LF line endings) configured in your IDE.

## 4. Branching Strategy

Axnna uses a simplified Git Flow.
* `main`: The definitive, production-ready state of the code. Direct commits to `main` should be avoided.
* **Feature Branches:** Create a branch for new work: `git checkout -b feature/your-feature-name`.
* **Bugfix Branches:** Create a branch for patches: `git checkout -b fix/issue-name`.

Once work is complete, push the branch and open a Pull Request for code review by MADEDE.

## 5. Deployment Pipeline

Axnna's infrastructure is entirely hosted on Cloudflare.

### Deploying the Frontend (Cloudflare Pages)
```bash
cd axnna-web
npm run build
npx wrangler pages deploy dist --project-name axnna
```

### Deploying the Backend (Cloudflare Workers)
```bash
cd axnna-web
npx wrangler deploy src/worker.ts
```

*Note: Secrets (API keys, Telegram tokens) must be securely uploaded via Wrangler (`npx wrangler secret put <NAME>`) and never committed in plaintext.*
