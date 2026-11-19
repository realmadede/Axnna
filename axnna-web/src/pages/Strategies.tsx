import { useEffect, useState } from 'react';
import { BarChart2, ShieldAlert, Target, TrendingUp } from 'lucide-react';
import { SetupDiagram } from '../components/SetupDiagram';

interface PerformanceSummary {
  totalTrackedSetups: number;
  openTrades: number;
  pendingTrades: number;
  closedTrades: number;
  expiredOrCancelled: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalR: number;
  averageR: number | null;
}

interface InstrumentPerformanceRow {
  instrument: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalR: number;
  averageR: number | null;
}

interface ScoreBandPerformanceRow {
  band: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averageR: number | null;
}

interface PerformancePayload {
  mode: string;
  generatedAt: string;
  summary: PerformanceSummary;
  byInstrument: InstrumentPerformanceRow[];
  byScoreBand: ScoreBandPerformanceRow[];
}

function formatMetric(val: number | null, suffix = ''): string {
  if (val === null) return '--';
  const sign = suffix === 'R' && val > 0 ? '+' : '';
  return `${sign}${val}${suffix}`;
}

export default function Strategies() {
  const [perf, setPerf] = useState<PerformancePayload | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [perfError, setPerfError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/performance')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<PerformancePayload>;
      })
      .then((data) => {
        if (active) setPerf(data);
      })
      .catch(() => {
        if (active) setPerfError(true);
      })
      .finally(() => {
        if (active) setPerfLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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

      {/* Read-Only Forward Simulation Track Record */}
      <section className="glass-card" style={{ marginBottom: '2.5rem' }} aria-label="Forward Simulation Track Record">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div>
            <span className="admin-kpi-label">Forward Paper Simulation</span>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 600, marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              <TrendingUp size={20} color="var(--accent-color)" /> Signal Track Record
            </h2>
          </div>
          <span className="admin-badge">SIMULATED • NOT LIVE EXECUTION</span>
        </div>

        {perfLoading && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>Loading forward simulation metrics...</p>
        )}

        {!perfLoading && perfError && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>
            Forward performance metrics are temporarily unavailable. Check System Status for live pipeline health.
          </p>
        )}

        {!perfLoading && perf && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.85rem' }}>
              <div style={{ padding: '0.9rem', borderRadius: '10px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="admin-kpi-label">Closed Trades</div>
                <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>{perf.summary.closedTrades}</div>
                <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {perf.summary.openTrades} open • {perf.summary.pendingTrades} pending
                </div>
              </div>
              <div style={{ padding: '0.9rem', borderRadius: '10px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="admin-kpi-label">Win Rate</div>
                <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {formatMetric(perf.summary.winRate, '%')}
                </div>
                <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {perf.summary.wins}W / {perf.summary.losses}L
                </div>
              </div>
              <div style={{ padding: '0.9rem', borderRadius: '10px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="admin-kpi-label">Average R</div>
                <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {formatMetric(perf.summary.averageR, 'R')}
                </div>
                <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Net of modeled costs
                </div>
              </div>
              <div style={{ padding: '0.9rem', borderRadius: '10px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="admin-kpi-label">Cumulative R</div>
                <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem', color: perf.summary.totalR > 0 ? 'var(--success-color)' : undefined }}>
                  {perf.summary.closedTrades > 0 ? formatMetric(perf.summary.totalR, 'R') : '--'}
                </div>
                <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {perf.summary.totalTrackedSetups} total tracked
                </div>
              </div>
            </div>

            {perf.summary.closedTrades === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                Forward simulation tracking is active across EURUSD, GBPUSD, USDJPY, and XAUUSD. Aggregate win-rate and R-multiple breakdowns populate here automatically as approved setups close.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                <div style={{ padding: '1rem', borderRadius: '10px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                  <div className="admin-kpi-label" style={{ marginBottom: '0.65rem' }}>By Instrument</div>
                  {perf.byInstrument.map((row) => (
                    <div key={row.instrument} className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '0.35rem 0', borderBottom: '1px solid var(--border-color)' }}>
                      <span>{row.instrument}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {row.closedTrades} ({formatMetric(row.winRate, '%')}) | {formatMetric(row.totalR, 'R')}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '1rem', borderRadius: '10px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                  <div className="admin-kpi-label" style={{ marginBottom: '0.65rem' }}>By Score Band</div>
                  {perf.byScoreBand.map((row) => (
                    <div key={row.band} className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '0.35rem 0', borderBottom: '1px solid var(--border-color)' }}>
                      <span>Score {row.band}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {row.closedTrades} ({formatMetric(row.winRate, '%')}) | Avg {formatMetric(row.averageR, 'R')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

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
          We document our macro rules openly, while exact geometric weights used to compute the 0–100 Axnna Score remain internal to preserve deterministic integrity. Setups scoring below <span className="mono">65</span> are silently discarded. Simulated performance includes modeled spread, slippage, and commission, and does not guarantee future results.
        </p>
      </div>
    </div>
  );
}
