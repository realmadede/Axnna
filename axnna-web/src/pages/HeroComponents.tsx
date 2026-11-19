import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Bell, ChevronLeft, MessageSquare, ShieldCheck, Target } from 'lucide-react';

export function HeroMarketIntelligence() {
  return (
    <div className="glass-card" style={{ width: '100%', maxWidth: '340px', padding: '1.15rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.65rem', marginBottom: '0.15rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={16} color="var(--accent-color)" />
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Market Monitor</h3>
        </div>
        <span className="admin-badge admin-badge--ok">24/5 FEED</span>
      </div>
      {[
        { pair: 'EURUSD', tf: '1H -> 5M' },
        { pair: 'GBPUSD', tf: '1H -> 5M' },
        { pair: 'USDJPY', tf: '1H -> 5M' },
        { pair: 'XAUUSD', tf: '1H -> 5M' },
      ].map((item, i) => (
        <div key={item.pair} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.52rem 0.75rem', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <strong className="mono" style={{ fontSize: '0.88rem' }}>{item.pair}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.tf}</span>
            <div className="axnna-pulse-dot" style={{ animationDelay: `${i * 0.4}s` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HeroSignalAnalysis() {
  return (
    <div className="glass-card" style={{ width: '100%', maxWidth: '340px', padding: '1.15rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.65rem', marginBottom: '0.15rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Target size={16} color="var(--accent-color)" />
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Deterministic Scoring</h3>
        </div>
        <span className="admin-badge">FAIL-CLOSED</span>
      </div>
      {[
        { label: 'HTF Structural Bias', value: 'PASS' },
        { label: 'Liquidity Sweep', value: 'CONFIRMED' },
        { label: 'Displacement + FVG', value: 'ALIGNED' },
        { label: 'Macro Event Risk Gate', value: 'CLEAR' },
      ].map((step) => (
        <div key={step.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.52rem 0.75rem', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{step.label}</span>
          <span className="mono" style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--success-color)' }}>{step.value}</span>
        </div>
      ))}
    </div>
  );
}

export function HeroTelegramMock() {
  return (
    <div style={{ width: '100%', maxWidth: '305px', backgroundColor: '#0f0f0f', border: '2px solid var(--border-strong)', borderRadius: '20px', height: '278px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 12px 30px rgba(0,0,0,0.25)' }}>
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
      <div style={{ flex: 1, padding: '0.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '0.5rem', background: 'linear-gradient(180deg, #111620 0%, #0b0e14 100%)' }}>
        <div className="mono" style={{ alignSelf: 'flex-end', backgroundColor: '#2b5278', color: '#fff', borderRadius: '10px', borderBottomRightRadius: '3px', padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}>
          /status EURUSD
        </div>
        <div
          className="axnna-fade-in"
          style={{ backgroundColor: '#1f3b5b', color: '#fff', borderRadius: '12px', borderBottomLeftRadius: '3px', padding: '0.75rem 0.85rem', width: '100%' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem', fontSize: '0.86rem' }}>
            <strong className="mono">EURUSD</strong>
            <span className="mono" style={{ color: '#2dd47e', fontWeight: 600 }}>LONG • 78/100</span>
          </div>
          <div className="mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.28rem', fontSize: '0.76rem' }}>
            <div style={{ color: 'rgba(255,255,255,0.72)' }}>Entry</div>
            <div style={{ textAlign: 'right' }}>1.17420</div>
            <div style={{ color: 'rgba(255,255,255,0.72)' }}>Stop</div>
            <div style={{ textAlign: 'right' }}>1.17280</div>
            <div style={{ color: 'rgba(255,255,255,0.72)' }}>Target</div>
            <div style={{ textAlign: 'right' }}>1.17740</div>
          </div>
        </div>
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
    <section style={{ padding: '2.5rem 0 2.25rem' }}>
      <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '2.5rem', alignItems: 'center', width: '100%' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.3rem 0.65rem', borderRadius: '9999px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', marginBottom: '1rem', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            <ShieldCheck size={14} color="var(--success-color)" />
            <span className="mono">DETERMINISTIC ENGINE • TELEGRAM NATIVE</span>
          </div>

          <h1 className="hero-title" style={{ marginBottom: '1rem' }}>
            <span className="text-gradient">Market intelligence.</span>
            <br />
            Delivered only when rules align.
          </h1>

          <p style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '1.65rem', maxWidth: '490px', lineHeight: 1.6 }}>
            Axnna monitors <strong style={{ color: 'var(--text-color)' }}>1H</strong> structure and <strong style={{ color: 'var(--text-color)' }}>5M</strong> liquidity setups across EURUSD, GBPUSD, USDJPY, and XAUUSD—vetting macro risk before sending setups scoring <span className="mono">65+</span> to Telegram.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to="/connect-telegram" className="button-primary">
              <MessageSquare size={17} />
              Connect to Telegram
            </Link>
            <a href="#how-it-works" className="button-secondary">
              How it works
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{ display: 'inline-flex', gap: '0.25rem', padding: '0.25rem', borderRadius: '9px', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }} role="tablist" aria-label="Pipeline preview stages">
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
                  padding: '0.4rem 0.7rem',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '0.74rem',
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

          <div style={{ display: 'flex', justifyContent: 'center', width: '100%', minHeight: '280px', alignItems: 'center' }}>
            <div key={`visual-${activeIndex}`} className="axnna-fade-in" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
              {stages[activeIndex].visual}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
