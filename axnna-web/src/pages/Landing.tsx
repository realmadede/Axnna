import { useState, useEffect, type ReactNode } from 'react';
import { DynamicHero } from './HeroComponents';
import { Link } from 'react-router-dom';
import { ChevronLeft, Bell, Activity, Target, AlertTriangle, MessageSquare, Shield, ArrowRight, Settings, BarChart2 } from 'lucide-react';

function MarketMarquee() {
  const baseMarkets = [
    { pair: 'EURUSD', type: 'Forex Major' },
    { pair: 'GBPUSD', type: 'Forex Major' },
    { pair: 'USDJPY', type: 'Forex Major' },
    { pair: 'XAUUSD', type: 'Commodity' }
  ];
  const markets = [...baseMarkets, ...baseMarkets, ...baseMarkets, ...baseMarkets];

  return (
    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', padding: '1.5rem 0', backgroundColor: 'rgba(0,0,0,0.2)' }}>
      <div className="axnna-marquee-track">
        {markets.map((m, i) => (
          <div key={`${m.pair}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>{m.pair}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{m.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BeforeAfterToggle() {
  const [isAxnna, setIsAxnna] = useState(true);

  return (
    <div style={{ padding: '4rem 0', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', backgroundColor: 'var(--card-bg)', borderRadius: '999px', padding: '0.25rem', border: '1px solid var(--border-color)', marginBottom: '3rem' }}>
        <button
          onClick={() => setIsAxnna(false)}
          style={{ padding: '0.5rem 1.5rem', borderRadius: '999px', border: 'none', background: !isAxnna ? 'var(--text-color)' : 'transparent', color: !isAxnna ? 'var(--bg-color)' : 'var(--text-muted)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
        >
          Before Axnna
        </button>
        <button
          onClick={() => setIsAxnna(true)}
          style={{ padding: '0.5rem 1.5rem', borderRadius: '999px', border: 'none', background: isAxnna ? 'var(--text-color)' : 'transparent', color: isAxnna ? 'var(--bg-color)' : 'var(--text-muted)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
        >
          After Axnna
        </button>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {!isAxnna ? (
          <div className="glass-card" style={{ padding: 'clamp(1.5rem, 5vw, 3rem)', borderStyle: 'dashed', borderColor: 'var(--error-color)' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: 'var(--error-color)' }}>Manual Chaos</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1.6 }}>
              Staring at 5 screens for 14 hours a day. Second-guessing every structural sweep. Entering late because you were reading a macro report. Exhaustion leading to emotional, unaligned execution.
            </p>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: 'clamp(1.5rem, 5vw, 3rem)', borderStyle: 'solid', borderColor: 'var(--success-color)', backgroundColor: 'rgba(52, 199, 89, 0.05)' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: 'var(--success-color)' }}>Deterministic Silence</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1.6 }}>
              Close the charts. Live your life. Axnna processes the structure continuously and only breaks the silence when strict geometric thresholds are breached.
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
      desc: 'Get notified instantly when geometric parameters cross the 65% threshold.',
      mock: (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>EURUSD</strong><span style={{ color: 'var(--success-color)' }}>BUY</span></div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0.5rem 0' }}>Score: 78%</div>
          <div style={{ fontSize: '0.9rem' }}>Entry: 1.17420</div>
        </>
      )
    },
    status: {
      title: 'On-Demand Status',
      desc: 'Check the real-time structural bias of any supported pair.',
      mock: (
        <>
          <div style={{ color: 'var(--accent-color)' }}>/status EURUSD</div>
          <div style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>HTF Bias: <strong>BULLISH</strong></div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Current Macro Risk: LOW</div>
        </>
      )
    },
    recap: {
      title: 'Daily Recaps',
      desc: 'Receive end-of-day summaries of market structure.',
      mock: (
        <>
          <div><strong>Daily Recap</strong></div>
          <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>Analyzed: 576 candles.</div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Setups meeting threshold: 0</div>
          <div style={{ fontSize: '0.9rem', fontStyle: 'italic', marginTop: '0.5rem' }}>Silence is a valid signal.</div>
        </>
      )
    }
  };

  const tabKeys: Array<'alert' | 'status' | 'recap'> = ['alert', 'status', 'recap'];

  return (
    <div className="section-padding container">
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h2 className="section-title">Telegram Native</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', marginTop: '1rem' }}>Your entire terminal, right in your pocket.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '4rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {tabKeys.map((key) => (
            <div
              key={key}
              onClick={() => setActiveTab(key)}
              style={{ padding: '1.5rem', borderRadius: '12px', cursor: 'pointer', border: '1px solid', borderColor: activeTab === key ? 'var(--text-color)' : 'transparent', backgroundColor: activeTab === key ? 'var(--card-bg)' : 'transparent', transition: 'all 0.2s' }}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>{content[key].title}</h3>
              <p style={{ color: 'var(--text-muted)' }}>{content[key].desc}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '300px', backgroundColor: '#0f0f0f', border: '4px solid var(--text-color)', borderRadius: '32px', height: '450px', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '120px', height: '24px', backgroundColor: 'var(--text-color)', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', zIndex: 10 }} />

            <div style={{ backgroundColor: '#212121', paddingTop: '2.5rem', paddingBottom: '0.5rem', paddingLeft: '0.5rem', paddingRight: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <ChevronLeft size={24} color="#5288c1" />
              <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: 'var(--text-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bell size={18} color="var(--bg-color)" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ color: '#fff', fontSize: '1rem', fontWeight: 600, lineHeight: 1.1 }}>Axnna</span>
                <span style={{ color: '#aaa', fontSize: '0.75rem' }}>bot</span>
              </div>
            </div>

            <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backgroundImage: 'radial-gradient(circle at center, #1a1a1a 0%, #0f0f0f 100%)' }}>
              <div
                key={activeTab}
                className="axnna-fade-in"
                style={{ backgroundColor: '#2b5278', color: '#fff', borderRadius: '16px', borderBottomLeftRadius: '4px', padding: '1rem', marginBottom: '1rem', alignSelf: 'flex-start', maxWidth: '95%', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              >
                {content[activeTab].mock}
              </div>
            </div>

            <div style={{ height: '50px', backgroundColor: '#212121', display: 'flex', alignItems: 'center', padding: '0 1rem', color: '#aaa', fontSize: '0.9rem' }}>
              Message
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="landing-page">
      <DynamicHero />
      <MarketMarquee />

      <section id="how-it-works" className="section-padding container">
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 className="section-title">How Axnna works</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', marginTop: '1rem' }}>A purely deterministic pipeline from market data to Telegram notification.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
          {[
            { step: '01', title: 'Market Monitoring', desc: 'Axnna constantly tracks designated execution timeframes, waiting for completed candles.', icon: <Activity /> },
            { step: '02', title: 'Technical Analysis', desc: 'Evaluates structural bias, liquidity pools, sweeps, and price action strictly against mathematical definitions.', icon: <Target /> },
            { step: '03', title: 'Fundamental Context', desc: 'Normalizes macroeconomic data to assign fundamental scores and identify extreme event risks.', icon: <Shield /> },
            { step: '04', title: 'Setup Scoring', desc: 'Candidate setups are scored based on geometric alignment and R:R variables.', icon: <Activity /> },
            { step: '05', title: 'Notification', desc: 'If the setup internal score exceeds 65%, it is delivered to Telegram immediately.', icon: <Bell /> },
          ].map((item) => (
            <div key={item.step} className="glass-card">
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '1rem' }}>{item.step}</div>
              <div style={{ marginBottom: '1rem', color: 'var(--text-color)' }}>{item.icon}</div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>{item.title}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-padding container">
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 className="section-title">Deterministic Architecture</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', marginTop: '1rem' }}>Data flows strictly one way.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '800px', margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            <div className="glass-card" style={{ textAlign: 'center' }}>
              <BarChart2 size={32} color="var(--accent-color)" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ fontWeight: 600 }}>Market Data</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Continuous ingestion</p>
            </div>
            <div className="glass-card" style={{ textAlign: 'center' }}>
              <Shield size={32} color="var(--accent-color)" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ fontWeight: 600 }}>Macro Data</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Economic Calendar</p>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ height: '40px', width: '2px', backgroundColor: 'var(--border-color)' }} />
          </div>

          <div className="glass-card" style={{ textAlign: 'center', border: '1px solid var(--accent-color)', backgroundColor: 'rgba(0,122,255,0.05)' }}>
            <Settings size={32} color="var(--text-color)" style={{ margin: '0 auto 1rem' }} />
            <h3 style={{ fontWeight: 600, fontSize: '1.5rem' }}>Axnna State Engine</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto' }}>
              Stateless evaluation pipeline scoring structural geometry and fundamental confluence against a strict 65% release threshold.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ height: '40px', width: '2px', backgroundColor: 'var(--border-color)' }} />
          </div>

          <div className="glass-card" style={{ textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <MessageSquare size={32} color="#0088cc" style={{ margin: '0 auto 1rem' }} />
            <h3 style={{ fontWeight: 600 }}>Telegram Native API</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Push notification delivery to authenticated users</p>
          </div>
        </div>
      </section>

      <TelegramTabs />

      <section className="section-padding container">
        <BeforeAfterToggle />

        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 className="section-title">Why Axnna</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', marginTop: '1rem' }}>Built to separate noise from structure.</p>
        </div>

        <div className="glass-card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <th style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>Feature</th>
                <th style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Manual Trading</th>
                <th style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Generic Signal Groups</th>
                <th style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', color: 'var(--accent-color)' }}>Axnna</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Market Monitoring', m: 'Constant attention', g: 'Human schedule', a: 'Automated 24/5' },
                { label: 'Fundamental Context', m: 'Manual tracking', g: 'Rarely structured', a: 'Integrated evaluation' },
                { label: 'Risk Filtering', m: 'Emotional', g: 'Unknown', a: 'Deterministic' },
                { label: 'Delivery', m: 'Screen time', g: 'Telegram/Discord', a: 'Telegram-first' },
                { label: 'Transparency', m: 'N/A', g: 'Opaque logic', a: 'Documented Rules' },
              ].map((row, i) => (
                <tr key={row.label} style={{ borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <td style={{ padding: '1.5rem', fontWeight: 500 }}>{row.label}</td>
                  <td style={{ padding: '1.5rem', color: 'var(--text-muted)' }}>{row.m}</td>
                  <td style={{ padding: '1.5rem', color: 'var(--text-muted)' }}>{row.g}</td>
                  <td style={{ padding: '1.5rem', fontWeight: 600 }}>{row.a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-padding container" style={{ paddingBottom: '2rem' }}>
        <div style={{ backgroundColor: 'rgba(255, 59, 48, 0.1)', border: '1px solid rgba(255, 59, 48, 0.3)', borderRadius: '16px', padding: 'clamp(1.5rem, 5vw, 3rem)', textAlign: 'center' }}>
          <AlertTriangle size={48} color="var(--error-color)" style={{ marginBottom: '1.5rem' }} />
          <h2 className="section-title" style={{ marginBottom: '1rem' }}>Markets can move against you.</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', maxWidth: '700px', margin: '0 auto', lineHeight: 1.6, marginBottom: '2rem' }}>
            Trading involves substantial risk and losses are possible. Axnna does not guarantee profits. Our signal scores reflect internal geometric alignment, not probabilities of profit. Historical or simulated performance does not guarantee future results.
          </p>
          <Link to="/legal/risk" className="button-secondary">Read full Risk Disclosure</Link>
        </div>
      </section>

      <section className="section-padding container" style={{ textAlign: 'center' }}>
        <h2 className="hero-title" style={{ marginBottom: '1.5rem' }}>Ready to connect?</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', marginBottom: '3rem' }}>
          You need Telegram, internet access, and an understanding of financial market risk.
        </p>
        <Link to="/connect-telegram" className="button-primary" style={{ padding: '1.25rem 3rem', fontSize: '1.2rem', display: 'inline-flex', alignItems: 'center', gap: '0.75rem' }}>
          Get Axnna on Telegram <ArrowRight size={20} />
        </Link>
      </section>
    </div>
  );
}
