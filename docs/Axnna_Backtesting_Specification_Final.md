# Axnna Strategy Validation & Backtesting Specification — Final Draft

## 1. Primary Objective
The objective of this specification is to define a rigorous, reproducible validation and backtesting methodology for the Axnna V1 strategy. It must determine whether the strategy possesses a statistically credible and economically meaningful historical edge. The system evaluates expectancy, robustness across instruments and time, parameter stability, and execution viability. The goal is to isolate a genuine edge from randomness, not to over-optimize for maximum historical profit.

## 2. Frozen Strategy Rule
The validation process MUST treat the **Axnna Formal Mathematical & Technical Strategy Specification — Final Draft v4** as strictly immutable. 
The backtest engine may NOT reinterpret definitions for liquidity, sweeps, or FVGs. It may NOT add concepts like Market Structure Shifts (MSS), order blocks, or premium/discount arrays. Discretionary filters, selective losing-trade removal, and scoring mechanisms are strictly banned. Implementation difficulties must be formally reported, not silently bypassed.

## 3. Instruments
Initial V1 validation instruments:
- EUR/USD
- GBP/USD
- USD/JPY
- XAU/USD

Each instrument must be treated as a separate strategy stream. Portfolio-level aggregation is strictly prohibited until instrument-level results have been independently calculated and reported.

## 4. Timeframes
The frozen dual-timeframe architecture is used exclusively.
- **Anchor TF**: 1 Hour (1H)
- **Execution TF**: 5 Minutes (5M)
Alternative timeframes are excluded from the initial validation.

## 5. Historical Data Requirements
Exact OHLC requirements for every instrument:
- **Columns**: Timestamp, Open, High, Low, Close.
- **Integrity**: Data must be chronologically ordered, duplicate-free, normalized to UTC, and thoroughly checked for corrupted values and impossible OHLC relationships.
- **Rejection Policy**: Candles where `High < max(Open, Close)`, `Low > min(Open, Close)`, or `High < Low` must be explicitly rejected unless the data provider documents a valid adjustment mechanism. Corrupt data must not be silently repaired.

## 6. Data Provenance
For reproducibility, every backtest must log:
Data provider, instrument identifier, timeframe, acquisition date, historical coverage period, timezone conversion method, missing-data handling, adjustment policy, file/version identifier, and a cryptographic checksum of the dataset.

## 7. Warm-Up Period
The strategy must not generate signals immediately at the dataset start. A deterministic warm-up period is required to initialize:
- `ATR_Period` for displacement logic.
- `Swing_N` for Execution and Anchor TF structure.
No setups or trade statistics may be counted during this mathematically mandated initialization window.

## 8. Historical Period
The historical sample must be sufficiently long to cover diverse market regimes: trending, ranging, high/low volatility, and major macro events. The period selection must be defined prior to viewing results and must not be cherry-picked. If data limitations prevent multi-regime testing, this limitation must be explicitly reported.

## 9. Train / Validation / Test Separation
Data snooping is strictly prohibited. The dataset is partitioned into:
- **Development Set**: For understanding baseline behavior and bounding reasonable parameter ranges.
- **Validation Set**: To compare candidate configurations and test stability.
- **Final Test Set**: Used exactly once for unbiased evaluation after all methodology is frozen. Test results cannot influence parameter ranges, execution assumptions, or reporting decisions.

## 10. Walk-Forward Validation
The engine must support a rigid walk-forward methodology (e.g., `Train → Validate → Test` rolled forward chronologically).
1. Training data selects parameters.
2. Validation data rejects unstable configurations.
3. The configuration is evaluated on previously unseen Test data.
4. Test segments are aggregated into a final out-of-sample equity curve. Financial time-series data must not be randomly shuffled.

## 11. Parameter Testing
The 14 frozen parameters are categorized as follows:
- **Fixed Structural**: `Swing_N`, `ATR_Period`
- **Behavioral**: `Max_Sweep_Duration`, `Max_Displacement_Delay`, `Disp_Size_Multiplier`, `Disp_Body_Ratio`, `Disp_Close_Location`, `FVG_Min_ATR_Ratio`, `FVG_Timeout`, `Minimum_RR`, `Session_Start`, `Session_End`
- **Execution**: `Spread_Assumption`, `Slippage_Assumption`
Unrestricted brute-force optimization is banned. A bounded, economically reasonable parameter space must be defined to combat the curse of dimensionality.

