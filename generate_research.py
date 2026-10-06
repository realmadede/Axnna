import os

content = """# Axnna Strategy Research & Discovery

## 1. Executive Summary

Axnna is intended to be a proprietary market-analysis platform that codifies trading concepts drawn from ICT (Inner Circle Trader), Smart Money Concepts (SMC), and pure price action. The core challenge in developing Axnna lies in the inherent subjectivity of these methodologies. While human traders can intuitively assess "displacement" or "market structure," software requires rigid, deterministic, and quantifiable rules. 

This document serves as the foundational research for Axnna's V1 strategy. It explores the conceptual coherence, operational definability, and real-time observability of the primary candidate model: **Liquidity Sweep → MSS → Displacement → FVG Retracement**. The objective is exclusively to determine *what* rules should be formulated to represent market behavior, not to prove their profitability or implement them in code.

## 2. Research Methodology

This research deconstructs popular trading concepts by separating subjective interpretation from objective, observable market data. Findings and claims are categorized using the following discipline:

* **[ICT]** Original concepts as presented by Michael J. Huddleston.
* **[PRACTITIONER]** Independent interpretations commonly used by retail SMC traders.
* **[ACADEMIC]** Insights from quantitative finance and statistical testing.
* **[TECHNICAL]** Engineering-focused reasoning based purely on OHLCV time-series data.
* **[AXNNA CONCLUSION]** The definitive recommendation on how Axnna should treat the concept.

This research explicitly ignores popularity as a proxy for predictive power and assumes that concepts lacking objective, real-time definability cannot be included in a systematic platform.

## 3. ICT / SMC Concept Map

The overarching narrative of SMC/ICT operates on a sequence of causal market behaviors:
1. Resting orders build up above/below historical price extremes (**Liquidity**).
2. Price moves to trigger these orders (**Sweep/Stop Hunt**).
3. Institutional participation shifts direction rapidly, breaking previous structural limits (**MSS/CHoCH**).
4. This shift leaves behind a signature of high momentum (**Displacement**) and temporary price inefficiencies (**FVGs**).
5. Price eventually returns to rebalance the inefficiency (**Retracement**) before continuing in the new direction.

## 4. Market Structure

Market structure is the framework of Swing Highs (SH), Swing Lows (SL), and their sequential relationship (Higher Highs, Lower Lows).

* **[ICT]** Typically visually identified. Often relies on fractal patterns (a high flanked by two lower highs).
* **[PRACTITIONER]** Debates exist over whether to use 3-candle fractals, 5-candle fractals, or volatility-adjusted pivots.
* **[ACADEMIC]** Zigzag algorithms or rolling window extrema are standard but inherently suffer from right-side lag.
* **[TECHNICAL]** A swing extremum cannot be known at the exact moment it forms. A 5-candle fractal (two candles left, two candles right) is only confirmed *two periods after* the peak. Using completed structure on a chart without accounting for this delay introduces severe look-ahead bias.
* **[AXNNA CONCLUSION]** Axnna must adopt a fixed-lookback algorithmic pivot system (e.g., a High that is higher than the N previous and N subsequent candles). Crucially, the system must recognize that a Swing High is only confirmed at `T + N`. Real-time logic cannot act on a swing until the confirmation condition is met.

## 5. Liquidity

Liquidity refers to pools of resting stop-loss or entry orders.

* **[ICT / PRACTITIONER]** Identified at previous daily/weekly extremes, old highs/lows, equal highs/lows, or range boundaries.
* **[TECHNICAL]** "Liquidity" in time-series data is simply a historical price extremum. It is objective to identify (e.g., `Max(High, 50)`). The subjective part is determining how long it remains relevant and whether multiple pools coalesce.
* **[AXNNA CONCLUSION]** Axnna should define liquidity pools objectively using Swing Extremes. However, it must implement an expiration mechanism (e.g., a Swing High is relevant as Buy-Side Liquidity only if it has not been breached, and is no older than X periods). Unbounded historical extrema will create too much noise.

## 6. Liquidity Events and Sweeps

A sweep implies liquidity was taken to fuel a reversal, contrasting with a structural breakout.

* **[PRACTITIONER]** Often defined visually as a "wick above a high, but a body close below it."
* **[TECHNICAL]** A wick/body relationship is observable, but highly dependent on the timeframe chosen. What is a wick on a 1H chart might be three full-bodied closes on a 15M chart.
* **[AXNNA CONCLUSION]** A "Sweep" must be defined by observable threshold behaviors relative to the liquidity level. Axnna should likely require: (1) Price penetration beyond the level, AND (2) A return inside the prior range within a strict maximum number of candles (e.g., 1-3 periods), AND/OR (3) A specific close condition relative to the liquidity level. 

## 7. BOS / CHoCH / MSS

Break of Structure (BOS), Character Change (CHoCH), and Market Structure Shift (MSS) describe price moving past previous structural points.

* **[PRACTITIONER]** BOS implies trend continuation. CHoCH implies an early warning of reversal. MSS implies a confirmed trend shift, usually requiring energetic displacement.
* **[TECHNICAL]** From a data perspective, all three represent the exact same event: `Current Price > Previous Swing High` (or `< Swing Low`). Maintaining three separate classifications requires subjective, contextual state-tracking that adds immense complexity with dubious mathematical benefit.
* **[AXNNA CONCLUSION]** Axnna should unify these concepts. The engine should simply detect a **Structural Break**. Whether it is a reversal (MSS) or continuation (BOS) is simply a state-flag derived from the prior trend. V1 should avoid subjective distinctions and stick to objective price-crossing-swing-level rules.

## 8. Displacement

Displacement is the signature of institutional involvement, characterized by energetic, unidirectional movement.

* **[ICT]** Described qualitatively as a strong move leaving FVGs.
* **[TECHNICAL]** Cannot be qualitative in software. Must be defined via momentum metrics. Candidates include: Candle Body Size > ATR(14) multiplier; large Body/Range ratio (>70%); or consecutive candles closing in the same direction with expanding ranges.
* **[AXNNA CONCLUSION]** Displacement must be converted into a deterministic mathematical threshold. Axnna should define it using ATR-normalized movement (to account for changing market volatility) and require directional consistency (e.g., closing in the top 25% of the candle range). Thresholds will remain flexible parameters for future testing.

## 9. Fair Value Gaps

An FVG represents a price imbalance where trading was offered in only one direction.

* **[ICT]** A three-candle pattern. Bullish FVG: `Low of Candle 3 > High of Candle 1`.
* **[TECHNICAL]** This is mathematically trivial and 100% objective to define. The major problem is frequency: small, random gaps appear constantly in lower timeframes.
* **[AXNNA CONCLUSION]** FVGs are highly definable and should be included in V1. However, to prevent noise, Axnna must differentiate between random gaps and *structural* gaps. An FVG should only be flagged as actionable if it is preceded immediately by the mathematical definition of **Displacement**.

## 10. Order Blocks and Related Concepts

Order Blocks (OB), Breakers, and Mitigation Blocks are specific candlestick patterns indicating institutional footprint.

* **[PRACTITIONER]** OBs are widely debated (e.g., is it the last consecutive down-candles, or just the very last down-candle before an up-move?).
* **[TECHNICAL]** OBs overlap almost entirely with Swing Extremes and FVGs. An OB is often just the origin point of Displacement that creates an FVG. Coding OBs requires highly subjective grouping of candles.
* **[AXNNA CONCLUSION]** OBs and related blocks should be **EXCLUDED** from V1. They introduce redundancy. The core information (momentum and imbalance) is already captured objectively by Displacement and FVGs. If a concept cannot clearly add independent information, it should not enter V1.

## 11. Premium / Discount

The division of a dealing range into upper (Premium) and lower (Discount) halves.

* **[ICT]** Buy in Discount, sell in Premium.
* **[TECHNICAL]** Mathematically trivial to calculate *if* the range is known. Determining the anchor points for the range (which swing high to which swing low) is highly subjective and dynamically repaints as the market moves.
* **[AXNNA CONCLUSION]** Highly dependent on structure definitions. Should be classified as **SUPPORTING/OPTIONAL**. If included in V1, the dealing range must be rigidly defined (e.g., the most recent major structural swing, or the current daily session high/low).

## 12. Market Sessions

Time-based divisions (Asian, London, NY) and specific liquidity injection windows (Killzones).

* **[ACADEMIC / TECHNICAL]** Very objective. Volume, volatility, and mean-reversion characteristics demonstrably change based on global market hours.
* **[AXNNA CONCLUSION]** Sessions should be **CORE** context. They provide highly objective filters without adding indicator lag. Axnna should allow strategies to be restricted to specific windows (e.g., NY open) as a hard prerequisite.

## 13. Multi-Timeframe Architecture

Using higher timeframes (HTF) for bias and lower timeframes (LTF) for entry.

* **[PRACTITIONER]** Often use 3 or 4 timeframes (e.g., 4H, 1H, 15M, 5M).
* **[TECHNICAL]** Aggregating >2 timeframes algorithmically creates a combinatorial explosion of conflicting states (e.g., 4H bullish, 1H bearish, 15M bullish). It also severely complicates backtesting.
* **[AXNNA CONCLUSION]** V1 must adopt a strict **Dual-Timeframe Architecture**: 
  1. Anchor TF (Context/Bias/Liquidity targets)
  2. Execution TF (Sweep, Displacement, FVG entry)
  A lower timeframe cannot override the Anchor timeframe context.

## 14. Instrument Differences

Behavior across EUR/USD, GBP/USD, USD/JPY, XAU/USD.

* **[TECHNICAL]** Volatility profiles and pip-values differ vastly.
* **[AXNNA CONCLUSION]** The *logical sequence* of the strategy is Universal. However, definitions of Displacement (ATR multipliers) and FVG size minimums must be **Configurable** per instrument. Hardcoded pip values must be avoided entirely.

## 15. Risk / Reward

Stop Loss and Take Profit modeling.

* **[PRACTITIONER]** Fixed RR (e.g., 1:2 or 1:3) vs dynamic structural targets.
* **[TECHNICAL]** Fixed RR is easy to program but ignores market context. Structural targets are logical but harder to standardize.
* **[AXNNA CONCLUSION]** V1 should dynamically calculate risk based on structural invalidation (e.g., SL behind the swept liquidity or FVG base). It should then project a structural Take Profit (opposing liquidity pool). If this dynamic setup does not yield a mathematical minimum of 1:2 RR, the setup is rejected. 

## 16. Candidate V1 Strategy

Analyzing the proposed sequence: **Liquidity Sweep → MSS → Displacement → FVG Retracement**

* **Prerequisite:** Clear HTF bias and resting LTF liquidity.
* **Stage 1 (Sweep):** Price crosses liquidity level and reverses within N candles.
* **Stage 2 (MSS):** Price breaks recent counter-swing (Structure Break).
* **Stage 3 (Displacement):** The MSS is achieved with ATR-defined momentum.
* **Stage 4 (FVG):** A structural FVG is left behind.
* **Stage 5 (Entry):** Price retraces into FVG.
* **Stage 6 (Target):** Next liquidity pool.

*Critique:* The sequence is logical, but MSS and Displacement are often the exact same event. A strong displacement usually causes the MSS. Requiring them sequentially might miss valid setups.

## 17. Alternative Strategy Models

* **Model B (Liquidity Sweep → Displacement → FVG Retracement):** By removing the hard dependency on an MSS (which relies on subjective structural pivot definitions), we rely entirely on momentum (Displacement) reversing away from a swept level.
* **[AXNNA CONCLUSION]** Model B is highly recommended as the true V1 starting point. It requires fewer moving parts, is less prone to right-side structural lag, and relies on easily quantifiable metrics (Price Level + Momentum + Imbalance). 

## 18. Core vs Supporting vs Optional vs Future Concepts

* **CORE (Must be in V1):** Swing Extrema (for Liquidity), Displacement (ATR-based), FVG generation/mitigation, Session times.
* **SUPPORTING (Contextual filters):** Premium/Discount.
* **OPTIONAL (Not required for first viable loop):** Complex multi-timeframe bias (keep to single or simple dual TF initially).
* **FUTURE (Explicitly Excluded from V1):** Order Blocks, Breaker Blocks, OTE, BPR, SMT divergence.

## 19. Objective vs Subjective Components

* **Objective (Ready to translate to code):** FVGs, Session Times, Fixed RR calculations.
* **Subjective (Requires translation into rigid definitions):**
  * Swing Points (Must define exact N-bar lookback/forward).
  * Sweeps (Must define maximum bars allowed for reversal).
  * Displacement (Must define ATR multiplier and body/range ratio).

## 20. Real-Time Detectability and Look-Ahead Risks

**CRITICAL:** Look-ahead bias is the highest risk for Axnna. 
* A Swing Low is not known on the candle it prints. It is known N candles later.
* A "Sweep" that looks obvious in hindsight might look like a massive breakout in real-time.
* **[AXNNA CONCLUSION]** The formal specification must utilize strict state-machine logic. An event cannot be "true" until the exact tick/candle close that confirms it. For example, if a Sweep requires a candle to close back inside the range, the state is strictly "Pending" until the close occurs.

## 21. Scoring Framework

* **[TECHNICAL]** Assigning points (e.g., FVG = 10pts, MSS = 20pts) risks severe double-counting because these concepts are intrinsically correlated. A massive MSS almost always leaves an FVG.
* **[AXNNA CONCLUSION]** V1 should **NOT** use an additive scoring framework. Instead, it must use a **Boolean Gate (Hard Requirements)** system. The sequence either happened objectively according to the rules, or it did not. Scoring should only be introduced in later versions once baseline statistical edge is established, likely using conditional probabilities rather than arbitrary points.

## 22. Overfitting and Research Risks

* **[ACADEMIC]** Testing a model with 15 adjustable parameters (ATR multipliers, FVG minimums, Swing lookbacks, RR requirements) on EUR/USD will inevitably lead to finding a profitable curve that fails in live trading (Data Snooping Bias).
* **[AXNNA CONCLUSION]** The strategy architecture must limit degrees of freedom. Parameters should be global where possible. Optimization must rely on out-of-sample testing and walk-forward analysis. The platform should not automatically mine for the "best" parameters.

## 23. V1 Recommendation

**Liquidity Sweep → Displacement → FVG Retracement** is recommended as the baseline for Axnna V1.

The strict "MSS" requirement should be conditionally bypassed if Displacement is strong enough, simplifying the structural logic. Order blocks, complex market profiles, and heavily subjective structural analysis must be stripped out to ensure deterministic execution and prevent scope creep.

## 24. Formal Specification Requirements for Next Phase

The next phase must NOT involve software architecture, UI design, or database deployment. 
It must be a **Formal Mathematical & Technical Strategy Specification**.
This specification must define:
1. The exact mathematical formulas for defining a Swing High/Low.
2. The ATR-based formula for Displacement.
3. The boolean state-machine for detecting a Sweep.
4. The execution state-machine (Pending, Triggered, Mitigated, Invalidated).

## 25. Final Answers A–F

### A. Is the candidate sequence reasonable for V1?
**YES WITH MODIFICATIONS.** The core logic is sound, but "MSS" should be unified with "Displacement" to reduce reliance on lagging structural pivots. The simplified model (Sweep → Displacement → FVG) is mathematically cleaner.

### B. What exact concepts should V1 contain?
The smallest coherent set:
1. Swing Extrema (for Liquidity targets)
2. ATR-based Displacement
3. Fair Value Gaps (FVG)
4. Session Times (Filters)
5. dual-timeframe logic (Anchor + Execution)

### C. What concepts should explicitly be excluded from V1?
Order Blocks, Breaker Blocks, BPR, OTE, SMT divergence, Judas Swings, complex 4-tier timeframe nesting, and additive scoring systems.

### D. Which parts can already be defined objectively?
FVGs, Session timing, static Risk/Reward calculations, and basic OHLC price crossings.

### E. Which parts require additional research before coding?
The exact mathematical threshold for "Displacement" (e.g., 1.5x ATR vs 2.0x ATR), the specific right-side/left-side bar count for Swing definition, and the exact timeout condition for a Liquidity Sweep.

### F. What should the next development prompt address?
**Formal Mathematical & Technical Strategy Specification.**
"""

with open("docs/Axnna_Strategy_Research_Discovery.md", "w") as f:
    f.write(content)
