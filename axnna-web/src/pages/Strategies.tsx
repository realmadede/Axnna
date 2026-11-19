import { BarChart2, ShieldAlert, Target } from 'lucide-react';
import { SetupDiagram } from '../components/SetupDiagram';

export default function Strategies() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: '4rem' }}>
      <h1 style={{ fontSize: 'clamp(2.1rem, 5vw, 3rem)', fontWeight: 700, letterSpacing: '-0.025em', marginBottom: '1rem' }}>
        Strategy Methodology
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '1.15rem', marginBottom: '2.5rem', lineHeight: 1.65 }}>
        Axnna evaluates price action using a deterministic state machine, removing human emotion and ambiguity from market structure.
      </p>

      <div style={{ marginBottom: '2.5rem' }}>
        <SetupDiagram />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', marginBottom: '2.5rem' }}>
        <div className="glass-card">
          <h2 style={{ fontSize: '1.35rem', fontWeight: 600, marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <BarChart2 color="var(--accent-color)" /> Market Structure
          </h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.75 }}>
            Our engine constantly maps relative Swing Highs and Swing Lows across 1H and 5M timeframes. A setup is only considered when price interacts with these mathematically defined liquidity pools, triggering a potential liquidity sweep.
          </p>
        </div>

        <div className="glass-card">
          <h2 style={{ fontSize: '1.35rem', fontWeight: 600, marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Target color="var(--accent-color)" /> Displacement &amp; FVG
          </h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.75 }}>
            A sweep alone is insufficient. Axnna requires strict criteria for displacement immediately following a sweep. The engine calculates candle range relative to a smoothed ATR, requiring minimum body-to-range ratios, close-location dominance, and a clean Fair Value Gap imbalance.
          </p>
        </div>

        <div className="glass-card">
          <h2 style={{ fontSize: '1.35rem', fontWeight: 600, marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <ShieldAlert color="var(--accent-color)" /> Fundamental Confluence
          </h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.75 }}>
            Technical structure is vetoed if it conflicts with extreme macroeconomic event risk. Our Fundamental Engine evaluates upcoming high-impact calendar events—if a setup forms ahead of a high-impact release like NFP or CPI, the Risk Gate vetoes alert delivery and Axnna stays silent.
          </p>
        </div>
      </div>

      <div className="axnna-surface" style={{ padding: '1.75rem', backgroundColor: 'var(--surface-elevated)' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Transparency Notice</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.65 }}>
          We document our macro rules openly, while exact geometric weights used to compute the 0–100 Axnna Score remain internal to preserve deterministic integrity. Setups scoring below <span className="mono">65</span> are silently discarded.
        </p>
      </div>
    </div>
  );
}
