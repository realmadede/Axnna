# Economic Calendar Integration

Axnna integrates economic event risk tracking to provide context to technical signals.

## Provider Independence
The planned provider is **Finnhub**, but the rest of the application interacts strictly with the Axnna `EconomicEvent` abstraction. Finnhub JSON payloads do not leak into the domain.

## Event Impact Windows & Mapping
Events are mapped deterministically to exposure:
- `USD` events expose `EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`.
- `EUR` events expose `EURUSD`.

An `EventImpactWindow` abstraction defines whether an event is Approaching, Active, or Recently Released. This provides context for the "Why No Signal?" explanation (e.g., "Technical setup exists, but major US CPI event approaching in 15 minutes").

## Event Surprise Normalization
Because different economic indicators have different units and scales, Axnna stores the `Actual`, `Estimate`, and `Previous` values natively, delegating the interpretation of "surprise" to specific normalization handlers rather than a generic formula.
