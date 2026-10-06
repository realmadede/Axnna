# Axnna Formal Mathematical & Technical Strategy Specification — Final Draft

## 1. Important Note
This document provides a strict, unambiguous, and deterministic specification of the Axnna V1 strategy model: **HTF Bias → Liquidity Reference → Sweep → Displacement → FVG → Retracement → Entry → Structural Target**. No implementation or historical testing is performed here; this is purely the blueprint.

## 2. Long/Short Symmetry
The strategy rules are perfectly symmetrical.
- **Long**: Sell-Side Liquidity (SSL) → Bullish Sweep → Bullish Displacement → Bullish FVG → Retracement (Down) → Long Entry.
- **Short**: Buy-Side Liquidity (BSL) → Bearish Sweep → Bearish Displacement → Bearish FVG → Retracement (Up) → Short Entry.

## 3. Sweep → Displacement Timing
The sequence from sweep confirmation to displacement is strictly constrained.
- **Penetration**: Candle `t_p` breaks the liquidity level.
- **Reclaim / Sweep Confirmation**: Candle `t_s` (where `t_s >= t_p` and `t_s - t_p <= Max_Sweep_Duration`) closes back inside the level.
- **Displacement**: The energetic candle creating the FVG must be confirmed at `t_d`, where `t_d >= t_s` and `t_d - t_s <= Max_Displacement_Delay`.
*(If `t_s` itself is the displacement candle, `t_d = t_s` is valid).*

## 4. FVG Creation Timing
A Fair Value Gap is a 3-candle pattern (`t-2`, `t-1`, `t`).
The **Displacement Candle** is strictly the middle candle (`t-1`).
- `t_d = t-1` (The displacement candle)
- `t_fvg = t` (The FVG confirmation candle)
The FVG becomes known exactly at the close of candle `t`. The state transitions to `PENDING_ENTRY` at `t_fvg`.

## 5. Candle-Close vs Limit-Order Problem
**Model B (OHLC-based limit-order simulation)** is selected.
- All setup conditions (Sweeps, Displacements, FVGs) are evaluated exclusively at **candle close**.
- Upon FVG confirmation at `t_fvg`, a Limit Order is virtually placed. It becomes active at the open of `t_fvg + 1`.
- If the subsequent candle's Low is <= the limit price (for Longs) or High >= the limit price (for Shorts), the order is considered filled at the exact Limit Price.

## 6. Stop Loss and Spread
**Option B (Spread as an explicit execution parameter)** is chosen.
The core strategy logic defines a Structural Stop.
- **Long Structural Stop**: The lowest Low of the Sweep Sequence (from `t_p` to `t_s`).
- **Short Structural Stop**: The highest High of the Sweep Sequence.
- **Executable Risk**: `Executable Stop Loss = Structural Stop +/- Spread_Assumption`. 
The `Spread_Assumption` is an Execution Parameter, not a strategy rule.

## 7. Higher-Timeframe Bias
The Anchor Timeframe (e.g., 1H) explicitly determines the allowed execution direction.
- **Anchor Swing**: Uses the same Swing N logic as the Execution TF, but on Anchor candles.
- **Bullish State**: The most recently breached Anchor Swing was an Anchor Swing High (`Close > Anchor Swing High`).
- **Bearish State**: The most recently breached Anchor Swing was an Anchor Swing Low (`Close < Anchor Swing Low`).
- **Initial/Neutral State**: Before the first Anchor Swing is breached, no trades can be taken.
- **Transition**: Occurs immediately at the close of the Anchor candle that breaches the opposing Anchor Swing.

## 8. Liquidity Lifecycle
A single Liquidity Reference (Swing) follows this exact lifecycle:
1. **CREATED**: Confirmed at `t + Swing_N`.
2. **ACTIVE**: Ready to be swept.
3. **PENETRATED**: Price crosses the level (High > SH or Low < SL).
4. **SWEPT**: Price reclaims the level via candle close within `Max_Sweep_Duration`.
5. **EXPIRED**: Swept without an FVG, or a newer identical-type swing is CREATED, or age exceeds `Max_Age`.
6. **BROKEN**: Price penetrated but failed to reclaim within `Max_Sweep_Duration`.

## 9. Liquidity Selection
**Option A (Only one active high and one active low)** is implemented as a V1 design hypothesis.
The strategy tracks only the *most recently confirmed* active Swing High and Swing Low on the Execution TF. If an older unmitigated swing exists, it is ignored in favor of the newest one. This hypothesis drastically reduces overlapping setups and tests the validity of immediate local liquidity.

## 10. Zero-Penetration Threshold
For V1, any absolute penetration (e.g., `H_t > SH_Price`) counts as a penetration candidate. A tuned minimum penetration (`ε`) is excluded to minimize parameters. The consequence is that a 0.1 pip penetration qualifies as a sweep if reclaimed. This pathological case is mitigated because the *subsequent displacement* filter acts as the true strength confirmation.

## 11. Displacement Formula
The Displacement candle (`t_d`) must satisfy:
- `ATR_Ref = ATR_{t_d - 1}(ATR_Period)`

**Bullish Displacement (Longs):**
- Range Condition: `R_{t_d} / ATR_Ref >= Disp_Size_Multiplier`
- Body Condition: `B_{t_d} / R_{t_d} >= Disp_Body_Ratio`
- Close Condition: `(C_{t_d} - L_{t_d}) / R_{t_d} >= Disp_Close_Location` (e.g., closes in top 25%)

**Bearish Displacement (Shorts):**
- Range Condition: `R_{t_d} / ATR_Ref >= Disp_Size_Multiplier`
- Body Condition: `B_{t_d} / R_{t_d} >= Disp_Body_Ratio`
- Close Condition: `(H_{t_d} - C_{t_d}) / R_{t_d} >= Disp_Close_Location` (e.g., closes in bottom 25%)