## 12. Baseline Configuration
Before optimization, a single **baseline configuration** using reasonable central values must be defined. This answers whether the foundational theory possesses an edge prior to mathematical tuning. The baseline result must be reported entirely separate from optimized results.

## 13. Parameter Sensitivity
Evaluate local sensitivity by varying each key behavioral parameter around the baseline while holding others constant. The goal is to identify broad, stable profitability neighborhoods. Configurations that succeed only at a fragile, exact parameter value must be rejected.

## 14. Avoiding Overfitting
The engine and methodology must include strict safeguards against:
- Data snooping and period/instrument selection bias.
- Repeated testing against the final Out-Of-Sample (OOS) test set.
- Selective trade removal.
The exact number of experiment configurations tested must be tracked and reported to contextualize multiple-testing risk.

## 15. Execution Model
The execution simulator must use the frozen OHLC limit-order conventions (Draft v4).
- **Entry**: Fill at the FVG limit price using subsequent OHLC range intersection.
- **Stop/Target**: Use exact structural stops and targets.
- **Same-Candle Ambiguity**: Utilize the Pessimistic Policy (assume Stop is hit if both SL and TP are reachable in the same candle).
- **Execution Costs**: Apply simulated spread and slippage independently of structural geometry. Structural limits must not be dynamically adjusted to absorb costs.

## 16. Execution-Cost Scenarios
The strategy must be evaluated under three predefined execution assumptions:
- **Scenario A**: Minimal execution cost.
- **Scenario B**: Baseline realistic execution cost.
- **Scenario C**: Adverse execution cost.
Assumptions must be documented upfront. If costs vary materially by session, this limitation must be acknowledged rather than inventing unsupported precision.

## 17. Trade-Level Record
Every generated setup requires an immutable, auditable log:
Instrument, direction, HTF/LTF timestamps, penetration/sweep/displacement/FVG timestamps and boundaries, structural Entry/Stop/Target prices, initial Structural RR, entry/exit timestamps, exit reason, gross return, execution costs, net return, Maximum Favorable/Adverse Excursion (if derivable from OHLC), and parameter configuration ID.

## 18. Core Performance Metrics
Total profit is an insufficient metric. Reports must include:
- **Trade Statistics**: Total setups, filled trades, win/loss rate, average/median/largest wins and losses.
- **Expectancy**: Statistical expectancy per trade.
- **Risk Metrics**: Max drawdown (%), max drawdown duration, consecutive losses, worst calendar period.
- **Return Metrics**: Cumulative return, profit factor, return volatility.
- **Trade Frequency**: Trades per month/year, average time between trades.

## 19. R-Multiple Reporting
Given the strategy's reliance on structural risk, R-multiples are mandatory.
`R_multiple = Realized_PnL / Initial_Structural_Risk`
Reports must detail the average, median, distribution, and cumulative drawdown of R-multiples. Expectancy must be reported in R.

## 20. Statistical Significance
Positive historical returns do not automatically prove an edge. Evaluation must include confidence intervals for expectancy and win rate. Bootstrap or resampling analysis must account for the serial dependence of financial time series. Statistical evidence must be clearly delineated from economic significance.

## 21. Randomization / Null Tests
At least one null-model test must be executed to estimate the probability of results arising by chance. Acceptable tests include randomized signal timing (maintaining session frequency) or outcome permutation, preserving relevant characteristics without directional edge.

## 22. Baseline Comparisons
Axnna performance must be benchmarked fairly against simple non-Axnna baselines:
- Random directional entries with comparable frequency.
- Simple trend-following or mean-reversion baselines.
Baselines must not be intentionally crippled.

## 23. Instrument Robustness
Results must be segmented by instrument before any portfolio aggregation. Based on predefined criteria, the strategy will be formally classified as:
- Cross-instrument robust
- Partially robust
- Instrument-specific
- Failed

