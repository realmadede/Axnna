import { Moon, Sun } from 'lucide-react';
import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';

const Landing = lazy(() => import('./pages/Landing'));
const ConnectTelegram = lazy(() => import('./pages/ConnectTelegram'));
const Strategies = lazy(() => import('./pages/Strategies'));
const Config = lazy(() => import('./pages/Config'));
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));
const FAQ = lazy(() => import('./pages/FAQ'));
const Legal = lazy(() => import('./pages/Legal'));

function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('axnna_cookies_accepted')) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', maxWidth: '350px', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.5rem', zIndex: 100, backdropFilter: 'blur(20px)' }}>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
        We use essential cookies to maintain secure sessions and improve your experience. See our <Link to="/legal/cookies" style={{ textDecoration: 'underline' }}>Cookie Policy</Link>.
      </p>
      <button 
        className="button-primary" 
        style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem' }}
        onClick={() => {
          localStorage.setItem('axnna_cookies_accepted', 'true');
          setVisible(false);
        }}
      >
        Accept
      </button>
    </div>
  );
}


function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path ? 'active' : '';

  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('axnna_theme');
    if (saved === 'light') {
      setIsLight(true);
      document.body.classList.add('light-mode');
    }
  }, []);

  const toggleTheme = () => {
    if (isLight) {
      document.body.classList.remove('light-mode');
      localStorage.setItem('axnna_theme', 'dark');
      setIsLight(false);
    } else {
      document.body.classList.add('light-mode');
      localStorage.setItem('axnna_theme', 'light');
      setIsLight(true);
    }
  };

  // The marketing layout
  return (
    <div>
      <header className="layout-header">
        <Link to="/" className="logo">Axnna</Link>
        <Link to="/#how-it-works">How it works</Link>
        <Link to="/strategies" className={isActive('/strategies')}>Strategy</Link>
        <Link to="/#features">Features</Link>
        <Link to="/faq" className={isActive('/faq')}>FAQ</Link>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <button onClick={toggleTheme} style={{ background: 'none', border: 'none', color: 'var(--text-color)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            {isLight ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <Link to="/connect-telegram" className="button-primary">Connect to Telegram</Link>
        </div>
      </header>
      
      <main className="page-transition-enter-active">
        <Suspense fallback={<div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>}>
          {children}
        </Suspense>
      </main>

      <CookieBanner />

      <footer className="footer">
        <div className="footer-col">
          <Link to="/" className="logo" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>Axnna</Link>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>
            Automated market analysis delivered through Telegram.
          </p>
        </div>
        <div className="footer-col">
          <h4>Product</h4>
          <ul>
            <li><Link to="/about">About Axnna</Link></li>
            <li><Link to="/strategies">Methodology</Link></li>
            <li><Link to="/faq">FAQ</Link></li>
            <li><Link to="/contact">Contact & Feedback</Link></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4>Legal</h4>
          <ul>
            <li><Link to="/legal/privacy">Privacy Policy</Link></li>
            <li><Link to="/legal/terms">Terms of Service</Link></li>
            <li><Link to="/legal/risk">Risk Disclosure</Link></li>
            <li><Link to="/legal/cookies">Cookie Policy</Link></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4>System</h4>
          <ul>
            <li><Link to="/config">Config</Link></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        
        
        {/* Marketing / Info pages */}
        <Route path="/strategies" element={<div className="container" style={{paddingTop:'4rem'}}><Strategies /></div>} />
        <Route path="/methodology" element={<Navigate to="/strategies" replace />} />
        <Route path="/about" element={<div className="container" style={{paddingTop:'4rem'}}><About /></div>} />
        <Route path="/contact" element={<div className="container" style={{paddingTop:'4rem'}}><Contact /></div>} />
        <Route path="/faq" element={<div className="container" style={{paddingTop:'4rem'}}><FAQ /></div>} />
        <Route path="/legal/:page" element={<div className="container" style={{paddingTop:'4rem'}}><Legal /></div>} />
        
        <Route path="/connect-telegram" element={<ConnectTelegram />} />
        <Route path="/config/*" element={<div className="container" style={{paddingTop:'4rem'}}><Config /></div>} />
      </Routes>
    </Layout>
  );
}
