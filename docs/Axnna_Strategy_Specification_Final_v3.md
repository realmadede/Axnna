# Axnna Formal Mathematical & Technical Strategy Specification — Final Draft v3

## 1. Primary Objective
This document provides a strict, unambiguous, and deterministic specification of the Axnna V1 strategy model: **HTF Bias → Liquidity Reference → Sweep → Displacement → FVG → Retracement → Entry → Structural Target**. No implementation or historical testing is performed here; this is purely the algorithmic blueprint designed to ensure two independent engineers produce mathematically identical backtests.

## 2. Long/Short Symmetry
The strategy rules are perfectly symmetrical.
- **Long**: Sell-Side Liquidity (SSL) → Bullish Sweep → Bullish Displacement → Bullish FVG → Retracement (Down) → Long Entry.
- **Short**: Buy-Side Liquidity (BSL) → Bearish Sweep → Bearish Displacement → Bearish FVG → Retracement (Up) → Short Entry.

## 3. Formal Data Model & ATR Initialization
The strategy requires **OHLC data** exclusively. Volume, tick data, and bid/ask spreads are excluded from core setup generation. 
Variables for candle `t`: `O_t`, `H_t`, `L_t`, `C_t`, `R_t = H_t - L_t`, `B_t = |C_t - O_t|`.

**ATR Initialization**:
- **True Range**: For `t=1`, `TR_1 = H_1 - L_1`. For `t > 1`, `TR_t = max(H_t - L_t, |H_t - C_{t-1}|, |L_t - C_{t-1}|)`.
- **Seed**: `ATR_n = SMA(TR_1 ... TR_n)` where `n = ATR_Period`.
- **Recursive Update**: For `t > n`, `ATR_t = ((ATR_{t-1} * (n-1)) + TR_t) / n`.
- **Constraint**: No signal generation may occur before ATR is initialized at candle `n`.

## 4. Time and Candle Conventions
- **Internal Timezone**: UTC must be used universally.
- **Missing-Market Periods**: Timeout counters (e.g., `FVG_Timeout`) increment strictly based on **processed market candles** (indices). Weekends or holidays do not consume timeout units. Wall-clock time is only used for Session Windows.

## 5. Synchronizing HTF and LTF Data
At each Execution TF candle close, Anchor TF (HTF) data is synchronized deterministically.
- Only Anchor candles whose close timestamp is less than or equal to the Execution candle's close timestamp are considered available.
- No partially formed Anchor candle may influence the bias.
- The HTF bias update is processed **before** the Execution setup evaluation for that exact timestamp.

## 6. Higher-Timeframe (HTF) Bias
- **Anchor Swing Universe**: The system tracks strictly the latest active Anchor Swing High and latest active Anchor Swing Low.
- **Bullish Break**: `C_t > AnchorSwingHighPrice`
- **Bearish Break**: `C_t < AnchorSwingLowPrice`
*(Wick penetration does not change HTF bias. Only a candle close confirms a transition.)*
- **Initial State**: `BIAS = NEUTRAL`
- **Transitions**: `NEUTRAL → BULLISH` or `BEARISH → BULLISH` occurs at the exact close of the qualifying bullish break candle. Mirror logic applies to bearish.
- **Same-Candle Conflict**: Because the transition strictly requires a `Close` price, a single Anchor candle cannot simultaneously close above the Swing High and below the Swing Low. No conflict can exist.

## 7. Exact Swing Formula & Liquidity Lifecycle
A candidate **Swing High** at index `i` requires:
`H_i > H_{i-k}` AND `H_i > H_{i+k}` for every `k ∈ {1, ..., Swing_N}`.
A candidate **Swing Low** requires:
`L_i < L_{i-k}` AND `L_i < L_{i+k}` for every `k ∈ {1, ..., Swing_N}`.
- Equal highs do not qualify as Swing Highs; equal lows do not qualify as Swing Lows.
- A swing cannot be used before confirmation, which occurs precisely at the close of `i + Swing_N`.

**Liquidity Lifecycle States**:
- **CONFIRMED**: A swing whose confirmation candle (`i + Swing_N`) has just closed.
- **ACTIVE**: A confirmed swing that has not been superseded, penetrated, or expired.
- **PENETRATED**: A candle whose completed OHLC contains a strict penetration (BSL: `H_t > BSL`, SSL: `L_t < SSL`).
- **SWEPT**: The penetration sequence receives a reclaim close within `Max_Sweep_Duration`.
- **BROKEN**: The penetration never receives a reclaim within the allowed duration.
- **EXPIRED**: No longer eligible for future setups due to lifecycle limits.

## 8. Supersession of Active Liquidity
- **Global Tracking**: V1 tracks exactly ONE selected active Swing High and ONE selected active Swing Low. A newly confirmed swing replaces the currently selected ACTIVE swing of the same type.
- **Frozen Setup Liquidity**: A swing that has already entered `PENETRATED` is **frozen** for that setup candidate and cannot be replaced by a newly confirmed swing. 