## 24. Regime Robustness
Results must be partitioned by market regime (volatility, trend strength, session, year, quarter). Every subgroup must report its trade count. Partitions with small sample sizes must be explicitly labeled as statistically weak.

## 25. Drawdown and Survival Analysis
Analyze operational survivability under predefined risk assumptions. Report the maximum R drawdown, losing streaks, recovery time, and percentage of capital remaining. Do not assume infinite psychological or financial drawdown tolerance.

## 26. Monte Carlo / Trade-Sequence Robustness
Employ Monte Carlo trade-sequence resampling to model alternative historical realities. Estimate the distributions for maximum drawdown, losing streaks, and terminal equity. This tests sequence sensitivity, NOT market data fabrication, and is not a substitute for Out-Of-Sample testing.

## 27. Parameter Stability Test
Configurations must be formally classified:
- **Stable**: Positive performance across a broad neighborhood of values and instruments.
- **Fragile**: Highly dependent on narrow parameters.
- **Unstable**: Reverses edge with minor changes.
- **Failed**: No positive evidence outside a hyper-optimized configuration.

## 28. Trade Count Requirements
Minimum sample-size thresholds must be established for preliminary observation, meaningful validation, and strong evidence. If the strategy generates insufficient trades, the final report must state **Insufficient Sample Size** rather than forcing a conclusion.

## 29. Multiple-Comparison Control
The methodology must strictly prevent selecting the best-looking result derived from thousands of iterations. The final report must structurally segregate the Baseline Result, Exploratory/Validation Results, and the Untouched Final Test Result.

## 30. Final-Test Freeze
Before execution against the final out-of-sample test set, everything must be frozen: strategy specifications, parameter ranges, selection methods, execution assumptions, statistical tests, and acceptance criteria. Subsequent modifications mandate a completely new, untouched dataset.

## 31. Predefined Acceptance Criteria
Objective thresholds must be established beforehand to classify the test as:
- **PASS**
- **CONDITIONAL PASS**
- **FAIL**
Criteria must encompass OOS positive expectancy, robust trade counts, acceptable drawdowns, cross-instrument stability, and post-execution cost viability.

## 32. Failure Classification
If the strategy fails, it must be formally classified (e.g., no measurable edge, edge subsumed by costs, unstable parameters, execution sensitivity, likely overfitting). The strategy rules (Draft v4) must NOT be hot-patched during the validation phase; failures inform future research phases.

## 33. Reproducibility Requirements
Backtests must guarantee bit-for-bit reproducibility. Logs must contain the exact strategy version, parameter configurations, data hashes, data ranges, execution assumptions, code versions, and random seeds.

## 34. Validation Output Structure
The final report must strictly follow this structure:
1. **Executive Result**: Baseline, OOS result, overall conclusion.
2. **Data Quality**: Instruments, periods, anomalies.
3. **Strategy Activity**: Setups, fills, longs/shorts.
4. **Performance**: Expectancy, R-multiples, drawdowns, profit factors.
5. **Robustness**: Instruments, regimes, parameter sensitivity.
6. **Statistical Analysis**: Confidence intervals, null tests, Monte Carlo.
7. **Execution Sensitivity**: Cost and slippage scenarios.
8. **Overfitting Assessment**: Tests conducted, selection procedure.
9. **Final Classification**: PASS / CONDITIONAL PASS / FAIL (with justification).

## 35. Important Separation of Phases
This validation phase rigorously upholds the separation of operations:
- Phase 1: Strategy Research
- Phase 2: Formal Strategy Specification
- **Phase 3: Validation & Backtesting Specification (Current)**
- Phase 4: Backtest Engine Implementation
- Phase 5: Historical Backtesting
- Phase 6: Robustness Analysis
- Phase 7: Paper / Forward Validation
- Phase 8: Live Deployment
Phases must never be collapsed.

## 36. Final Decision
The validation methodology is sufficiently rigorous, deterministic, and formally defined to proceed to the next technical phase.

**AXNNA — PROMPT 4: Backtest Engine Implementation Specification**
