# Axnna Backtest Engine Implementation Specification — Final Draft

## 1. Primary Objective
The objective of this specification is to define a robust, deterministic, and modular software architecture for the Axnna V1 backtest engine. This blueprint must ensure that independent implementations using the exact same inputs (dataset, parameters, execution assumptions) will yield bit-for-bit identical setup sequences, trades, and performance metrics, meticulously adhering to the frozen Strategy Specification (v4) and Backtesting Specification.

## 2. Implementation Principles
The backtest engine will strictly follow these principles:
- **Deterministic and Reproducible**: Identical seeds, data, and config yield identical outputs.
- **Chronological Loop**: Data is ingested strictly candle-by-candle (step-wise).
- **Zero Look-Ahead**: The engine is explicitly banned from using vectorized operations (like pandas `.rolling()` or `.shift()`) for state transitions, as these often leak future data.
- **Separation of Concerns**: Strategy logic generates signals; the Execution Simulator models the fills; the Metrics Layer scores them.
- **Instrument Isolation**: No state is shared across instruments.

## 3. Architectural Layers
- **Data Layer**: Loads, validates, timestamps, and sorts OHLC data. Checks for missing/corrupt candles.
- **Indicator Layer**: Computes Wilder ATR recursively. Completely blind to strategy logic.
- **Market Structure Layer**: Manages LTF and HTF swings, liquidity reference lifecycles, and HTF Bias transitions.
- **Strategy State Engine**: Implements the V1 State Machine (`NO_SETUP` through `INVALIDATED`).
- **Execution Simulator**: Processes pending limit orders, simulates OHLC fills with Pessimistic Policy, and applies Execution costs (spread/slippage).
- **Trade Ledger**: Maintains an immutable append-only record of completed setups and trades.
- **Metrics Layer**: Aggregates ledger data into statistical and R-multiple metrics.
- **Experiment Layer**: Orchestrates the run using a frozen JSON/YAML parameter configuration.

## 4. Repository Inspection & Tech Stack
An inspection reveals the repository is currently a blank slate containing only documentation. 
**Proposed Tech Stack**:
- **Language**: Python 3.10+ (using strict type hinting `mypy`).
- **Core Loop**: Pure Python classes (for strict event-by-event control without pandas vectorization leaks).
- **Data/Metrics**: `pandas` and `numpy` strictly isolated to the Data Loader (pre-loop) and Metrics Layer (post-loop).
- **Configuration**: `pydantic` for strict type validation of experiment parameters.
- **Testing**: `pytest` for unit, integration, and synthetic fixture validation.

## 5. Canonical Internal Data Model
Data classes must be immutable where practical:
- `Candle`: `timestamp` (UTC), `open`, `high`, `low`, `close`.
- `Swing`: `candidate_index`, `confirmation_index`, `price`, `type` (BSL/SSL), `state`, `timestamp`.
- `LiquidityReference`: Extends Swing, adds `penetration_timestamp`, `is_frozen`, `is_consumed`.
- `Setup`: `id`, `instrument`, `direction`, `liquidity_ref`, `t_p`, `t_s`, `t_d`, `t_fvg`, `entry_price`, `stop_price`, `target_price`, `structural_rr`, `state`, `terminal_reason`.
- `Trade`: `setup_id`, `instrument`, `direction`, `entry_price`, `stop_price`, `target_price`, `fill_time`, `exit_time`, `exit_reason`, `structural_risk`, `realized_pnl`, `r_multiple`, `execution_costs`.

## 6. Strategy Engine Contract
The Strategy Engine receives a single `TickEvent` (representing a completed Execution TF candle) at a time. The engine queries the internal layers (HTF Bias, ATR, Liquidity) strictly at the current index. It returns state transition events (e.g., `SetupCreated`, `SetupInvalidated`) rather than opaque booleans, yielding full auditable context.

