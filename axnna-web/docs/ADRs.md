# Architecture Decision Records (ADRs)

## ADR 001: Cloudflare-first application architecture
**Decision**: Axnna will be built using React, TypeScript, Vite, Cloudflare Workers, and Workers Static Assets.
**Rationale**: Optimizes for simplicity, low cost, and reliability at small scale (5-10 users) while remaining globally scalable. Avoids the operational overhead of Kubernetes or raw VPS management.

## ADR 002: D1 as initial database
**Decision**: Use Cloudflare D1 (Serverless SQLite).
**Rationale**: Integrates natively with Workers. Sufficient for V1 volume (users, sessions, signals). Abstracts SQL so future PostgreSQL/Supabase migration is possible if scale demands it.

## ADR 003: Telegram-first Axnna identity
**Decision**: Use Telegram `user_id` as the sole primary identity. No passwords, emails, or phone numbers.
**Rationale**: Eliminates onboarding friction. Leverages Telegram's secure deep-link (`/start <token>`) API to verify users instantly and binds identity natively to the notification channel.

## ADR 004: Provider-independent market-data layer
**Decision**: Implement a `MarketDataProvider` abstraction interface.
**Rationale**: Prevents vendor lock-in with FCS API or Twelve Data. Strategies consume strictly normalized Axnna data structures.

## ADR 005: Centralized market analysis
**Decision**: Run market monitoring centrally on the server.
**Rationale**: 20 users watching EURUSD should not trigger 20 strategy evaluations. The platform calculates the analytical result once and dispatches it to users, ensuring the browser does not need to remain open.

## ADR 006: Independent strategy registry
**Decision**: Abstract trading strategies into a multi-strategy registry with versioning.
**Rationale**: Allows the platform to support multiple, formally verified strategies without rewriting the core engine. Strategies can be explicitly `ACTIVE`, `VALIDATION`, or `DISABLED`.

## ADR 007: Separate strategy signals instead of automatic strategy confluence
**Decision**: Signals from different strategies remain independent and isolated. No automatic additive scoring or "confidence" metrics.
**Rationale**: Preserves auditability. If Strategy A and Strategy B conflict, both signals are recorded independently, proving exactly which logic produced which decision.
