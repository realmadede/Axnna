# Axnna Formal Mathematical & Technical Strategy Specification

## 1. Primary Objective
The objective of this specification is to translate the research candidate (Liquidity Event → Displacement → FVG → Retracement → Entry) into a deterministic set of mathematical and state-based rules. It must be sufficiently precise that two engineers coding independently would produce identical logic and signals. All subjective ICT terminology is strictly replaced by observable, quantifiable threshold conditions.

## 2. Formal Data Model
The strategy requires **OHLC data**. Volume (V), tick data, bid/ask spread, and broker-specific data are explicitly excluded from the core signal generation to preserve universality (especially in decentralized spot FX). Spread will only be considered as a post-signal risk execution adjustment.

**Variables:**
- `O_t`, `H_t`, `L_t`, `C_t` (Open, High, Low, Close for candle at time `t`)
- Range: `R_t = H_t - L_t`
- Body: `B_t = |C_t - O_t|`
- True Range (`TR_t`) and Average True Range (`ATR_t(n)`) using standard Wilder's smoothing.

## 3. Time and Candle Conventions
- **Internal Timezone**: UTC must be used universally for all calculations.
- **Evaluation**: The strategy strictly evaluates **on candle close only**. Intrabar evaluation is banned for V1 as it introduces non-deterministic repainting, varying broker tick behavior, and massive testing complexity. A rule is evaluated only at `t_close`.
- **Weekend Gaps**: Ignored mathematically; OHLC sequences treat Friday close and Sunday/Monday open as consecutive indices.

## 4. Instrument Normalization
All static pip or point values are strictly banned. Everything must be normalized using `ATR_t(14)`. This creates a unified baseline across EUR/USD, GBP/USD, USD/JPY, and XAU/USD. For example, a displacement threshold is defined as `k * ATR_t`, not "20 pips."

## 5. Swing High / Swing Low
**Model A (N-left / N-right pivot)** is selected for determinism and simplicity.
- **Formula**: A candle at index `i` is a Swing High (SH) if `H_i > H_{i-k}` and `H_i > H_{i+k}` for all `k` in `[1, N]`.
- **Confirmation Delay**: A Swing High occurring at `t` is ONLY confirmed at `t + N`.
- **Look-Ahead Implication**: The algorithm cannot "know" or act upon the swing at `t`. The state updates at `t+N`.

## 6. Liquidity Representation
For V1, **Swing Liquidity (Unbreached confirmed swing high/low)** is the exclusive liquidity reference.
- **Creation**: Confirmed at `t + N`.
- **Validity**: Valid until breached by price, or until expiration.
- **Expiration**: A Swing High expires if a newer, higher Swing High is confirmed, or if it exceeds a lookback parameter (e.g., `Max_Age = 100` candles).

## 7. Equal Highs / Equal Lows
**Excluded from V1.** Defining "equal" requires tolerance thresholds (`ε`) that add a dimension of parameter fragility without guaranteeing independent value over a standard Swing High. V1 will treat repeated tests of a level simply as unbreached swings.

## 8. Liquidity Sweep
A Liquidity Sweep (`Sweep_t`) transitions a Liquidity Reference from valid to swept.
- **Penetration**: `Price` crosses the Reference. (e.g., `H_t > SH_price`). No minimum penetration (`ε`) is enforced for V1 to reduce parameter count; the cross is sufficient.
- **Re-entry / Timeout**: The sweep is only confirmed if a subsequent candle closes back inside the prior range (below the `SH_price`) within a strict maximum timeout limit (`Max_Sweep_Duration`, e.g., 3 candles).
- **Breakout Distinction**: If `t` exceeds `Max_Sweep_Duration` without a re-entry close, the level is invalidated (classified as a Breakout), and the setup fails.

## 9. Sweep State Machine
```text
UNTOUCHED
    ↓ (H_t > SH_price)
PENETRATED
    ↓ (C_{t+k} < SH_price AND k <= Max_Sweep_Duration)
SWEPT
    ↓ (OR if k > Max_Sweep_Duration)
INVALIDATED (Breakout)
```

## 10. Market Structure
**MSS (Market Structure Shift) is explicitly excluded** from V1's trigger logic. Displacement provides the energetic confirmation required to validate a sweep. Requiring a separate subjective structural break creates dependency on lagging right-side pivots (Model A) and risks missed entries. Market structure will only be used as a higher-timeframe context filter (Anchor TF Bias).

## 11. Displacement
Displacement is the deterministic signature of institutional participation.
- **Method C (Body / Range)** and **Method A (Range / ATR)** will be combined.
- The movement must be significant relative to recent volatility, and close strongly in its direction.

## 12. Displacement Candidate Formula
For a bearish displacement (following a Buy-Side Sweep):
```text
Displacement_t =
    (R_t / ATR_{t-1}(14) >= Disp_Size_Multiplier)
    AND
    (B_t / R_t >= Disp_Body_Ratio)
    AND
    (C_t < L_t + (R_t * Disp_Close_Tolerance)) 
```
*Note: Parameters like `Disp_Size_Multiplier` are subject to empirical testing, not hardcoded.*