## 7. HTF Synchronization
The Anchor TF (1H) is synchronized with the Execution TF (5M).
- During the step loop at Execution candle `t_exec_close`, the HTF data manager provides the latest Anchor candle where `t_anchor_close <= t_exec_close`. 
- Missing candles are handled by persisting the last known valid Anchor close.
- HTF Bias updates sequentially BEFORE the LTF strategy evaluates its state machine.

## 8. Swing Engine
Implements the exact N-bar pivot logic.
- Maintains a rolling window of size `(2N + 1)`.
- Center candle (`i`) is evaluated against `[i-N ... i-1]` and `[i+1 ... i+N]`.
- Equal highs/lows are rejected using strict inequalities (`>`).
- The event `SWING_CONFIRMED` is only emitted when the window slides past `i+N`.

## 9. ATR Engine
Implements Wilder's Smoothing.
- `TR_t` calculation explicitly handles gaps against the previous close.
- Returns `None` for indices `< ATR_Period`.
- Seed is `SMA` at index `ATR_Period`.
- Formula: `ATR_t = ((ATR_{t-1} * (n-1)) + TR_t) / n`.
- Verified against a static fixture array to prevent floating-point drift.

## 10. Liquidity Manager
Manages two slots: `Active_BSL` and `Active_SSL`.
- Upon `SWING_CONFIRMED`, it replaces the active slot unless the slot is `is_frozen` (penetrated but unresolved setup).
- Tracks `is_consumed`. Once a setup reaches a terminal state, the frozen liquidity is marked consumed, the slot is emptied, and the engine waits for a newly confirmed swing.

## 11. HTF Bias Engine
State: `NEUTRAL`, `BULLISH`, `BEARISH`.
- Evaluates the current Anchor `Close` against the active Anchor BSL/SSL.
- Transitions strictly on Anchor candle close.
- Bias persists until an opposite Anchor structural break.

## 12. Sweep Engine
Evaluates the currently frozen Liquidity Reference.
- Evaluates penetration strictly using `H_t > BSL` or `L_t < SSL`.
- Tracks `Max_Sweep_Duration` via candle index delta.
- Triggers `SWEEP_CONFIRMED` on reclaim close, or `BROKEN` on timeout.

## 13. Displacement Engine
Evaluates momentum for the sequence `[t_s, t_s + Max_Displacement_Delay]`.
- `R_t = 0` instantly yields `FALSE`.
- Verifies range multiplier, body ratio, and close location.
- Locks `t_d` on the first qualifying candle. Expiration causes `INVALIDATED`.

## 14. FVG Engine
Evaluates exactly on `t_d + 1`.
- Tests the 3-candle imbalance logic (`t_d - 1`, `t_d`, `t_d + 1`).
- Locks Entry price (`H_{t-2}` or `L_{t-2}`).
- Rejects immediately (`INVALIDATED`) if the condition fails.

## 15. Stop / Target / RR Engine
Executes exactly at `t_fvg` (setup confirmation).
- Calculates Structural Stop (extreme of `[t_p ... t_fvg]`).
- Selects Target from the active opposing LTF liquidity slot.
- Validates geometric inequalities (`Stop < Entry < Target`).
- Evaluates `Target-Entry / Entry-Stop >= Minimum_RR`.
- Returns an immutable `Setup` object if valid.

## 16. Execution Simulator
Accepts `PENDING_ENTRY` setups.
- Checks intersection `Low_t <= Entry` (Long).
- **Pessimistic Handling**: If filled, it immediately checks if Stop and Target are within the same `t` candle range. If both, registers `STOP_HIT`.
- Does not modify strategy structural geometry; adds `Spread_Assumption` to execution cost P&L only.

## 17. Session Engine
Checks `UTC_Time` at candle close.
- Handles midnight wrapping via `OR` logic if `Start > End`.
- Gating mechanism: If `PENDING_ENTRY` and session transitions to inactive, triggers `EXPIRED`.