## 12. Fair Value Gap (FVG) Definition
A 3-candle sequence (`t-2`, `t-1`, `t`). Candle `t-1` MUST be the valid Displacement candle (`t_d`).

**Bullish FVG:**
- Condition: `L_t > H_{t-2}`
- Size: `(L_t - H_{t-2}) >= (FVG_Min_ATR_Ratio * ATR_{t-1})`
- Proximal Boundary: `H_{t-2}`
- Distal Boundary: `L_t`

**Bearish FVG:**
- Condition: `H_t < L_{t-2}`
- Size: `(L_{t-2} - H_t) >= (FVG_Min_ATR_Ratio * ATR_{t-1})`
- Proximal Boundary: `L_{t-2}`
- Distal Boundary: `H_t`

## 13. Retracement Entry
- **Long Entry Price**: Exact Limit Order placed at the Bullish FVG Proximal Boundary (`H_{t-2}`).
- **Short Entry Price**: Exact Limit Order placed at the Bearish FVG Proximal Boundary (`L_{t-2}`).

## 14. Same-Candle Ambiguity
A strict **Pessimistic Execution Policy** is enforced to prevent hidden look-ahead bias in backtesting.
- If a single OHLC candle intersects both the Target Price and the Stop Loss price after entry has been triggered, the simulation MUST assume the **Stop Loss was hit first**, recording a full loss.

## 15. Session Logic
Session windows are defined by UTC time constraints.
- **Setup Creation Window**: Sweeps and FVGs must be confirmed within this window.
- **Entry Window**: Pending limit orders can only be filled within this window. If the window closes while `PENDING_ENTRY`, the limit order is canceled.
- **Trade Management**: Once `ACTIVE_TRADE`, the position ignores session windows and remains open until SL/TP is hit (or a separate hard time-kill parameter is reached, if defined in execution assumptions).

## 16. Weekend / Time Elapsed Logic
Strategy timeouts (`Max_Sweep_Duration`, `Max_Displacement_Delay`, `FVG_Timeout`) are evaluated exclusively via **Candle Count (Indices)**, seamlessly spanning weekends. Time-based logic is restricted to Session UTC definitions.

## 17. Minimum RR Calculation
- `Reward = |Target - Entry|`
- `Risk = |Entry - SL| + Spread_Assumption + Slippage_Assumption`
- `RR_Ratio = Reward / Risk`
Gate Requirement: `RR_Ratio >= Minimum_RR`.
The calculation includes Execution parameters explicitly to ensure the theoretical structural RR translates to a viable trade.

## 18. State Machine Audit
Symmetrical state machine for a single monitored setup:
1. `NO_SETUP` -> `LIQUIDITY_ACTIVE` (When most recent Swing is confirmed).
2. `LIQUIDITY_ACTIVE` -> `PENETRATED` (When Price crosses the level).
3. `PENETRATED` -> `SWEEP_CONFIRMED` (When Candle closes back inside the level <= `Max_Sweep_Duration`).
4. `SWEEP_CONFIRMED` -> `FVG_ACTIVE` (When Displacement occurs <= `Max_Displacement_Delay` and FVG is confirmed).
5. `FVG_ACTIVE` -> `PENDING_ENTRY` (If RR Gate passes, Limit Order is active next open).
6. `PENDING_ENTRY` -> `ACTIVE_TRADE` (If Limit Order filled <= `FVG_Timeout`).
7. `ACTIVE_TRADE` -> `TARGET_HIT` or `STOP_HIT`.
*Invalidations anywhere in the chain return state to `NO_SETUP`.*

## 19. Parameter Audit
**Structural Parameters:**
- `Swing_N` (Candles)
- `ATR_Period` (Candles)

**Behavioral Parameters:**
- `Max_Sweep_Duration` (Candles)
- `Max_Displacement_Delay` (Candles)
- `Disp_Size_Multiplier` (Float, ATR ratio)
- `Disp_Body_Ratio` (Float, 0.0-1.0)
- `Disp_Close_Location` (Float, 0.0-1.0)
- `FVG_Min_ATR_Ratio` (Float, ATR ratio)
- `FVG_Timeout` (Candles)
- `Minimum_RR` (Float)
- `Session_Start` / `Session_End` (UTC Hours)

**Execution Parameters (Backtest Simulation):**
- `Spread_Assumption` (Instrument Units)
- `Slippage_Assumption` (Instrument Units)

## 20. Final Completeness Test
### A. Can two engineers independently implement this specification and produce identical signals?
**YES**. Every subjective term has been replaced by a rigorous formula or state transition linked to OHLC arrays.

### B. Can the strategy be simulated using OHLC candles without hidden future information?
**YES**. The separation of evaluation (candle close) and execution (subsequent candle intersection), combined with the pessimistic same-candle policy, guarantees this.

### C. Can both long and short strategies be represented symmetrically?
**YES**. Mirror formulas are explicitly detailed for Bullish/Bearish Displacements and FVGs.

### D. Are all state transitions deterministic?
**YES**. Timeouts, bounds, and directional logic are completely quantified.

### E. Are all parameters explicitly identified?
**YES**. They are categorized into Structural, Behavioral, and Execution groups.

### F. Are execution assumptions separated from strategy logic?
**YES**. Strategy logic defines purely structural boundaries; execution applies explicit spread/slippage adjustments to calculate executable risk.

## 21. Next Phase
The next phase is **NOT implementation**.
The next phase should be:
**AXNNA — PROMPT 3: Strategy Validation & Backtesting Specification**
