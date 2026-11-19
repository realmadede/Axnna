import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, BarChart2, Bell, ChevronLeft, MessageSquare, Settings, Shield, Target } from 'lucide-react';
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
                <div className="mono" style={{ fontWeight: 600, fontSize: '1rem' }}>{m.pair}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{m.type}</div>
              </div>
              <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 500 }}>
                {m.schedule}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BeforeAfterToggle() {
  const [isAxnna, setIsAxnna] = useState(true);

  return (
    <div style={{ padding: '2rem 0 4.5rem', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', backgroundColor: 'var(--card-bg)', borderRadius: '10px', padding: '0.25rem', border: '1px solid var(--border-color)', marginBottom: '2.25rem' }}>
        <button
          type="button"
          onClick={() => setIsAxnna(false)}
          style={{ padding: '0.5rem 1.35rem', borderRadius: '8px', border: 'none', background: !isAxnna ? 'var(--text-color)' : 'transparent', color: !isAxnna ? 'var(--bg-color)' : 'var(--text-muted)', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.2s' }}
        >
          Before Axnna
        </button>
        <button
          type="button"
          onClick={() => setIsAxnna(true)}
          style={{ padding: '0.5rem 1.35rem', borderRadius: '8px', border: 'none', background: isAxnna ? 'var(--text-color)' : 'transparent', color: isAxnna ? 'var(--bg-color)' : 'var(--text-muted)', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.2s' }}
        >
          After Axnna
        </button>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {!isAxnna ? (
          <div className="glass-card" style={{ padding: 'clamp(1.5rem, 4vw, 2.5rem)', borderStyle: 'dashed', borderColor: 'var(--error-color)' }}>
            <h3 style={{ fontSize: '1.35rem', marginBottom: '0.85rem', color: 'var(--error-color)' }}>Manual Screen Fatigue</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', lineHeight: 1.65 }}>
              Watching charts for 12+ hours, second-guessing liquidity sweeps, missing high-impact news releases, and forcing trades out of boredom.
            </p>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: 'clamp(1.5rem, 4vw, 2.5rem)', borderColor: 'var(--success-color)' }}>
            <h3 style={{ fontSize: '1.35rem', marginBottom: '0.85rem', color: 'var(--success-color)' }}>Deterministic Silence</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', lineHeight: 1.65 }}>
              Step away from the screens. Axnna processes completed candles every cycle and only notifies you when mathematical structure and macro safety agree.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface TabEntry {
  title: string;
  desc: string;
  mock: ReactNode;
}

function TelegramTabs() {
  const [activeTab, setActiveTab] = useState<'alert' | 'status' | 'recap'>('alert');

  const content: Record<'alert' | 'status' | 'recap', TabEntry> = {
    alert: {
      title: 'Automated Setup Alerts',
      desc: 'Instant Telegram delivery whenever geometric alignment exceeds the 65-point release threshold.',
      mock: (
        <div className="mono" style={{ fontSize: '0.86rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>EURUSD</strong>
            <span style={{ color: '#2dd47e', fontWeight: 600 }}>LONG</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.75)', margin: '0.45rem 0' }}>Score: 78/100</div>
          <div>Entry: 1.17420 | Stop: 1.17280</div>
          <div>Target: 1.17740 (R:R 2.29)</div>
        </div>
      ),
    },
    status: {
      title: 'On-Demand Status',
      desc: 'Query live HTF bias and macroeconomic risk directly inside the bot at any time.',
      mock: (
        <div className="mono" style={{ fontSize: '0.86rem' }}>
          <div style={{ color: '#6cb6ff' }}>/status EURUSD</div>
          <div style={{ marginTop: '0.5rem' }}>HTF Bias: <strong>BULLISH</strong></div>
          <div style={{ color: 'rgba(255,255,255,0.75)' }}>Macro Risk: LOW</div>
        </div>
      ),
    },
    recap: {
      title: 'Daily Recaps',
      desc: 'End-of-day UTC summary of processed sessions, qualified setups, and risk vetoes.',
      mock: (
        <div className="mono" style={{ fontSize: '0.86rem' }}>
          <div><strong>Daily Recap (21:00 UTC)</strong></div>
          <div style={{ marginTop: '0.5rem', color: 'rgba(255,255,255,0.75)' }}>Setups qualified: 1</div>
          <div style={{ color: 'rgba(255,255,255,0.75)' }}>Risk-gate vetoes: 0</div>
          <div style={{ marginTop: '0.45rem', fontStyle: 'italic' }}>Silence is a valid signal.</div>
        </div>
      ),
    },
  };

  const tabKeys: Array<'alert' | 'status' | 'recap'> = ['alert', 'status', 'recap'];

  return (
    <div className="section-padding container">
      <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
        <h2 className="section-title">Telegram Native</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.15rem', marginTop: '0.75rem' }}>Your signal terminal delivered without clutter.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '3.5rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }} role="tablist" aria-label="Telegram bot features">
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
                  padding: '1.35rem',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  border: '1px solid',
                  borderColor: selected ? 'var(--accent-color)' : 'var(--border-color)',
                  backgroundColor: selected ? 'var(--surface-elevated)' : 'var(--card-bg)',
                  color: 'var(--text-color)',
                  transition: 'border-color 0.18s ease, background-color 0.18s ease',
                }}
              >
                <div style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.35rem' }}>{content[key].title}</div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.5 }}>{content[key].desc}</p>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '310px', backgroundColor: '#0f0f0f', border: '3px solid var(--border-strong)', borderRadius: '28px', height: '400px', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ backgroundColor: '#1d222b', padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', gap: '0.55rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <ChevronLeft size={20} color="#5288c1" />
              <div style={{ width: 34, height: 34, borderRadius: '50%', backgroundColor: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bell size={16} color="#ffffff" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ color: '#fff', fontSize: '0.95rem', fontWeight: 600, lineHeight: 1.1 }}>Axnna</span>
                <span style={{ color: '#8f9bb3', fontSize: '0.72rem' }}>bot</span>
              </div>
            </div>

            <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'linear-gradient(180deg, #111620 0%, #0b0e14 100%)' }}>
              <div
                key={activeTab}
                className="axnna-fade-in"
                style={{ backgroundColor: '#1f3b5b', color: '#fff', borderRadius: '14px', borderBottomLeftRadius: '4px', padding: '1rem', alignSelf: 'flex-start', width: '100%' }}
              >
                {content[activeTab].mock}
              </div>
            </div>

            <div style={{ height: '44px', backgroundColor: '#1d222b', display: 'flex', alignItems: 'center', padding: '0 1rem', color: '#8f9bb3', fontSize: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              Message
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
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <h2 className="section-title">How Axnna works</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.15rem', marginTop: '0.75rem' }}>
            A purely deterministic pipeline from completed candles to Telegram notification.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
          {[
            { step: '01', title: 'Market Monitoring', desc: 'Tracks completed 1H and 5M candles with automatic provider failover.', icon: <Activity size={20} color="var(--accent-color)" /> },
            { step: '02', title: 'Technical Geometry', desc: 'Identifies structural bias, liquidity sweeps, ATR displacement, and FVGs.', icon: <Target size={20} color="var(--accent-color)" /> },
            { step: '03', title: 'Macro Risk Gate', desc: 'Normalizes economic calendar events and suppresses high-impact risk windows.', icon: <Shield size={20} color="var(--accent-color)" /> },
            { step: '04', title: 'Deterministic Score', desc: 'Scores candidate setups strictly against internal thresholds; discards <65%.', icon: <BarChart2 size={20} color="var(--accent-color)" /> },
            { step: '05', title: 'Telegram Delivery', desc: 'Pushes qualified Entry, Stop Loss, and Target alerts straight to subscribers.', icon: <Bell size={20} color="var(--accent-color)" /> },
          ].map((item) => (
            <div key={item.step} className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>{item.step}</span>
                {item.icon}
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.55rem' }}>{item.title}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.55 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="section-padding container" style={{ paddingTop: '1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h2 className="section-title">Setup Geometry &amp; Risk Veto</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.15rem', marginTop: '0.75rem' }}>
            Data flows one way—from verified OHLC bars through deterministic validation.
          </p>
        </div>

        <SetupDiagram />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Settings size={24} color="var(--accent-color)" />
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Stateless Evaluation</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Versioned state checkpointed per pair in D1.</p>
            </div>
          </div>
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <MessageSquare size={24} color="var(--accent-color)" />
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Direct Telegram Push</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Idempotent alert delivery with backoff retries.</p>
            </div>
          </div>
        </div>
      </section>

      <TelegramTabs />

      <section className="section-padding container">
        <BeforeAfterToggle />

        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h2 className="section-title">Why Axnna</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.15rem', marginTop: '0.75rem' }}>Built to separate noise from structure.</p>
        </div>

        <div className="glass-card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-elevated)' }}>
                <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>Feature</th>
                <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Manual Trading</th>
                <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Generic Signal Groups</th>
                <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', color: 'var(--accent-color)' }}>Axnna</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Market Monitoring', m: 'Constant attention', g: 'Human schedule', a: 'Automated 24/5' },
                { label: 'Fundamental Context', m: 'Manual tracking', g: 'Rarely structured', a: 'Integrated Risk Gate' },
                { label: 'Risk Filtering', m: 'Emotional', g: 'Opaque', a: 'Deterministic >= 65%' },
                { label: 'Delivery', m: 'Screen time', g: 'Chat spam', a: 'Telegram-native alerts' },
                { label: 'Transparency', m: 'Subjective', g: 'Unverified', a: 'Documented Pipeline' },
              ].map((row, i) => (
                <tr key={row.label} style={{ borderBottom: i < 4 ? '1px solid var(--border-color)' : 'none' }}>
                  <td style={{ padding: '1.15rem 1.5rem', fontWeight: 500 }}>{row.label}</td>
                  <td style={{ padding: '1.15rem 1.5rem', color: 'var(--text-muted)' }}>{row.m}</td>
                  <td style={{ padding: '1.15rem 1.5rem', color: 'var(--text-muted)' }}>{row.g}</td>
                  <td style={{ padding: '1.15rem 1.5rem', fontWeight: 600 }}>{row.a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-padding container" style={{ paddingBottom: '2rem' }}>
        <div className="glass-card" style={{ borderColor: 'rgba(248, 81, 73, 0.35)', textAlign: 'center', padding: 'clamp(1.5rem, 4vw, 2.75rem)' }}>
          <AlertTriangle size={40} color="var(--error-color)" style={{ marginBottom: '1.25rem' }} />
          <h2 className="section-title" style={{ marginBottom: '0.85rem' }}>Markets can move against you.</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', maxWidth: '700px', margin: '0 auto 1.75rem', lineHeight: 1.65 }}>
            Trading involves substantial risk and losses are possible. Axnna does not guarantee profits. Signal scores reflect internal geometric alignment, not probabilities of profit.
          </p>
          <Link to="/legal/risk" className="button-secondary">Read full Risk Disclosure</Link>
        </div>
      </section>

      <section className="section-padding container" style={{ textAlign: 'center' }}>
        <h2 className="hero-title" style={{ marginBottom: '1.25rem' }}>Ready to connect?</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.15rem', marginBottom: '2.25rem' }}>
          Requires Telegram, internet access, and an understanding of financial market risk.
        </p>
        <Link to="/connect-telegram" className="button-primary" style={{ padding: '1rem 2.25rem', fontSize: '1.05rem' }}>
          Get Axnna on Telegram <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  );
}
