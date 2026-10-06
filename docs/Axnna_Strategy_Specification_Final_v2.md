# Axnna Formal Mathematical & Technical Strategy Specification — Final Draft v2

## 1. Primary Objective
This document provides a strict, unambiguous, and deterministic specification of the Axnna V1 strategy model: **HTF Bias → Liquidity Reference → Sweep → Displacement → FVG → Retracement → Entry → Structural Target**. No implementation or historical testing is performed here; this is purely the algorithmic blueprint designed to ensure two independent engineers produce mathematically identical backtests.

## 2. Long/Short Symmetry
The strategy rules are perfectly symmetrical.
- **Long**: Sell-Side Liquidity (SSL) → Bullish Sweep → Bullish Displacement → Bullish FVG → Retracement (Down) → Long Entry.
- **Short**: Buy-Side Liquidity (BSL) → Bearish Sweep → Bearish Displacement → Bearish FVG → Retracement (Up) → Short Entry.

## 3. Formal Data Model
The strategy requires **OHLC data** exclusively. Volume, tick data, and bid/ask spreads are excluded from core setup generation. 
Variables for candle `t`: `O_t`, `H_t`, `L_t`, `C_t`, `R_t = H_t - L_t`, `B_t = |C_t - O_t|`.
True Range (`TR`) and Average True Range (`ATR(n)`) use standard Wilder's smoothing.

## 4. Time and Candle Conventions
- **Internal Timezone**: UTC must be used universally.
- **Evaluation**: The strategy strictly evaluates **on candle close only**. No intrabar state transitions are permitted.
- **Missing-Market Periods**: Timeout counters (e.g., `FVG_Timeout`) increment strictly based on **processed market candles** (indices). Weekends or holidays do not consume timeout units. Wall-clock time is only used for Session Windows.

## 5. Instrument Normalization
All static point values are strictly banned. Displacement and momentum are normalized dynamically using `ATR(14)`.

## 6. Higher-Timeframe (HTF) Bias
The Anchor Timeframe (e.g., 1H) explicitly gates Execution TF setups.
- **Anchor Swing Universe**: The system tracks strictly the latest active Anchor Swing High and latest active Anchor Swing Low.
- **Bullish Break**: `C_t > AnchorSwingHighPrice`
- **Bearish Break**: `C_t < AnchorSwingLowPrice`
*(Wick penetration does not change HTF bias. Only a candle close confirms a transition.)*
- **Initial State**: `BIAS = NEUTRAL`
- **Transitions**: `NEUTRAL → BULLISH` or `BEARISH → BULLISH` occurs at the exact close of the qualifying bullish break candle. The mirror logic applies to bearish transitions.
- **Same-Candle Conflict**: Because the transition strictly requires a `Close` price, a single Anchor candle cannot simultaneously close above the Swing High and below the Swing Low. Therefore, no mathematical conflict can exist.

## 7. Liquidity Definition and Selection
- **Definition**: A Liquidity Reference is an N-left/N-right pivot. It is only confirmed at `t + N`.
- **Selection**: V1 evaluates strictly the most recently confirmed active Swing High (BSL) and Swing Low (SSL) on the Execution TF.
- **Zero-Penetration Threshold**: Any penetration (`H_t > BSL` or `L_t < SSL`) triggers a sweep sequence. No tunable penetration depth `ε` is used.

## 8. Liquidity Penetration and Freezing
- **Immutability**: Once a Liquidity Reference transitions to `PENETRATED`, that specific price level becomes **immutable** for the lifetime of that setup candidate. A newly confirmed swing of the same type does NOT replace the active penetrated reference.
- **Simultaneous Penetration Conflict**: If a single execution candle penetrates *both* the active BSL and active SSL before either setup is confirmed, both candidate sequences are marked ambiguous and instantly `INVALIDATED`. No intrabar ordering is assumed.

