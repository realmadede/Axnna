import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Bell, ChevronLeft, MessageSquare, ShieldCheck, Target } from 'lucide-react';

export function HeroMarketIntelligence() {
  return (
    <div className="glass-card" style={{ width: '100%', maxWidth: '370px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Activity size={18} color="var(--accent-color)" />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Market Monitor</h3>
        </div>
        <span className="admin-badge admin-badge--ok">24/5 FEED</span>
      </div>
      {[
        { pair: 'EURUSD', tf: '1H -> 5M' },
        { pair: 'GBPUSD', tf: '1H -> 5M' },
        { pair: 'USDJPY', tf: '1H -> 5M' },
        { pair: 'XAUUSD', tf: '1H -> 5M' },
      ].map((item, i) => (
        <div key={item.pair} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.85rem', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <strong className="mono" style={{ fontSize: '0.95rem' }}>{item.pair}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.tf}</span>
            <div className="axnna-pulse-dot" style={{ animationDelay: `${i * 0.4}s` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HeroSignalAnalysis() {
  return (
    <div className="glass-card" style={{ width: '100%', maxWidth: '370px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Target size={18} color="var(--accent-color)" />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Deterministic Scoring</h3>
        </div>
        <span className="admin-badge">FAIL-CLOSED</span>
      </div>
      {[
        { label: 'HTF Structural Bias', value: 'PASS' },
        { label: 'Liquidity Sweep', value: 'CONFIRMED' },
        { label: 'Displacement + FVG', value: 'ALIGNED' },
        { label: 'Macro Event Risk Gate', value: 'CLEAR' },
      ].map((step) => (
        <div key={step.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.85rem', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>{step.label}</span>
          <span className="mono" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--success-color)' }}>{step.value}</span>
        </div>
      ))}
    </div>
  );
}

export function HeroTelegramMock() {
  return (
    <div style={{ width: '100%', maxWidth: '310px', backgroundColor: '#0f0f0f', border: '3px solid var(--border-strong)', borderRadius: '28px', height: '380px', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 16px 40px rgba(0,0,0,0.28)' }}>
      <div style={{ backgroundColor: '#1d222b', padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', gap: '0.55rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <ChevronLeft size={20} color="#5288c1" />
        <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bell size={15} color="#ffffff" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.1 }}>Axnna</span>
          <span style={{ color: '#8f9bb3', fontSize: '0.72rem' }}>bot</span>
        </div>
      </div>
      <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'linear-gradient(180deg, #111620 0%, #0b0e14 100%)' }}>
        <div
          className="axnna-fade-in"
          style={{ backgroundColor: '#1f3b5b', color: '#fff', borderRadius: '14px', borderBottomLeftRadius: '4px', padding: '1rem', width: '100%' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
            <strong className="mono" style={{ fontSize: '0.98rem' }}>EURUSD</strong>
            <span className="mono" style={{ color: '#2dd47e', fontWeight: 600 }}>LONG</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.9rem', fontSize: '0.82rem' }}>
            <span style={{ color: 'rgba(255,255,255,0.72)' }}>Score</span>
            <span className="mono" style={{ color: '#2dd47e', fontWeight: 600 }}>78 / 100</span>
          </div>
          <div className="mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem', fontSize: '0.8rem' }}>
            <div style={{ color: 'rgba(255,255,255,0.72)' }}>Entry</div>
            <div style={{ textAlign: 'right' }}>1.17420</div>
            <div style={{ color: 'rgba(255,255,255,0.72)' }}>Stop</div>
            <div style={{ textAlign: 'right' }}>1.17280</div>
            <div style={{ color: 'rgba(255,255,255,0.72)' }}>Target</div>
            <div style={{ textAlign: 'right' }}>1.17740</div>
          </div>
        </div>
      </div>
      <div style={{ height: '40px', backgroundColor: '#1d222b', display: 'flex', alignItems: 'center', padding: '0 1rem', color: '#8f9bb3', fontSize: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        /status EURUSD
      </div>
    </div>
  );
}

export function DynamicHero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [userSelected, setUserSelected] = useState(false);

  useEffect(() => {
    if (userSelected) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 5500);
    return () => clearInterval(timer);
  }, [userSelected]);

  const stages = [
    { label: '01 Monitor', visual: <HeroMarketIntelligence /> },
    { label: '02 Evaluate', visual: <HeroSignalAnalysis /> },
    { label: '03 Deliver', visual: <HeroTelegramMock /> },
  ];

  return (
    <section className="section-padding" style={{ minHeight: '76vh', display: 'flex', alignItems: 'center', paddingTop: '3.5rem' }}>
      <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '3.5rem', alignItems: 'center', width: '100%' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', borderRadius: '9999px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', marginBottom: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <ShieldCheck size={15} color="var(--success-color)" />
            <span className="mono">DETERMINISTIC ENGINE • TELEGRAM NATIVE</span>
          </div>

          <h1 className="hero-title" style={{ marginBottom: '1.35rem' }}>
            <span className="text-gradient">Market intelligence.</span>
            <br />
            Delivered only when rules align.
          </h1>

          <p style={{ fontSize: '1.15rem', color: 'var(--text-muted)', marginBottom: '2.25rem', maxWidth: '520px', lineHeight: 1.65 }}>
            Axnna continuously maps <strong style={{ color: 'var(--text-color)' }}>1H</strong> structure and <strong style={{ color: 'var(--text-color)' }}>5M</strong> liquidity setups across EURUSD, GBPUSD, USDJPY, and XAUUSD—vetting macroeconomic event risk before sending setups scoring <span className="mono">65+</span> straight to Telegram.
          </p>

          <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to="/connect-telegram" className="button-primary" style={{ padding: '0.9rem 1.75rem', fontSize: '1rem' }}>
              <MessageSquare size={18} />
              Connect to Telegram
            </Link>
            <a href="#how-it-works" className="button-secondary" style={{ padding: '0.9rem 1.75rem', fontSize: '1rem' }}>
              How it works
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ display: 'inline-flex', gap: '0.35rem', padding: '0.3rem', borderRadius: '10px', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }} role="tablist" aria-label="Pipeline preview stages">
            {stages.map((stage, i) => (
              <button
                key={stage.label}
                type="button"
                role="tab"
                aria-selected={activeIndex === i}
                onClick={() => {
                  setUserSelected(true);
                  setActiveIndex(i);
                }}
                className="mono"
                style={{
                  padding: '0.45rem 0.8rem',
                  borderRadius: '7px',
                  border: 'none',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: activeIndex === i ? 'var(--surface-elevated)' : 'transparent',
                  color: activeIndex === i ? 'var(--text-color)' : 'var(--text-muted)',
                  borderBottom: activeIndex === i ? '2px solid var(--accent-color)' : '2px solid transparent',
                }}
              >
                {stage.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', width: '100%', minHeight: '380px', alignItems: 'center' }}>
            <div key={`visual-${activeIndex}`} className="axnna-fade-in" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
              {stages[activeIndex].visual}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