## 9. Setup Concurrency Limit
**At most one setup candidate may be monitored per instrument at any time.**
Once an instrument has a setup anywhere in the sequence from `PENETRATED` through `ACTIVE_TRADE`, no second independent setup may replace or coexist with it. Only upon a terminal resolution (`TARGET_HIT`, `STOP_HIT`, `EXPIRED`, `INVALIDATED`) does the instrument become eligible for a new setup.

## 10. Sequential Evaluation Order
For strict determinism, at each completed Execution TF candle, events are processed in this exact order:
1. Sync HTF Data and update HTF Bias.
2. Process newly confirmed Execution TF swings.
3. Update currently selected ACTIVE liquidity references (if not frozen).
4. Evaluate penetration of ACTIVE references.
5. Evaluate reclaim / sweep confirmation.
6. Evaluate post-sweep invalidation.
7. Evaluate displacement eligibility.
8. Confirm FVG if the selected displacement candle is the required middle candle.
9. Validate structural geometry; calculate and freeze Entry, Structural Stop, Target, and RR; transition to `PENDING_ENTRY`.
10. Simulate pending-order fill (transition to `ACTIVE_TRADE`).
11. If `ACTIVE_TRADE`, evaluate Stop/Target execution.
12. Apply timeout/expiration rules where relevant.
*A later rule in this sequence cannot rewrite the state established by an earlier higher-priority event on the exact same candle.*

## 11. Multi-Condition Ambiguities & Invalidation
- **Penetration + Reclaim on Same Candle**: Permitted. `t_p = t_s` is valid if `H_t > BSL` AND `C_t < BSL` (or mirror for SSL).
- **Simultaneous Opposite Penetration**: If both active BSL and SSL are penetrated on the same candle before either setup has confirmed, both are marked `AMBIGUOUS` and instantly `INVALIDATED`.
- **Post-Sweep Invalidation**: If, before FVG confirmation, price closes beyond the swept level (e.g., Long: `C_t < Swept_SSL_Price`), the setup is `INVALIDATED`. If a candle is eligible for both Displacement AND Post-Sweep Invalidation, the Invalidation wins before Displacement is accepted.
- **Opposite Sweep Invalidation**: If an active opposing liquidity reference is penetrated while a setup is between `PENETRATED` and `FVG_ACTIVE`, the current setup is `INVALIDATED`.

## 12. Displacement Formula
Evaluated at `t_d`, using `ATR_Ref = ATR_{t_d - 1}(ATR_Period)`.
If `R_{t_d} = 0`, the displacement condition is explicitly `FALSE`.
**Bullish Displacement:**
- `R_{t_d} / ATR_Ref >= Disp_Size_Multiplier`
- `B_{t_d} / R_{t_d} >= Disp_Body_Ratio`
- `(C_{t_d} - L_{t_d}) / R_{t_d} >= Disp_Close_Location`
**Bearish Displacement:**
- `R_{t_d} / ATR_Ref >= Disp_Size_Multiplier`
- `B_{t_d} / R_{t_d} >= Disp_Body_Ratio`
- `(H_{t_d} - C_{t_d}) / R_{t_d} >= Disp_Close_Location`

## 13. Fair Value Gap (FVG) Timing & Definition
The Displacement Candle MUST be the middle candle (`t-1`) of the 3-candle sequence.
`t_d = t-1` and `t_fvg = t`.
**Bullish FVG:**
- Condition: `L_{t_fvg} > H_{t_fvg - 2}`
- Size: `(L_{t_fvg} - H_{t_fvg - 2}) >= (FVG_Min_ATR_Ratio * ATR_{t_fvg - 1})`
- Entry Price (Proximal Boundary): `H_{t_fvg - 2}`
**Bearish FVG:**
- Condition: `H_{t_fvg} < L_{t_fvg - 2}`
- Size: `(L_{t_fvg - 2} - H_{t_fvg}) >= (FVG_Min_ATR_Ratio * ATR_{t_fvg - 1})`
- Entry Price (Proximal Boundary): `L_{t_fvg - 2}`

## 14. Stop Loss, Target & Structural Geometry
Evaluated and permanently frozen at `t_fvg`.
- **Long Stop**: `Structural Stop = min(Low_t)` over `t ∈ [t_p, t_fvg]`.
- **Short Stop**: `Structural Stop = max(High_t)` over `t ∈ [t_p, t_fvg]`.
- **Long Target**: Selected ACTIVE Swing High strictly above Entry.
- **Short Target**: Selected ACTIVE Swing Low strictly below Entry.
*(If no valid target exists, the setup is `INVALIDATED`).*