## 18. Event / State Machine Implementation
The core execution loop (per LTF candle) strictly follows:
1. Sync HTF Data -> Update HTF Bias.
2. Update Swings -> Update LTF Liquidity.
3. Penetration Check.
4. Sweep Timeout / Reclaim Check.
5. Invalidation Check (opposite close).
6. Displacement Check.
7. FVG Check.
8. RR Geometry Check -> Transition to `PENDING_ENTRY`.
9. Simulate Limit Order Fill -> Transition to `ACTIVE_TRADE`.
10. Check Stops/Targets -> Transition to Terminal State.
11. Handle Timeouts/Expirations.
Terminal transitions immediately `continue` the loop, preventing same-candle setup chaining.

## 19. Immutable Setup Snapshot
The `Setup` object is implemented as a Python `@dataclass(frozen=True)`. Attempting to mutate targets or stops post-creation will throw runtime errors, mathematically enforcing specification immutability.

## 20. Trade Ledger
A pre-allocated list or SQLite in-memory table storing completed `Trade` dataclasses. Exportable strictly to CSV or Pandas DataFrame at the end of the simulation.

## 21. Execution Cost Interface
A dedicated `ExecutionModel` class passed into the Simulator. It intercepts the raw structural `R_Multiple` and applies fixed `Spread_Assumption` and `Slippage_Assumption` penalties to the final realized `P&L` output.

## 22. Experiment Configuration
Implemented via `pydantic.BaseModel`.
- Validates ranges (e.g., `Minimum_RR >= 1.0`, `0 <= Disp_Body_Ratio <= 1`).
- Defines exactly 14 Strategy parameters and 2 Execution parameters.

## 23. Determinism Requirements
- No `random` module usage unless explicitly seeded for Monte Carlo.
- No relying on dictionary insertion order (use lists/tuples for priority).
- Standardized handling of missing timestamps.

## 24. Numerical Precision
- Standard 64-bit floating point is acceptable for price data if exact strict inequality (`>`) is used.
- To prevent microscopic floating-point rounding errors on "equal" highs, equality is checked using `math.isclose(a, b, abs_tol=1e-5)`.

## 25. Data Isolation
The engine provides a `BacktestSession` class scoped strictly to one instrument dataset. Parallel processing (e.g., `multiprocessing.Pool`) is used to run instruments simultaneously without shared memory.

## 26. Error Handling
- Invalid JSON config raises immediate `ValidationError`.
- Data gaps exceeding a maximum threshold yield a `DataIntegrityError`.
- Uninitialized ATR requests raise `NotReadyException`.
All errors halt the test, producing explicit diagnostic output.

## 27. Logging and Audit Events
Implemented using standard Python `logging`.
Events are serialized as JSON logs: `{"event": "SWEEP_CONFIRMED", "timestamp": "...", "price": "...", "setup_id": "..."}`.
Log levels separate DEBUG (every candle evaluation) from INFO (state transitions).

## 28. Testing Strategy
A `tests/` directory leveraging `pytest`.
- **Unit**: Mathematical validation of Swings, ATR, HTF Sync.
- **State Machine**: Testing valid/invalid transition arrays.
- **Integration**: Complete loop over synthetic datasets.
- **Determinism**: Asserting `run_A == run_B`.
- **No-Look-Ahead**: Truncating datasets midway and asserting identical state up to the truncation point.

## 29. Synthetic Test Fixtures
Hardcoded lists of OHLC tuples in `tests/fixtures/`.
Includes edge cases: zero-range candles, same-candle sweep+reclaim, session boundary crossover, same-candle entry+stop hit.

## 30. Performance Requirements
The engine must process 10 years of 5M data (~700,000 candles) for a single instrument in under 10 seconds. This necessitates tight inner loops avoiding dictionary instantiations per candle, utilizing pre-allocated arrays where practical, without resorting to Cython/C++ for V1.

## 31. Backtest Output Contract
The engine returns an `ExperimentResult` object containing:
- `trades`: DataFrame of all trades.
- `metrics`: Dictionary of computed KPIs (Expectancy, Max Drawdown, Profit Factor).
- `manifest`: Metadata dict containing checksums and parameters.

