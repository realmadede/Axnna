# Axnna Formal Mathematical & Technical Strategy Specification — Final Draft v4

## 1. Primary Objective
This document provides a strict, unambiguous, and deterministic specification of the Axnna V1 strategy model: **HTF Bias → Liquidity Reference → Sweep → Displacement → FVG → Retracement → Entry → Structural Target**. No implementation or historical testing is performed here; this is purely the algorithmic blueprint designed to ensure two independent engineers produce mathematically identical setup signals. Backtest mechanics and performance accounting will be defined in a separate execution phase.

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
- **Missing-Market Periods**: Timeout counters (e.g., `FVG_Timeout`, `Max_Sweep_Duration`) increment strictly based on **processed market candles** (indices). Weekends or holidays do not consume timeout units. Wall-clock time is exclusively used for determining Session Window active status based on the UTC timestamp of the candle close.

## 5. Synchronizing HTF and LTF Data
At each Execution TF candle close, Anchor TF (HTF) data is synchronized deterministically.
- Only Anchor candles whose close timestamp is less than or equal to the Execution candle's close timestamp are considered available.
- No partially formed Anchor candle may influence the bias.
- The HTF bias update is processed **before** the Execution setup evaluation for that exact timestamp.

## 6. Higher-Timeframe (HTF) Bias & Persistence
- **Anchor Swing Universe**: The system tracks strictly the latest active Anchor Swing High and latest active Anchor Swing Low.
- **Bullish Break**: `C_t > AnchorSwingHighPrice`
- **Bearish Break**: `C_t < AnchorSwingLowPrice`
*(Wick penetration does not change HTF bias. Only a candle close confirms a transition.)*
- **Initial State**: `BIAS = NEUTRAL`
- **Transitions**: `NEUTRAL → BULLISH` or `BEARISH → BULLISH` occurs at the exact close of the qualifying bullish break candle. Mirror logic applies to bearish.
- **Persistence**: HTF bias persists until a new qualifying opposite Anchor Swing break is confirmed. The creation of a new Anchor Swing does not itself change bias.

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
- **EXPIRED**: No longer eligible for future setups.

## 8. Supersession & Permanent Consumption of Liquidity
- **Global Tracking**: V1 tracks exactly ONE selected active Swing High and ONE selected active Swing Low. A newly confirmed swing replaces the currently selected ACTIVE swing of the same type.
- **Frozen Setup Liquidity**: A swing that has already entered `PENETRATED` is **frozen** for that setup candidate and cannot be replaced by a newly confirmed swing. 
- **Permanent Consumption**: Once a selected liquidity reference enters `PENETRATED`, it is permanently consumed for future setup selection, regardless of whether the resulting setup is eventually swept, invalidated, expired, stopped, or targeted. It cannot become active again, older ignored swings cannot be promoted back, and the system must wait for a newly confirmed swing of that type.

## 9. Setup Concurrency & Terminal State Processing
**At most one setup candidate may be monitored per instrument at any time.**
Once an instrument has a setup anywhere in the sequence from `PENETRATED` through `ACTIVE_TRADE`, no second independent setup may replace or coexist with it. 

**Terminal State Processing**: Once the current setup reaches a terminal state (`TARGET_HIT`, `STOP_HIT`, `EXPIRED`, `INVALIDATED`), **processing for the current Execution candle stops immediately**. No new setup may be created or activated during that exact same candle. A new setup may begin only from the next processed Execution candle.

## 10. Sequential Evaluation Order & Precedence
For strict determinism, at each completed Execution TF candle, events are processed in this exact order:
1. Sync HTF Data and update HTF Bias.
2. Process newly confirmed Execution TF swings.
3. Update currently selected ACTIVE liquidity references (if not frozen).
4. Evaluate Penetration of ACTIVE references.
5. Evaluate Reclaim / Sweep confirmation. Evaluate timeout `Max_Sweep_Duration` first; if exceeded, transition to `BROKEN` then `INVALIDATED`.
6. Evaluate Post-Sweep Invalidation.
7. Evaluate Displacement eligibility. Evaluate deadline `Max_Displacement_Delay` first; if exceeded, transition to `INVALIDATED`.
8. Confirm FVG exactly on the next candle following the selected displacement. If FVG conditions fail, transition to `INVALIDATED`.
9. Validate structural geometry; calculate and freeze Entry, SL, Target, RR; transition to `PENDING_ENTRY`.
10. Simulate pending-order fill (transition to `ACTIVE_TRADE`). Evaluate `FVG_Timeout` or Session Close first; if exceeded, transition to `EXPIRED`.
11. If `ACTIVE_TRADE`, evaluate Stop/Target execution.

*A later rule in this sequence cannot rewrite the state established by an earlier higher-priority event on the exact same candle.*