**Structural Price Geometry Validation**:
- Longs MUST satisfy: `Structural Stop < Entry < Target`
- Shorts MUST satisfy: `Target < Entry < Structural Stop`
- Risk MUST be > 0.
If any condition fails, the setup is `INVALIDATED`.

## 15. Minimum RR and Separation of Execution Costs
- `Long Risk = Entry - Structural Stop`
- `Long Reward = Target - Entry`
- `Short Risk = Structural Stop - Entry`
- `Short Reward = Entry - Target`
**Gate Requirement**: `Structural Reward / Structural Risk >= Minimum_RR`
Execution costs (Spread/Slippage) are completely excluded from the strategy State Machine logic and RR gate.

## 16. OHLC Limit-Order Simulation & Trade Management
The simulator does not know the actual historical intrabar path. It uses a predetermined deterministic OHLC convention:
- **Limit Order Fill**: A pending order is filled if the subsequent candle intersects the Limit price. (Long: `L_t <= Entry`, Short: `H_t >= Entry`).
- **Fill Price**: Always exactly `EntryPrice`, regardless of gaps.
- **Same-Candle Ambiguity**: Entry is considered filled first for state-accounting purposes. If both the Target and the Stop Loss are reachable within that exact same candle's OHLC range, the simulation MUST record `STOP_HIT`.

## 17. FVG Timeout Indexing
If FVG is confirmed at `t_fvg`, the eligible limit-order fill candles are strictly:
`t_fvg + 1` through `t_fvg + FVG_Timeout` (inclusive).

## 18. Session Windows
- **Midnight-Crossing Logic**: 
  - If `Start < End`: `Start <= UTC_Time < End`
  - If `Start > End`: `UTC_Time >= Start OR UTC_Time < End`
- **Setup Creation Window**: Penetration, Sweep, Displacement, and FVG must all be confirmed while this window is active.
- **Entry Window**: The pending limit order can only be filled while this window is active. `PENDING_ENTRY` at window close → `EXPIRED`.
- **Trade Management**: Once `ACTIVE_TRADE`, the trade ignores session windows and remains open until Structural SL/TP is hit.

## 19. Complete State Machine
1. `NO_SETUP` → `LIQUIDITY_ACTIVE` (When most recent Swing is confirmed).
2. `LIQUIDITY_ACTIVE` → `PENETRATED` (When Price crosses the level. Level is now frozen).
3. `PENETRATED` → `SWEEP_CONFIRMED` (When Candle reclaims level <= `Max_Sweep_Duration`).
4. `SWEEP_CONFIRMED` → `DISPLACEMENT_CONFIRMED` (When `t_d` is selected <= `Max_Displacement_Delay`).
5. `DISPLACEMENT_CONFIRMED` → `FVG_ACTIVE` (When `t_fvg` confirms exactly immediately following `t_d`).
6. `FVG_ACTIVE` → `PENDING_ENTRY` (If Structural RR Geometry Gate passes. Target/Stop/Entry are now frozen).
7. `PENDING_ENTRY` → `ACTIVE_TRADE` (If Entry limit hit <= `FVG_Timeout` AND within Entry Window).
8. `ACTIVE_TRADE` → `TARGET_HIT` or `STOP_HIT`.
*Invalidations (timeout, post-sweep invalidation, opposite sweep, RR failure) return state to `NO_SETUP`.*

## 20. Parameter Inventory (Strictly 14 Parameters)
**Structural Parameters (2):**
- `Swing_N`
- `ATR_Period`

**Behavioral Parameters (10):**
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

**Execution Parameters (2) (Handled strictly by Backtest Engine):**
- `Spread_Assumption`
- `Slippage_Assumption`

## 21. Final Completeness Audit
- **A. Can two engineers independently implement the specification and produce identical signals?**
  **YES.** Every sequence evaluation priority is strictly codified.
- **B. Can it be simulated entirely from OHLC without hidden future information?**
  **YES.** Explicit definitions of historical path conventions are enforced.
- **C. Are long and short rules structurally symmetrical?**
  **YES.** Validated target universes and exact geometries are mirrored perfectly.
- **D. Are all state transitions deterministic?**
  **YES.** Priority rules resolve all intrabar or simultaneous occurrence conflicts.
- **E. Are all parameters explicitly identified?**
  **YES.** The 14 parameters encompass every degree of freedom.
- **F. Are execution assumptions clearly separated from strategy logic?**
  **YES.** RR geometry is strictly structural; execution costs apply externally.

## 22. Final Decision
The Axnna V1 strategy specification is completely, mathematically deterministic, symmetrical, and free of look-ahead bias and subjective interpretation. It handles OHLC limitations through explicit pessimistic simulation policies and synchronizes multi-timeframe structures with rigid timestamp inequalities. 

It is officially ready to proceed to the testing definition phase.

The next phase should be:
**AXNNA — PROMPT 3: Strategy Validation & Backtesting Specification**
