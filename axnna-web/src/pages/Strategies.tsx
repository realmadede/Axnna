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
    <div style={{ maxWidth: '940px', margin: '0 auto', paddingBottom: '3rem' }}>
      <h1 style={{ fontSize: 'clamp(1.75rem, 3.8vw, 2.35rem)', fontWeight: 700, letterSpacing: '-0.025em', marginBottom: '0.65rem' }}>
        Strategy Methodology
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: '1.75rem', lineHeight: 1.6 }}>
        Axnna evaluates price action using a deterministic state machine, removing human emotion and ambiguity from market structure.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <SetupDiagram />
      </div>

      {/* Read-Only Forward Simulation Track Record */}
      <section className="glass-card" style={{ marginBottom: '1.5rem' }} aria-label="Forward Simulation Track Record">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
          <div>
            <span className="admin-kpi-label">Forward Paper Simulation</span>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={18} color="var(--accent-color)" /> Signal Track Record
            </h2>
          </div>
          <span className="admin-badge">SIMULATED • NOT LIVE EXECUTION</span>
        </div>

        {perfLoading && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading forward simulation metrics...</p>
        )}

        {!perfLoading && perfError && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Forward performance metrics are temporarily unavailable. Check System Status for live pipeline health.
          </p>
        )}

        {!perfLoading && perf && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="perf-kpi-grid">
              <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="admin-kpi-label">Closed Trades</div>
                <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.2rem' }}>{perf.summary.closedTrades}</div>
                <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  {perf.summary.openTrades} open • {perf.summary.pendingTrades} pending
                </div>
              </div>
              <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="admin-kpi-label">Win Rate</div>
                <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.2rem' }}>
                  {formatMetric(perf.summary.winRate, '%')}
                </div>
                <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  {perf.summary.wins}W / {perf.summary.losses}L
                </div>
              </div>
              <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="admin-kpi-label">Average R</div>
                <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.2rem' }}>
                  {formatMetric(perf.summary.averageR, 'R')}
                </div>
                <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  Net of modeled costs
                </div>
              </div>
              <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="admin-kpi-label">Cumulative R</div>
                <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.2rem', color: perf.summary.totalR > 0 ? 'var(--success-color)' : undefined }}>
                  {perf.summary.closedTrades > 0 ? formatMetric(perf.summary.totalR, 'R') : '--'}
                </div>
                <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  {perf.summary.totalTrackedSetups} total tracked
                </div>
              </div>
            </div>

            {perf.summary.closedTrades === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', lineHeight: 1.55 }}>
                Forward simulation tracking is active across EURUSD, GBPUSD, USDJPY, and XAUUSD. Aggregate win-rate and R-multiple breakdowns populate here automatically as approved setups close.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.85rem' }}>
                <div style={{ padding: '0.85rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                  <div className="admin-kpi-label" style={{ marginBottom: '0.5rem' }}>By Instrument</div>
                  {perf.byInstrument.map((row) => (
                    <div key={row.instrument} className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border-color)' }}>
                      <span>{row.instrument}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {row.closedTrades} ({formatMetric(row.winRate, '%')}) | {formatMetric(row.totalR, 'R')}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '0.85rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                  <div className="admin-kpi-label" style={{ marginBottom: '0.5rem' }}>By Score Band</div>
                  {perf.byScoreBand.map((row) => (
                    <div key={row.band} className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border-color)' }}>
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

      <div className="strategy-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="glass-card">
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.55rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BarChart2 size={18} color="var(--accent-color)" /> Market Structure
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6 }}>
            Maps Swing Highs and Swing Lows across 1H and 5M timeframes. Setups only qualify when price sweeps mathematically defined liquidity pools.
          </p>
        </div>

        <div className="glass-card">
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.55rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Target size={18} color="var(--accent-color)" /> Displacement &amp; FVG
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6 }}>
            Measures candle range against ATR, demanding strict body-to-range dominance, close location, and a clean Fair Value Gap imbalance.
          </p>
        </div>

        <div className="glass-card">
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.55rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldAlert size={18} color="var(--accent-color)" /> Macro Risk Gate
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6 }}>
            Technical setups are vetoed automatically if high-impact releases like NFP or CPI fall inside the risk window.
          </p>
        </div>
      </div>

      <div className="axnna-surface" style={{ padding: '1.15rem 1.25rem', backgroundColor: 'var(--surface-elevated)' }}>
        <h3 style={{ fontSize: '0.96rem', fontWeight: 600, marginBottom: '0.4rem' }}>Transparency Notice</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.55 }}>
          Macro rules are documented openly while exact scoring weights remain internal. Setups below <span className="mono">65</span> are silently discarded. Simulated performance includes modeled spread, slippage, and commission, and does not guarantee future results.
        </p>
      </div>
    </div>
  );
}
