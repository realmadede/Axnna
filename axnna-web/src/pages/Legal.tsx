
import { useParams, Navigate } from 'react-router-dom';

export default function Legal() {
  const { page } = useParams();

  const content: Record<string, any> = {
    privacy: {
      title: 'Privacy Policy',
      text: (
        <>
          <p>This Privacy Policy explains how Axnna collects, uses, and discloses information about you. By accessing or using our services, you agree to this policy.</p>
          <h3>Information We Collect</h3>
          <p>When you connect Axnna to Telegram, we collect your Telegram User ID, Chat ID, and public username/name to facilitate the delivery of market signals. We do not collect or store your payment details, broker API keys, or personal trading history.</p>
          <h3>Data Usage</h3>
          <p>Your Telegram identity is used strictly to authenticate your session and push automated notifications directly to your device.</p>
        </>
      )
    },
    terms: {
      title: 'Terms of Service',
      text: (
        <>
          <p>By using Axnna, you agree to be bound by these Terms of Service. Axnna provides structural market analysis and data normalization intended strictly for educational and informational purposes.</p>
          <h3>No Financial Advice</h3>
          <p>Axnna is not a registered investment advisor or broker-dealer. The analysis provided does not constitute financial, investment, or trading advice.</p>
          <h3>Service Availability</h3>
          <p>We do not guarantee uninterrupted access to Axnna. Market data providers and Telegram networks may experience outages beyond our control.</p>
        </>
      )
    },
    risk: {
      title: 'Risk Disclosure',
      text: (
        <>
          <p><strong>TRADING IN FINANCIAL MARKETS INVOLVES SUBSTANTIAL RISK OF LOSS AND IS NOT SUITABLE FOR EVERY INVESTOR.</strong></p>
          <p>The valuation of foreign exchange instruments (Forex) and commodities fluctuates significantly. You may lose all or more of your initial investment.</p>
          <h3>Signal Limitations</h3>
          <p>Axnna generates notifications based on historical mathematical geometry. An Axnna Score (e.g., 78%) is merely a reflection of structural alignment; it is strictly <strong>not a probability of profit</strong>. Historical performance does not guarantee future results.</p>
          <p>You are solely responsible for your trading decisions and risk management.</p>
        </>
      )
    },
    cookies: {
      title: 'Cookie Policy',
      text: (
        <>
          <p>Axnna uses minimal cookies and local storage mechanisms necessary for the core functionality of the website, such as maintaining secure configuration sessions and remembering your UI preferences.</p>
          <p>We do not use aggressive cross-site tracking or third-party behavioral advertising cookies.</p>
        </>
      )
    }
  };

  const current = content[page || ''];

  if (!current) {
    return <Navigate to="/" />;
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '4rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '3rem' }}>{current.title}</h1>
      <div className="legal-content" style={{ color: 'var(--text-muted)', lineHeight: 1.8 }}>
        {current.text}
      </div>
    </div>
  );
}