## 11. Multi-Condition Ambiguities & Invalidation
- **Penetration + Reclaim on Same Candle**: Permitted. `t_p = t_s` is valid if `H_t > BSL` AND `C_t < BSL` (or mirror for SSL).
- **Simultaneous Opposite Penetration**: If both active BSL and SSL are penetrated on the same candle before either setup has confirmed, both are marked `AMBIGUOUS` and instantly `INVALIDATED`.
- **Post-Sweep Invalidation**: If, before FVG confirmation, price closes beyond the swept level in the invalidation direction (e.g., Long: `C_t < Swept_SSL_Price`), the setup is `INVALIDATED`.
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
The Displacement Candle (`t_d`) MUST be the middle candle (`t-1`) of the 3-candle sequence.
Exactly the next candle is evaluated as `t_fvg` (therefore `t_d = t-1` and `t_fvg = t`). If this exact subsequent candle fails the FVG condition, `DISPLACEMENT_CONFIRMED → INVALIDATED`.
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
*(Crucially, the target must still be ACTIVE at the exact moment it is frozen at `t_fvg`. If the selected opposing swing was already penetrated before `t_fvg`, it is no longer valid, and the setup is `INVALIDATED`).*

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
*(Execution costs like Spread/Slippage are completely excluded from this strategy State Machine logic and RR gate).*

## 16. OHLC Limit-Order Simulation & Trade Management
The simulator uses a predetermined deterministic OHLC convention to classify fills:
- **Limit Order Fill**: A pending order is filled if the subsequent candle intersects the Limit price. (Long: `L_t <= Entry`, Short: `H_t >= Entry`).
- **Fill Price**: Always exactly `EntryPrice`, regardless of gaps.
- **Same-Candle Ambiguity**: Entry is considered filled first. If both Target and Stop Loss are reachable within that exact same candle's OHLC range, the simulation MUST record `STOP_HIT`.

## 17. Session Windows
There is strictly **one single session window**: `Session_Start → Session_End`.
- **Setup Creation**: Penetration, Sweep, Displacement, and FVG must all be confirmed while the session is active. Session status is evaluated according to the UTC timestamp of the candle close on which the event becomes known. No intrabar session transitions exist.
- **Pending Entry**: A pending limit order may only fill while this same session window is active.
- **Session Close**: If `PENDING_ENTRY` remains unfilled when the session closes: `PENDING_ENTRY → EXPIRED`.
- **Trade Management**: Once `ACTIVE_TRADE`, the position ignores session windows and remains open until Structural SL/TP is hit.

## 18. Complete State Machine
1. `NO_SETUP` → `LIQUIDITY_ACTIVE` (When most recent Swing is confirmed).
2. `LIQUIDITY_ACTIVE` → `PENETRATED` (When Price crosses the level. Level is now frozen and permanently consumed).
3. `PENETRATED` → `SWEEP_CONFIRMED` (When Candle reclaims level <= `Max_Sweep_Duration`. Else `BROKEN` → `INVALIDATED`).
4. `SWEEP_CONFIRMED` → `DISPLACEMENT_CONFIRMED` (When `t_d` is selected <= `Max_Displacement_Delay`. Else `INVALIDATED`).
5. `DISPLACEMENT_CONFIRMED` → `FVG_ACTIVE` (When `t_fvg` confirms on the exactly adjacent candle. Else `INVALIDATED`).
6. `FVG_ACTIVE` → `PENDING_ENTRY` (If Structural RR Geometry Gate passes. Target/Stop/Entry are now frozen).
7. `PENDING_ENTRY` → `ACTIVE_TRADE` (If Entry limit hit <= `FVG_Timeout` AND within Session Window. Else `EXPIRED`).
8. `ACTIVE_TRADE` → `TARGET_HIT` or `STOP_HIT`.
*Any transition to a terminal state (`TARGET_HIT`, `STOP_HIT`, `EXPIRED`, `INVALIDATED`) immediately ends processing for the current Execution candle. No new setup may begin until the next candle.*

## 19. Parameter Inventory (Strictly 14 Parameters)
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

## 20. Final Determinism Audit
- **A. Can two engineers independently implement the strategy logic and produce identical setup signals?**
  **YES.** Sequence priority, target invalidation, and session constraints are completely rigid.
- **B. Can the strategy state be derived from OHLC and timestamps without future information?**
  **YES.** All rules strictly apply at candle close, and limit order simulations employ predefined conservative assumptions without claiming to reconstruct historical intrabar paths.
- **C. Are long and short rules structurally symmetrical?**
  **YES.** Target universes, stopping algorithms, and geometries are mirrored perfectly.
- **D. Are state transitions deterministic for every candle?**
  **YES.** Terminal processing aborts current candle evaluation, preventing same-candle chaining.
- **E. Are all strategy parameters explicitly identified?**
  **YES.** Strategy parameters are exactly defined and restricted to 14 total variables.
- **F. Are strategy rules separated from backtest-engine accounting?**
  **YES.** Strategy logic strictly controls signals and structural boundaries. Backtest execution mechanics (spread, P&L aggregation, transaction costs) are wholly deferred to the execution layer (Prompt 3).

## 21. Final Decision
The Axnna V1 strategy specification has resolved all lifecycle, session, and event-order ambiguities. It is now completely deterministic.

It is officially ready to proceed to the testing definition phase.

The next phase should be:
**AXNNA — PROMPT 3: Strategy Validation & Backtesting Specification**
