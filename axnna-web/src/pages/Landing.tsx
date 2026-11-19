import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, BarChart2, Bell, Check, ChevronLeft, MessageSquare, Minus, Settings, Shield, Target } from 'lucide-react';
import { SetupDiagram } from '../components/SetupDiagram';
import { DynamicHero } from './HeroComponents';

function InstrumentStrip() {
  const markets = [
    { pair: 'EURUSD', type: 'Forex Major', schedule: '1H -> 5M' },
    { pair: 'GBPUSD', type: 'Forex Major', schedule: '1H -> 5M' },
    { pair: 'USDJPY', type: 'Forex Major', schedule: '1H -> 5M' },
    { pair: 'XAUUSD', type: 'Spot Gold', schedule: '1H -> 5M' },
  ];

  return (
    <div className="instrument-strip">
      <div className="container">
        <div className="instrument-grid">
          {markets.map((m) => (
            <div key={m.pair} className="instrument-cell">
              <div>
                <div className="mono" style={{ fontWeight: 600, fontSize: '0.92rem' }}>{m.pair}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{m.type}</div>
              </div>
              <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--accent-color)', fontWeight: 500 }}>
                {m.schedule}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const COMPARISON_ROWS = [
  { label: 'Market Monitoring', manual: 'Constant screen time', groups: 'Human schedule', axnna: 'Multi-provider 24/5 feed' },
  { label: 'Macro Risk Gate', manual: 'Ad-hoc / missed news', groups: 'Rarely structured', axnna: 'Fail-closed macro veto' },
  { label: 'Signal Filtering', manual: 'Emotional entries', groups: 'Opaque calls', axnna: 'Deterministic >= 65% rule' },
  { label: 'Delivery Channel', manual: 'Chart alerts everywhere', groups: 'Noisy chat spam', axnna: 'Telegram-native alerts' },
  { label: 'Audit & Tracking', manual: 'Unlogged discretion', groups: 'Cherry-picked stats', axnna: 'Forward paper tracked' },
];

function BeforeAfterSummary() {
  return (
    <div className="before-after-grid">
      <div className="glass-card" style={{ borderStyle: 'dashed', borderColor: 'rgba(248, 81, 73, 0.45)', padding: '1rem 1.15rem' }}>
        <div className="admin-kpi-label" style={{ color: 'var(--error-color)', marginBottom: '0.35rem' }}>Before Axnna</div>
        <h3 style={{ fontSize: '1.02rem', fontWeight: 600, marginBottom: '0.3rem' }}>Manual Screen Fatigue</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', lineHeight: 1.5 }}>
          Watching charts all day, missing calendar releases, and forcing low-quality setups.
        </p>
      </div>
      <div className="glass-card" style={{ borderColor: 'rgba(45, 212, 126, 0.45)', padding: '1rem 1.15rem' }}>
        <div className="admin-kpi-label" style={{ color: 'var(--success-color)', marginBottom: '0.35rem' }}>After Axnna</div>
        <h3 style={{ fontSize: '1.02rem', fontWeight: 600, marginBottom: '0.3rem' }}>Deterministic Silence</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', lineHeight: 1.5 }}>
          Step away from screens. Alerts trigger only when structure and macro safety agree.
        </p>
      </div>
    </div>
  );
}

function WhyAxnnaComparison() {
  return (
    <>
      {/* Desktop Spotlight Table */}
      <div className="glass-card comparison-desktop" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-elevated)' }}>
              <th style={{ padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--border-color)' }}>Feature</th>
              <th style={{ padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Manual Trading</th>
              <th style={{ padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Signal Groups</th>
              <th className="comparison-axnna-col" style={{ padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--border-color)', color: 'var(--accent-color)' }}>
                Axnna
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row, i) => {
              const rowBorder = i < COMPARISON_ROWS.length - 1 ? '1px solid var(--border-color)' : 'none';
              return (
                <tr key={row.label} style={{ borderBottom: rowBorder }}>
                  <td style={{ padding: '0.82rem 1.1rem', fontWeight: 600 }}>{row.label}</td>
                  <td style={{ padding: '0.82rem 1.1rem', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Minus size={13} color="var(--text-muted)" />
                      <span>{row.manual}</span>
                    </span>
                  </td>
                  <td style={{ padding: '0.82rem 1.1rem', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Minus size={13} color="var(--text-muted)" />
                      <span>{row.groups}</span>
                    </span>
                  </td>
                  <td className="comparison-axnna-col" style={{ padding: '0.82rem 1.1rem', fontWeight: 600 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                      <Check size={14} color="var(--success-color)" />
                      <span>{row.axnna}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Zero-Scroll Comparison Cards */}
      <div className="comparison-mobile">
        {COMPARISON_ROWS.map((row) => (
          <div key={row.label} className="glass-card" style={{ padding: '0.85rem 0.95rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{row.label}</div>
            <div
              className="comparison-axnna-col"
              style={{
                borderRadius: '7px',
                padding: '0.45rem 0.65rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontSize: '0.84rem',
                fontWeight: 600,
              }}
            >
              <Check size={14} color="var(--success-color)" style={{ flexShrink: 0 }} />
              <span>Axnna: {row.axnna}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              <div>
                <span className="mono" style={{ display: 'block', fontSize: '0.68rem', opacity: 0.8 }}>MANUAL</span>
                <span>{row.manual}</span>
              </div>
              <div>
                <span className="mono" style={{ display: 'block', fontSize: '0.68rem', opacity: 0.8 }}>GROUPS</span>
                <span>{row.groups}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

interface TabEntry {
  title: string;
  desc: string;
  prompt: string;
  mock: ReactNode;
}

function TelegramTabs() {
  const [activeTab, setActiveTab] = useState<'alert' | 'status' | 'recap'>('alert');

  const content: Record<'alert' | 'status' | 'recap', TabEntry> = {
    alert: {
      title: 'Automated Setup Alerts',
      desc: 'Instant Telegram delivery whenever geometric alignment exceeds 65 points.',
      prompt: 'Auto alert • 14:05 UTC',
      mock: (
        <div className="mono" style={{ fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <strong>EURUSD</strong>
            <span style={{ color: '#2dd47e', fontWeight: 600 }}>LONG • 78/100</span>
          </div>
          <div>Entry: 1.17420 | Stop: 1.17280</div>
          <div>Target: 1.17740 (R:R 2.29)</div>
        </div>
      ),
    },
    status: {
      title: 'On-Demand Status',
      desc: 'Query live HTF bias and macroeconomic risk directly inside the bot.',
      prompt: '/status EURUSD',
      mock: (
        <div className="mono" style={{ fontSize: '0.8rem' }}>
          <div style={{ fontWeight: 600 }}>AXNNA STATUS: EURUSD</div>
          <div style={{ marginTop: '0.25rem' }}>HTF Bias: BULLISH</div>
          <div style={{ color: 'rgba(255,255,255,0.75)' }}>Macro Risk: LOW</div>
        </div>
      ),
    },
    recap: {
      title: 'Daily Recaps',
      desc: 'End-of-day UTC summary of qualified setups and risk vetoes.',
      prompt: 'Daily Summary • 21:00 UTC',
      mock: (
        <div className="mono" style={{ fontSize: '0.8rem' }}>
          <div><strong>Daily Recap</strong></div>
          <div style={{ marginTop: '0.25rem', color: 'rgba(255,255,255,0.75)' }}>Qualified: 1 | Risk vetoed: 0</div>
          <div style={{ marginTop: '0.2rem', fontStyle: 'italic' }}>Silence is a valid signal.</div>
        </div>
      ),
    },
  };

  const tabKeys: Array<'alert' | 'status' | 'recap'> = ['alert', 'status', 'recap'];

  return (
    <div className="section-padding container">
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 className="section-title">Telegram Native</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: '0.45rem' }}>Your signal terminal delivered without clutter.</p>
      </div>

      <div className="telegram-split">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minWidth: 0 }} role="tablist" aria-label="Telegram bot features">
          {tabKeys.map((key) => {
            const selected = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(key)}
                style={{
                  textAlign: 'left',
                  padding: '0.95rem 1.1rem',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  border: '1px solid',
                  borderColor: selected ? 'var(--accent-color)' : 'var(--border-color)',
                  backgroundColor: selected ? 'var(--surface-elevated)' : 'var(--card-bg)',
                  color: 'var(--text-color)',
                  transition: 'border-color 0.18s ease, background-color 0.18s ease',
                }}
              >
                <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>{content[key].title}</div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', lineHeight: 1.45 }}>{content[key].desc}</p>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '285px', backgroundColor: '#0f0f0f', border: '2px solid var(--border-strong)', borderRadius: '20px', height: '272px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ backgroundColor: '#1d222b', padding: '0.65rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <ChevronLeft size={18} color="#5288c1" />
              <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bell size={14} color="#ffffff" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600, lineHeight: 1.1 }}>Axnna</span>
                <span style={{ color: '#8f9bb3', fontSize: '0.68rem' }}>bot</span>
              </div>
            </div>

            <div style={{ flex: 1, padding: '0.85rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '0.5rem', background: 'linear-gradient(180deg, #111620 0%, #0b0e14 100%)' }}>
              <div className="mono" style={{ alignSelf: 'flex-end', backgroundColor: '#2b5278', color: '#fff', borderRadius: '10px', borderBottomRightRadius: '3px', padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}>
                {content[activeTab].prompt}
              </div>
              <div
                key={activeTab}
                className="axnna-fade-in"
                style={{ backgroundColor: '#1f3b5b', color: '#fff', borderRadius: '12px', borderBottomLeftRadius: '3px', padding: '0.8rem', alignSelf: 'flex-start', width: '100%' }}
              >
                {content[activeTab].mock}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="landing-page">
      <DynamicHero />
      <InstrumentStrip />

      <section id="how-it-works" className="section-padding container">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2 className="section-title">How Axnna works</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: '0.45rem' }}>
            A purely deterministic pipeline from completed candles to Telegram notification.
          </p>
        </div>

        <div className="how-grid">
          {[
            { step: '01', title: 'Market Monitoring', desc: 'Tracks 1H and 5M candles with automatic provider failover.', icon: <Activity size={17} color="var(--accent-color)" /> },
            { step: '02', title: 'Technical Geometry', desc: 'Maps bias, liquidity sweeps, ATR displacement, and FVGs.', icon: <Target size={17} color="var(--accent-color)" /> },
            { step: '03', title: 'Macro Risk Gate', desc: 'Checks upcoming calendar events and vetoes extreme risk.', icon: <Shield size={17} color="var(--accent-color)" /> },
            { step: '04', title: 'Deterministic Score', desc: 'Scores setups on strict geometry; discards below 65%.', icon: <BarChart2 size={17} color="var(--accent-color)" /> },
            { step: '05', title: 'Telegram Delivery', desc: 'Pushes Entry, Stop, and Target alerts straight to subscribers.', icon: <Bell size={17} color="var(--accent-color)" /> },
          ].map((item) => (
            <div key={item.step} className="glass-card how-card" style={{ padding: '0.95rem 1.05rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', flexShrink: 0 }}>
                <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.74rem', fontWeight: 600 }}>{item.step}</span>
                {item.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.25rem' }}>{item.title}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', lineHeight: 1.45 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="section-padding container" style={{ paddingTop: '0.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <h2 className="section-title">Setup Geometry &amp; Risk Veto</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: '0.45rem' }}>
            Data flows one way—from verified OHLC bars through deterministic validation.
          </p>
        </div>

        <SetupDiagram />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '1rem 1.15rem' }}>
            <Settings size={20} color="var(--accent-color)" />
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Stateless Evaluation</h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Versioned state checkpointed per pair in D1.</p>
            </div>
          </div>
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '1rem 1.15rem' }}>
            <MessageSquare size={20} color="var(--accent-color)" />
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Direct Telegram Push</h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Idempotent alert delivery with backoff retries.</p>
            </div>
          </div>
        </div>
      </section>

      <TelegramTabs />

      <section className="section-padding container">
        <BeforeAfterSummary />

        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h2 className="section-title">Why Axnna</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.96rem', marginTop: '0.4rem' }}>
            Built to separate market structure from screen noise.
          </p>
        </div>

        <WhyAxnnaComparison />
      </section>

      <section className="section-padding container" style={{ paddingBottom: '1rem' }}>
        <div className="glass-card" style={{ maxWidth: '760px', margin: '0 auto', borderColor: 'rgba(248, 81, 73, 0.35)', textAlign: 'center', padding: '1.5rem' }}>
          <AlertTriangle size={28} color="var(--error-color)" style={{ marginBottom: '0.75rem' }} />
          <h2 style={{ fontSize: '1.45rem', fontWeight: 700, marginBottom: '0.55rem' }}>Markets can move against you.</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.94rem', maxWidth: '620px', margin: '0 auto 1.25rem', lineHeight: 1.55 }}>
            Trading involves substantial risk and losses are possible. Axnna does not guarantee profits. Signal scores reflect internal geometric alignment, not probabilities of profit.
          </p>
          <Link to="/legal/risk" className="button-secondary">Read full Risk Disclosure</Link>
        </div>
      </section>

      <section className="section-padding container" style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(1.75rem, 3.8vw, 2.5rem)', fontWeight: 700, marginBottom: '0.75rem' }}>Ready to connect?</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: '1.5rem' }}>
          Requires Telegram, internet access, and an understanding of financial market risk.
        </p>
        <Link to="/connect-telegram" className="button-primary" style={{ padding: '0.85rem 1.75rem' }}>
          Get Axnna on Telegram <ArrowRight size={17} />
        </Link>
      </section>
    </div>
  );
}