## 9. Sweep → Displacement Sequence & Invalidation
- **Penetration**: Candle `t_p` breaks the liquidity level.
- **Sweep Confirmation (Reclaim)**: Candle `t_s` (`t_s >= t_p` and `t_s - t_p <= Max_Sweep_Duration`) closes back inside the level.
- **Post-Sweep Invalidation**: After `PENETRATED`, if price violently violates the level again before FVG confirmation, the setup aborts. 
  - *Long Invalidation*: `C_t < Swept_SSL_Price` before FVG confirmation.
  - *Short Invalidation*: `C_t > Swept_BSL_Price` before FVG confirmation.
- **Displacement Candle (`t_d`)**: Must be the *earliest* candle satisfying all displacement conditions in the interval `[t_s, t_s + Max_Displacement_Delay]`. Once selected, `t_d` is immutable. If no candle qualifies, `SWEEP_CONFIRMED → INVALIDATED`.

## 10. Displacement Formula
Evaluated at `t_d`, using `ATR_Ref = ATR_{t_d - 1}(ATR_Period)`.
**Bullish Displacement (Longs):**
- `R_{t_d} / ATR_Ref >= Disp_Size_Multiplier`
- `B_{t_d} / R_{t_d} >= Disp_Body_Ratio`
- `(C_{t_d} - L_{t_d}) / R_{t_d} >= Disp_Close_Location`

**Bearish Displacement (Shorts):**
- `R_{t_d} / ATR_Ref >= Disp_Size_Multiplier`
- `B_{t_d} / R_{t_d} >= Disp_Body_Ratio`
- `(H_{t_d} - C_{t_d}) / R_{t_d} >= Disp_Close_Location`

## 11. Fair Value Gap (FVG) Timing & Definition
The Displacement Candle (`t_d`) MUST be the middle candle (`t-1`) of the 3-candle FVG sequence.
Therefore, `t_fvg = t`. No arbitrary gaps are allowed between displacement and FVG confirmation.
**Bullish FVG:**
- Condition: `L_{t_fvg} > H_{t_fvg - 2}`
- Size: `(L_{t_fvg} - H_{t_fvg - 2}) >= (FVG_Min_ATR_Ratio * ATR_{t_fvg - 1})`
- Proximal Boundary (Entry Price): `H_{t_fvg - 2}`
**Bearish FVG:**
- Condition: `H_{t_fvg} < L_{t_fvg - 2}`
- Size: `(L_{t_fvg - 2} - H_{t_fvg}) >= (FVG_Min_ATR_Ratio * ATR_{t_fvg - 1})`
- Proximal Boundary (Entry Price): `L_{t_fvg - 2}`

## 12. Take-Profit Rule
- **Long Target**: Nearest confirmed active opposing Buy-Side Liquidity (Swing High) strictly *above* the Entry price.
- **Short Target**: Nearest confirmed active opposing Sell-Side Liquidity (Swing Low) strictly *below* the Entry price.
- **Freezing**: The Target is evaluated on the Execution TF and **frozen** at `t_fvg` when the setup becomes `PENDING_ENTRY`. Later structure changes do NOT move the target. If no valid opposing liquidity exists, the setup is `INVALIDATED`.

## 13. Stop Loss Rule
- **Long Stop**: The absolute lowest `Low` of the Sweep Sequence (from `t_p` to `t_fvg`).
- **Short Stop**: The absolute highest `High` of the Sweep Sequence.
*(Stop Loss is also frozen at `t_fvg`).*

## 14. Minimum RR and Separation of Execution Costs
To prevent double-counting, RR is evaluated strictly geometrically.
- `Structural Risk = |Entry - Structural Stop|`
- `Structural Reward = |Target - Entry|`
- **Gate Requirement**: `Structural Reward / Structural Risk >= Minimum_RR`
Execution costs (Spread/Slippage) are completely excluded from the strategy State Machine logic and RR gate. They are isolated to the Execution/P&L accounting layer.

## 15. OHLC Limit-Order Simulation & Ambiguity Resolution
- **Limit Order Fill**: A pending order is filled if the subsequent candle intersects the Limit price. (Long: `L_t <= Entry`, Short: `H_t >= Entry`).
- **Gap Assumption**: The fill price is *always exactly* `EntryPrice`, regardless of whether the candle opened beyond it.
- **Same-Candle Ambiguity (Pessimistic Execution)**: If Entry, Target, and/or Stop are all reachable within the exact same OHLC candle, the simulation MUST record `STOP_HIT` and register a full loss to eliminate hidden look-ahead bias.