## 13. Fair Value Gap
A Bearish FVG is confirmed at the close of candle `t` if:
- `High_t < Low_{t-2}`
- Size: `Low_{t-2} - High_t > FVG_Min_ATR_Ratio * ATR_t`
- The middle candle (`t-1`) must satisfy the `Displacement_t` formula.

## 14. FVG Quality
The only filter applied to an FVG is that it must be **created by a Displacement candle** immediately following a **Sweep**. Age, position, and partial fills are handled by the Retracement and Timeout logic.

## 15. FVG Retracement
**Model A (First touch of FVG)** is selected.
Entry is triggered the moment price touches the leading edge of the FVG (e.g., `H_t >= Low_{t-2}` for a bearish FVG). If evaluating strictly on candle close, the entry is simulated at the FVG edge boundary to reflect limit order logic.

## 16. FVG Invalidation
An FVG is invalidated if:
- Price closes beyond the far boundary of the FVG (`C_t > High_{t-2}` for bearish).
- Price closes beyond the origin (the swing high of the sweep).

## 17. Retracement Timeout
An FVG does not remain valid indefinitely.
- `FVG_Timeout`: If price does not touch the FVG within `N` candles after FVG creation, the setup is **INVALIDATED**. (Stale FVGs represent decayed momentum).

## 18. Entry Model
**Model A (First touch of FVG via Limit Order)**.
Once the FVG is confirmed at `t`, a limit order is placed at the proximal boundary of the FVG. If the order is not filled within `FVG_Timeout`, it is canceled.

## 19. Stop Loss
**Model B (Beyond sweep extreme)**.
`Stop Loss = Sweep_High + (Spread_Assumption)`
This represents the structural invalidation of the entire premise. Using ATR or arbitrary pip stops disconnects the risk from the mathematical setup.

## 20. Take Profit
**Structural Target**.
`Take Profit = Nearest Confirmed Opposing Liquidity (Swing Low)`.
**Gate Requirement**: `(Entry - Take Profit) / (Stop Loss - Entry) >= Minimum_RR` (e.g., 2.0). If the opposing swing is too close to provide the required RR, the setup is rejected immediately.

## 21. Setup Invalidation
A setup instantly aborts if:
- The sweep times out before re-entry.
- Displacement fails to form.
- No FVG is created by the displacement.
- Retracement times out.
- The Take Profit calculation fails the Minimum RR gate.
- The FVG is fully invalidated (closed beyond).

## 22. Complete Strategy State Machine
```text
NO_SETUP
    ↓ (H_t > SH_price)
LIQUIDITY_PENETRATED
    ↓ (C_t < SH_price within Max_Sweep_Duration)
SWEEP_CONFIRMED
    ↓ (Displacement formula true AND FVG created)
FVG_CREATED
    ↓ (Take Profit RR >= Minimum_RR)
AWAITING_RETRACEMENT
    ↓ (Limit order filled within FVG_Timeout)
ACTIVE
    ↓ 
TARGET_HIT / STOP_HIT / INVALIDATED
```

## 23. Multi-Timeframe Model
**Dual-Timeframe Architecture**.
- **Anchor TF (e.g., 1H)**: Used EXCLUSIVELY to define the current directional Bias based on the last confirmed Swing Break.
- **Execution TF (e.g., 5M)**: Evaluates the entire State Machine (Liquidity -> Sweep -> Displacement -> FVG -> Entry).
The Execution TF cannot redefine the Anchor Bias.

## 24. Higher-Timeframe Bias
HTF Bias is a **Hard Gate**.
- `Anchor_Bullish` = The most recent confirmed Anchor TF Swing Break was to the upside.
- The Execution TF can only take Long setups when `Anchor_Bullish` is True.

## 25. Premium / Discount
**Excluded from V1**. The Anchor TF directional bias and the Minimum RR gate adequately handle context and risk without introducing the arbitrary repainting bounds of a P/D matrix.

## 26. Session Logic
**Hard Gates**.
- Parameters: `Session_Start` and `Session_End` (UTC).
- Setups can only transition from `NO_SETUP` to `ACTIVE` within the session window.
- Setups left `AWAITING_RETRACEMENT` when the window closes are canceled. Open `ACTIVE` trades manage strictly via SL/TP.

## 27. Liquidity Prioritization
V1 evaluates the **most recently confirmed** Swing Extremes (one Swing High, one Swing Low) on the Execution TF. It does not rank historical extrema.

## 28. Conflicting Setups
- Only one setup is tracked at a time per instrument.
- The State Machine resets to `NO_SETUP` upon invalidation or resolution.
- The HTF Bias prevents simultaneous bullish and bearish setups from being valid.

## 29. Score System
**Hard Gates Only**.
The V1 strategy uses zero additive scoring. The mathematical conditions must simply evaluate to True. Scoring will only be investigated in future phases using conditional probabilities.

