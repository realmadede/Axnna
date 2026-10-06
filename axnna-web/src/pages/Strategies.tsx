
import { Target, ShieldAlert, BarChart2 } from 'lucide-react';

export default function Strategies() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: '4rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>Strategy Methodology</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', marginBottom: '4rem', lineHeight: 1.6 }}>
        Axnna evaluates price action using a deterministic state machine, removing human emotion and ambiguity from market structure.
      </p>

      <div className="glass-card" style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <BarChart2 color="var(--accent-color)" /> Market Structure
        </h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem' }}>
          Our engine constantly maps relative Swing Highs and Swing Lows across multiple timeframes. A setup is only considered when price interacts with these mathematically defined liquidity pools, triggering a potential liquidity sweep.
        </p>
      </div>

      <div className="glass-card" style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Target color="var(--accent-color)" /> Displacement & FVG
        </h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem' }}>
          A sweep alone is insufficient. Axnna requires strict criteria for volumetric displacement immediately following a sweep. The engine calculates the True Range of the displacement candle relative to a smoothed ATR, demanding specific body-to-range ratios and close locations to confirm genuine directional intent.
        </p>
      </div>

      <div className="glass-card" style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ShieldAlert color="var(--accent-color)" /> Fundamental Confluence
        </h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem' }}>
          Technical structure is instantly vetoed if it conflicts with extreme macroeconomic event risk. Our Fundamental Engine parses upcoming high-impact calendar events. If a pristine technical setup forms 15 minutes before Non-Farm Payrolls, the setup is blocked, and Axnna remains silent.
        </p>
      </div>

      <div style={{ padding: '2rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Transparency Notice</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
          We document our macro rules openly, but the exact geometric thresholds (ATR multipliers, FVG gap requirements, RR minimums) are proprietary internal weights used to generate the Axnna Score. By design, we do not expose the exact mathematical formulas to prevent reverse-engineering of the internal state machine.
        </p>
      </div>
    </div>
  );
}