## 16. FVG Timeout Indexing
If FVG is confirmed at `t_fvg`, the eligible limit-order fill candles are strictly:
`t_fvg + 1` through `t_fvg + FVG_Timeout` (inclusive).
If not filled by the close of the final eligible candle, the setup transitions to `EXPIRED`.

## 17. Session Windows
- **Midnight-Crossing Logic**: 
  - If `Start < End`: `Start <= UTC_Time < End`
  - If `Start > End`: `UTC_Time >= Start OR UTC_Time < End`
- **Setup Creation Window**: Penetration, Sweep, Displacement, and FVG must all be confirmed while this window is active.
- **Entry Window**: The pending limit order can only be filled while this window is active. If the window closes while `PENDING_ENTRY`, the setup transitions to `EXPIRED`.
- **Trade Management**: Once `ACTIVE_TRADE`, the trade ignores session windows and remains open until Structural SL/TP is hit.

## 18. Complete State Machine
All transitions evaluate at candle close unless an execution limit is triggered during the candle.
1. `NO_SETUP` → `LIQUIDITY_ACTIVE` (When most recent Swing is confirmed).
2. `LIQUIDITY_ACTIVE` → `PENETRATED` (When Price crosses the level. Level is now frozen).
3. `PENETRATED` → `SWEEP_CONFIRMED` (When Candle reclaims level <= `Max_Sweep_Duration`).
4. `SWEEP_CONFIRMED` → `DISPLACEMENT_CONFIRMED` (When `t_d` is selected <= `Max_Displacement_Delay`).
5. `DISPLACEMENT_CONFIRMED` → `FVG_ACTIVE` (When `t_fvg` confirms immediately following `t_d`).
6. `FVG_ACTIVE` → `PENDING_ENTRY` (If Structural RR Gate passes. Target/Stop/Entry are now frozen).
7. `PENDING_ENTRY` → `ACTIVE_TRADE` (If Entry limit hit <= `FVG_Timeout` AND within Entry Window).
8. `ACTIVE_TRADE` → `TARGET_HIT` or `STOP_HIT`.
*Invalidations (timeout, opposite sweep, RR failure, post-sweep invalidation) return state to `NO_SETUP`.*

## 19. Parameter Inventory
**Structural Parameters:**
- `Swing_N`
- `ATR_Period`

**Behavioral Parameters:**
- `Max_Sweep_Duration`
- `Max_Displacement_Delay`
- `Disp_Size_Multiplier`
- `Disp_Body_Ratio`
- `Disp_Close_Location`
- `FVG_Min_ATR_Ratio`
- `FVG_Timeout`
- `Minimum_RR`
- `Session_Start`
- `Session_End`

**Execution Parameters (Handled strictly by Backtest Engine):**
- `Spread_Assumption`
- `Slippage_Assumption`

## 20. Completeness Audit
- **A. Can two engineers independently implement the specification and produce identical signals?**
  **YES.** Every ambiguity regarding sequence, freezing of targets, and limit-order simulation has been eradicated.
- **B. Can it be simulated entirely from OHLC without hidden future information?**
  **YES.** The strict Pessimistic Execution policy resolves all intrabar ambiguities deterministically.
- **C. Are long and short rules structurally symmetrical?**
  **YES.** Mirror definitions exist for all thresholds and invalidations.
- **D. Are all state transitions deterministic?**
  **YES.** Simultaneous penetrations and timeout intervals are rigidly defined.
- **E. Are all parameters explicitly identified?**
  **YES.** The parameter table isolates all 14 variables perfectly.
- **F. Are execution assumptions clearly separated from strategy logic?**
  **YES.** Spread and slippage have been completely decoupled from the strategy's Structural RR calculation.

## 21. Final Decision
The Axnna V1 strategy specification is now mathematically deterministic, symmetrical, and completely free of look-ahead bias and subjective interpretation. It is sufficiently rigorous to proceed to the testing definition phase.

The next phase should be:
**AXNNA — PROMPT 3: Strategy Validation & Backtesting Specification**