## 30. Real-Time Event Order
1. Candle `t` closes.
2. Swing confirms (lagged by N).
3. Penetration verified.
4. Reclaim verified (Sweep confirmation).
5. Displacement and FVG verified simultaneously (as FVG requires displacement).
6. Target/RR calculated.
7. Limit order placed for `t+1`.

## 31. No Look-Ahead Rule
> **UNIVERSAL RULE**: No strategy state, feature, classification, or decision may use information from candles `> t` when evaluating the state at `t_close`. A Swing High located at index `i` is strictly hidden from state logic until `t = i + N`.

## 32. No Repainting Requirement
A state transition in V1 is permanent. Once `Sweep_Confirmed` is true for a specific timestamp, it cannot become false due to future data. Provisional states (like `PENETRATED`) are temporary tracking statuses, not confirmed signals.

## 33. Parameter Inventory
| Parameter | Purpose | Unit | Global / Specific | Candidate Range | Requires Testing? |
| --------- | ------- | ---- | ----------------- | --------------- | ----------------- |
| `Swing_N` | Confirmation lookback | Candles | Global | 3–10 | YES |
| `Max_Sweep_Duration` | Reclaim timeout | Candles | Global | 1–3 | YES |
| `Disp_Size_Multiplier`| Min movement | ATR factor | Global | 1.0–2.5 | YES |
| `Disp_Body_Ratio` | Min momentum | % (0.0-1.0) | Global | 0.6–0.9 | YES |
| `FVG_Min_ATR_Ratio` | Filter noise | ATR factor | Global | 0.1–0.5 | YES |
| `FVG_Timeout` | Limit order cancel | Candles | Global | 3–10 | YES |
| `Minimum_RR` | Target gate | Ratio | Global | 1.5–3.0 | YES |

## 34. Parameter Minimization
The parameter count is constrained to 7 mathematically independent variables. Complex tolerances (like equal highs) and subjective structures (MSS) have been removed entirely to prevent overfitting. Instrument variance is normalized by ATR.

## 35. V1 Universality
**All rules and parameter definitions are Universal.**
No instrument-specific logic (e.g., "if XAUUSD use 50 pips") is permitted. ATR normalization handles the variance.

## 36. Formal Strategy Definition
```text
ValidSetup_t = 
    (Anchor_Bias == Setup_Direction)
    AND (Session_Active == True)
    AND (Sweep_Confirmed(Max_Sweep_Duration) == True)
    AND (Displacement_t >= Disp_Size_Multiplier * ATR)
    AND (FVG_Created_t == True)
    AND (Reward_To_Opposing_Liquidity / Risk_To_Sweep_Extreme >= Minimum_RR)
```

## 37. Failure Modes
- **Liquidity**: Swing N too small (noisy), or too large (late).
- **Sweep**: Reclaim timeout too short misses real sweeps; too long accepts breakouts.
- **Displacement**: Volatility spikes (news) trivially pass ATR multiples but lack institutional follow-through.
- **FVG**: Limit orders at proximal edges get front-run, or spread causes a missed fill.

## 38. News and Extreme Volatility
**Excluded from V1.** V1 will blindly process OHLC data. Measuring robustness against news and gaps is the responsibility of the backtesting phase. If V1 fails spectacularly due to news, external filtering will be added in V2.

## 39. Strategy Simplicity Test
*"Price penetrated the most recent N-candle extremum, closed back within the range within X candles, generated a directional movement exceeding Y times ATR with strong close, created a 3-candle imbalance, and offers a Z ratio to the opposing extremum."*
**Test Passed.** No subjective terminology remains.

## 40. Final Decision
### A. What is the exact V1 strategy?
HTF Bias Filter → LTF Sweep → Displacement → FVG → Retracement Limit Entry.

### B. What are the mandatory conditions?
Swing confirmation, Sweep Reclaim, ATR Displacement, FVG generation, Minimum RR, Session timing.

### C. What are the optional/contextual conditions?
None. All listed conditions are hard gates.

### D. What concepts are explicitly excluded?
Market Structure Shift (MSS), Equal Highs/Lows, Order Blocks, Premium/Discount, Point-based scoring, Intrabar evaluation.

### E. What parameters remain unresolved?
The exact integers/floats for the 7 parameters in Section 33.

### F. Which rules are ready for implementation?
All logical state transitions, boolean gates, and mathematical formulas outlined in this document.

### G. Which rules still require empirical validation before implementation?
None. The *rules* are finalized. The *parameter values* require testing.

### H. What assumptions must the future backtesting phase test?
The stability of the 7 parameters across multiple instruments and time periods (lack of overfitting), and the impact of spread/slippage on limit order fills at FVG boundaries.

### I. What is the smallest possible version of the strategy?
The defined V1 is the smallest possible version that maintains conceptual integrity without relying on subjective human analysis.

## 41. Next Phase
The next phase is **NOT implementation**.
The next phase should be:
**AXNNA — PROMPT 3: Strategy Validation & Backtesting Specification**
