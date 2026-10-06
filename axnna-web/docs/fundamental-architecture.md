# Fundamental Architecture

Axnna separates Technical Strategy execution from Macro Fundamental analysis to prevent silent logic mutations and preserve auditability.

## Fundamental Domain Boundaries
1. **Macro Entities**: `USD`, `EUR`, `GBP`, `JPY`, `XAU`.
2. **Central Bank Context**: Stores policy rates and decisions (e.g., Federal Reserve, ECB).
3. **Fundamental Observations**: Tracks categorical state like INFLATION, EMPLOYMENT, GROWTH.

## Relative Analysis (Context vs Strategy)
Instead of forcing a blunt scoring system (e.g., "USD is strong = 90"), the engine builds relative context (e.g., "EUR Growth WEAK vs USD Growth STRONG"). 
This context is attached to the final `signals` record as `market_context`. It explains **WHY** a signal might be stronger or weaker contextually, but it **DOES NOT** override the exact technical rules of `Strategy A`.

## Cost Control & Caching
Because macro data changes slowly relative to price ticks, all Finnhub/Macro fetches are executed centrally and stored in `fundamental_observations` or `economic_events`. The frontend strictly queries Axnna's D1 cache, ensuring API costs do not scale with the number of users or browser tabs.
