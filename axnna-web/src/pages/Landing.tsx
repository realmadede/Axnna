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

function BeforeAfterToggle() {
  const [isAxnna, setIsAxnna] = useState(true);

  return (
    <div style={{ padding: '0 0 2.5rem', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', backgroundColor: 'var(--card-bg)', borderRadius: '9px', padding: '0.2rem', border: '1px solid var(--border-color)', marginBottom: '1.25rem' }}>
        <button
          type="button"
          onClick={() => setIsAxnna(false)}
          style={{ padding: '0.42rem 1.1rem', borderRadius: '7px', border: 'none', background: !isAxnna ? 'var(--text-color)' : 'transparent', color: !isAxnna ? 'var(--bg-color)' : 'var(--text-muted)', fontWeight: 600, fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.2s' }}
        >
          Before Axnna
        </button>
        <button
          type="button"
          onClick={() => setIsAxnna(true)}
          style={{ padding: '0.42rem 1.1rem', borderRadius: '7px', border: 'none', background: isAxnna ? 'var(--text-color)' : 'transparent', color: isAxnna ? 'var(--bg-color)' : 'var(--text-muted)', fontWeight: 600, fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.2s' }}
        >
          After Axnna
        </button>
      </div>

      <div style={{ maxWidth: '660px', margin: '0 auto' }}>
        {!isAxnna ? (
          <div className="glass-card" style={{ padding: '1.2rem 1.4rem', borderStyle: 'dashed', borderColor: 'var(--error-color)' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.45rem', color: 'var(--error-color)' }}>Manual Screen Fatigue</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.55 }}>
              Watching charts for 12+ hours, second-guessing liquidity sweeps, missing high-impact news releases, and forcing trades out of boredom.
            </p>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: '1.2rem 1.4rem', borderColor: 'var(--success-color)' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.45rem', color: 'var(--success-color)' }}>Deterministic Silence</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.55 }}>
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
        <BeforeAfterToggle />

        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <h2 className="section-title">Why Axnna</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: '0.45rem' }}>Built to separate noise from structure.</p>
        </div>

        <div className="glass-card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', minWidth: '560px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-elevated)' }}>
                <th style={{ padding: '0.85rem 1.15rem', borderBottom: '1px solid var(--border-color)' }}>Feature</th>
                <th style={{ padding: '0.85rem 1.15rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Manual Trading</th>
                <th style={{ padding: '0.85rem 1.15rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Signal Groups</th>
                <th style={{ padding: '0.85rem 1.15rem', borderBottom: '1px solid var(--border-color)', color: 'var(--accent-color)' }}>Axnna</th>
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
                  <td style={{ padding: '0.82rem 1.15rem', fontWeight: 500 }}>{row.label}</td>
                  <td style={{ padding: '0.82rem 1.15rem', color: 'var(--text-muted)' }}>{row.m}</td>
                  <td style={{ padding: '0.82rem 1.15rem', color: 'var(--text-muted)' }}>{row.g}</td>
                  <td style={{ padding: '0.82rem 1.15rem', fontWeight: 600 }}>{row.a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