## 32. CLI / Programmatic Interface
Uses `argparse` or `click`:
- `python -m axnna.cli backtest --config config.yaml --data data/`
- `python -m axnna.cli validate-data --file EURUSD.csv`

## 33. Reproducibility Manifest
A JSON file written alongside every test result. Contains:
`experiment_id`, `git_commit_hash`, `dataset_sha256`, `parameters`, `execution_assumptions`, `start_time`, `end_time`.

## 34. Security / Reliability
Datasets (CSV/Parquet) are strictly parsed for correct datatypes. YAML configs use `safe_load`.

## 35. Explicit Non-Goals
The implementation completely ignores: live broker APIs, websockets, database integrations (Postgres/Redis), order book depth, predictive machine learning, and dynamic parameter optimization loops.

## 36. Final Architecture Review
### A. Repository Architecture
```text
Axnna/
├── axnna/
│   ├── core/           # Data models (Candle, Swing, Setup, Trade)
│   ├── data/           # Loaders, validation, HTF sync
│   ├── indicators/     # ATR, Swing math
│   ├── strategy/       # State Machine, Liquidity Mgr, FVG/Sweep logic
│   ├── execution/      # Simulator, Limit Orders, Pessimistic Policy
│   ├── metrics/        # P&L, R-Multiples, Drawdown
│   └── cli.py          # Entrypoints
├── tests/
│   ├── fixtures/       # Synthetic OHLC data
│   ├── unit/
│   └── integration/
├── docs/
└── requirements.txt
```
### B. Module Responsibilities
- `strategy/` owns logic rules.
- `execution/` owns fills and costs.
- `core/` owns immutable data definitions.

### C. Data Flow
`Raw OHLC` → `Data Layer (Sync)` → `Indicators (ATR, Swings)` → `Strategy (State Machine)` → `Execution (Limit Fills)` → `Ledger` → `Metrics`.

### D. State Flow
Maps exactly to the 12-state terminal model detailed in Strategy Spec v4.

### E. Dependency Graph
`metrics` depends on `core`. `execution` depends on `core`. `strategy` depends on `core`, `indicators`. `cli` depends on all. No circular dependencies allowed.

### F. Testing Matrix
- Rule 1 (Swing N) -> `tests/unit/test_swings.py`
- Rule 2 (Session) -> `tests/unit/test_sessions.py`
- Rule 3 (Pessimistic Fill) -> `tests/integration/test_simulator.py`

### G. Implementation Order
1. `core` Data Models.
2. `indicators` (ATR, Swings) + Tests.
3. `data` (HTF Sync, Loaders) + Tests.
4. `strategy` (State Machine).
5. `execution` (Simulator).
6. Synthetic Integration Tests.
7. `metrics` and `cli`.

## 37. Final Engineering Completeness Test
- **A. Can an engineer implement the engine without making strategy decisions?** YES. The exact mathematical and chronological priority is defined.
- **B. Can the engine produce deterministic results from identical inputs?** YES. Python's state is strictly isolated; dictionaries are not relied upon for evaluation order.
- **C. Can every generated trade be traced to the candles that created it?** YES. Setup dataclasses freeze exact timestamps for all major events (`t_p`, `t_s`, `t_d`, `t_fvg`).
- **D. Can look-ahead contamination be detected through tests?** YES. Event-driven loops naturally prevent rolling array lookahead, verified by truncation testing.
- **E. Are strategy and execution concerns separated?** YES. Strategy objects output Structural RR; Execution simulators append spread/slippage logic.
- **F. Can Prompt 5 begin implementation without requiring another architectural redesign?** YES. The blueprint maps directly to a standard modular Python architecture.

## Final Decision
The Axnna Backtest Engine architecture is fully defined, deterministic, modular, and strictly aligned with the Strategy and Backtesting specifications. It is ready for engineering implementation.

The next phase should be:
**AXNNA — PROMPT 5: Backtest Engine Implementation**
