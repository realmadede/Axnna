import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Activity, Target, ChevronLeft, Bell, MessageSquare } from 'lucide-react';

export function HeroMarketIntelligence() {
  return (
    <div className="glass-card" style={{ width: '100%', maxWidth: '360px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <Activity size={20} color="var(--accent-color)" />
        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Market Monitor</h3>
      </div>
      {['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'].map((pair, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', backgroundColor: 'rgba(128,128,128,0.05)', borderRadius: '8px' }}>
          <strong style={{ fontSize: '1rem' }}>{pair}</strong>
          <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 2, delay: i * 0.4 }} style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--success-color)' }} />
        </div>
      ))}
    </div>
  );
}

export function HeroSignalAnalysis() {
  return (
    <div className="glass-card" style={{ width: '100%', maxWidth: '360px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <Target size={20} color="var(--accent-color)" />
        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Engine Processing</h3>
      </div>
      {['Structural Geometry', 'Liquidity Sweep', 'Displacement', 'Macro Context'].map((step, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', backgroundColor: 'rgba(128,128,128,0.05)', borderRadius: '8px' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{step}</span>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.5, type: 'spring' }}>
            <Activity size={16} color="var(--success-color)" />
          </motion.div>
        </div>
      ))}
    </div>
  );
}

export function HeroTelegramMock() {
  const [score, setScore] = useState(65);
  
  useEffect(() => {
    let s = 65;
    const interval = setInterval(() => {
      s += 1;
      if (s >= 78) {
        clearInterval(interval);
      }
      setScore(s);
    }, 40);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ width: '100%', maxWidth: '300px', backgroundColor: '#0f0f0f', border: '4px solid var(--text-color)', borderRadius: '32px', height: '400px', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
      <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '120px', height: '24px', backgroundColor: 'var(--text-color)', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', zIndex: 10 }}></div>
      <div style={{ backgroundColor: '#212121', paddingTop: '2.5rem', paddingBottom: '0.5rem', paddingLeft: '0.5rem', paddingRight: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <ChevronLeft size={24} color="#5288c1" />
        <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: 'var(--text-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bell size={16} color="var(--bg-color)" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.1 }}>Axnna</span>
          <span style={{ color: '#aaa', fontSize: '0.7rem' }}>bot</span>
        </div>
      </div>
      <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backgroundImage: 'radial-gradient(circle at center, #1a1a1a 0%, #0f0f0f 100%)' }}>
        <motion.div 
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4 }}
          style={{ backgroundColor: '#2b5278', color: '#fff', borderRadius: '16px', borderBottomLeftRadius: '4px', padding: '1rem', alignSelf: 'flex-start', width: '100%', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '1rem' }}>EURUSD</strong>
            <span style={{ color: 'var(--success-color)', fontWeight: 600 }}>BUY</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>Signal strength</span>
            <span style={{ color: score >= 78 ? 'var(--success-color)' : '#fff', fontSize: '0.85rem', fontWeight: 600 }}>{score}%</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem' }}>
            <div style={{ color: 'rgba(255,255,255,0.7)' }}>Entry:</div>
            <div style={{ textAlign: 'right' }}>1.17420</div>
            <div style={{ color: 'rgba(255,255,255,0.7)' }}>Stop Loss:</div>
            <div style={{ textAlign: 'right' }}>1.17280</div>
          </div>
        </motion.div>
      </div>
      <div style={{ height: '40px', backgroundColor: '#212121', display: 'flex', alignItems: 'center', padding: '0 1rem', color: '#aaa', fontSize: '0.8rem' }}>
        Message
      </div>
    </div>
  );
}

export function DynamicHero() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const states = [
    {
      title: <><span className="text-gradient">Market intelligence.</span><br/>Always monitoring.</>,
      desc: 'Axnna constantly tracks major currency pairs across multiple execution timeframes, mapping structure and liquidity.',
      visual: <HeroMarketIntelligence />
    },
    {
      title: <><span className="text-gradient">Signal analysis.</span><br/>Checking context.</>,
      desc: 'Every setup is evaluated geometrically and checked against extreme macroeconomic event risk before being scored.',
      visual: <HeroSignalAnalysis />
    },
    {
      title: <><span className="text-gradient">Automated signals.</span><br/>Delivered natively.</>,
      desc: 'When the numbers align and the internal score exceeds 65%, you receive a structured notification instantly.',
      visual: <HeroTelegramMock />
    }
  ];

  return (
    <section className="section-padding" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', paddingTop: '4rem' }}>
      <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '4rem', alignItems: 'center', width: '100%' }}>
        
        <div>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
            >
              <h1 className="hero-title" style={{ marginBottom: '1.5rem' }}>
                {states[activeIndex].title}
              </h1>
              <p style={{ fontSize: '1.25rem', color: 'var(--text-muted)', marginBottom: '3rem', maxWidth: '500px', lineHeight: 1.6 }}>
                {states[activeIndex].desc}
              </p>
            </motion.div>
          </AnimatePresence>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to="/connect-telegram" className="button-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 2rem', fontSize: '1.1rem' }}>
              <MessageSquare size={20} />
              Connect to Telegram
            </Link>
            <a href="#how-it-works" className="button-secondary" style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}>
              How it works
            </a>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '3rem' }}>
            {[0, 1, 2].map((i) => (
              <button 
                key={i} 
                onClick={() => setActiveIndex(i)}
                style={{ width: '40px', height: '4px', borderRadius: '2px', backgroundColor: activeIndex === i ? 'var(--text-color)' : 'var(--border-color)', border: 'none', cursor: 'pointer', transition: 'background-color 0.3s' }}
                aria-label={`Switch to slide ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', minHeight: '400px', alignItems: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4 }}
              style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
            >
              {states[activeIndex].visual}
            </motion.div>
          </AnimatePresence>
        </div>

      </div>
    </section>
  );
}
