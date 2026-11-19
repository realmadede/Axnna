import { Menu, Moon, Sun, X } from 'lucide-react';
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AxnnaLogo } from './components/AxnnaLogo';

import Status from './pages/Status';

const Landing = lazy(() => import('./pages/Landing'));
const ConnectTelegram = lazy(() => import('./pages/ConnectTelegram'));
const Strategies = lazy(() => import('./pages/Strategies'));
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
    <div className="cookie-banner">
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.85rem', lineHeight: 1.5 }}>
        We use essential cookies for secure sessions and theme preference. See our{' '}
        <Link to="/legal/cookies" style={{ textDecoration: 'underline', color: 'var(--text-color)' }}>
          Cookie Policy
        </Link>
        .
      </p>
      <button
        type="button"
        className="button-primary"
        style={{ width: '100%', padding: '0.55rem', fontSize: '0.85rem' }}
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
  const isActive = (path: string) => (location.pathname === path ? 'active' : '');

  const [isLight, setIsLight] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hasSavedTg, setHasSavedTg] = useState(() => Boolean(localStorage.getItem('axnna_tg_session_token')));

  useEffect(() => {
    const syncTgState = () => {
      setHasSavedTg(Boolean(localStorage.getItem('axnna_tg_session_token')));
    };
    window.addEventListener('axnna-tg-changed', syncTgState);
    window.addEventListener('storage', syncTgState);
    return () => {
      window.removeEventListener('axnna-tg-changed', syncTgState);
      window.removeEventListener('storage', syncTgState);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('axnna_theme');
    if (saved === 'light') {
      setIsLight(true);
      document.body.classList.add('light-mode');
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  // Scroll smoothly to hash anchors across routes, otherwise reset to top
  useEffect(() => {
    setMobileMenuOpen(false);
    if (location.hash) {
      const targetId = location.hash.slice(1);
      const timer = setTimeout(() => {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 60);
      return () => clearTimeout(timer);
    }
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  const toggleTheme = () => {
    if (isLight) {
      document.body.classList.remove('light-mode');
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('axnna_theme', 'dark');
      setIsLight(false);
    } else {
      document.body.classList.add('light-mode');
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('axnna_theme', 'light');
      setIsLight(true);
    }
  };

  const navItems = (
    <>
      <Link to="/#how-it-works">How it works</Link>
      <Link to="/#features">Features</Link>
      <Link to="/strategies" className={isActive('/strategies')}>Strategy</Link>
      <Link to="/faq" className={isActive('/faq')}>FAQ</Link>
      <Link to="/status" className={isActive('/status')}>Status</Link>
    </>
  );

  return (
    <div>
      <header className="layout-header">
        <div className="header-inner">
          <Link to="/" className="logo" aria-label="Axnna Home">
            <AxnnaLogo size={28} />
          </Link>

          <nav className="header-nav" aria-label="Primary Navigation">
            {navItems}
          </nav>

          <div className="header-actions">
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {isLight ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            {location.pathname !== '/connect-telegram' && (
              <Link
                to="/connect-telegram"
                className={hasSavedTg ? 'button-secondary header-cta' : 'button-primary header-cta'}
              >
                {hasSavedTg && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: 'var(--success-color)',
                      display: 'inline-block',
                    }}
                  />
                )}
                <span>{hasSavedTg ? 'Telegram Connected' : 'Connect to Telegram'}</span>
              </Link>
            )}
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav className="mobile-drawer" aria-label="Mobile Navigation">
            {navItems}
            <Link
              to="/connect-telegram"
              className={hasSavedTg ? 'button-secondary' : 'button-primary'}
              style={{ marginTop: '0.5rem' }}
            >
              {hasSavedTg ? 'Telegram Connected' : 'Connect to Telegram'}
            </Link>
          </nav>
        )}
      </header>

      <main>
        <Suspense fallback={<div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>}>
          {children}
        </Suspense>
      </main>

      <CookieBanner />

      <footer className="footer">
        <div className="footer-col">
          <Link to="/" className="logo" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-color)' }}>
            <AxnnaLogo size={26} />
          </Link>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '1rem', lineHeight: 1.5 }}>
            Deterministic market structure analysis delivered through Telegram.
          </p>
        </div>
        <div className="footer-col">
          <h4>Product</h4>
          <ul>
            <li><Link to="/about">About Axnna</Link></li>
            <li><Link to="/strategies">Methodology</Link></li>
            <li><Link to="/faq">FAQ</Link></li>
            <li><Link to="/contact">Contact &amp; Feedback</Link></li>
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
            <li><Link to="/status">System Status</Link></li>
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
        <Route path="/strategies" element={<div className="container" style={{ paddingTop: '2.25rem' }}><Strategies /></div>} />
        <Route path="/methodology" element={<Navigate to="/strategies" replace />} />
        <Route path="/about" element={<div className="container" style={{ paddingTop: '2.25rem' }}><About /></div>} />
        <Route path="/contact" element={<div className="container" style={{ paddingTop: '2.25rem' }}><Contact /></div>} />
        <Route path="/faq" element={<div className="container" style={{ paddingTop: '2.25rem' }}><FAQ /></div>} />
        <Route path="/status" element={<div className="container" style={{ paddingTop: '2.25rem' }}><Status /></div>} />
        <Route path="/legal/:page" element={<div className="container" style={{ paddingTop: '2.25rem' }}><Legal /></div>} />
        <Route path="/connect-telegram" element={<ConnectTelegram />} />
      </Routes>
    </Layout>
  );
}
