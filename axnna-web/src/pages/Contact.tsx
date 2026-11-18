import { ExternalLink } from 'lucide-react';

const TELEGRAM_DIRECT_URL = 'https://t.me/mad_ede';

export default function Contact() {
  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', paddingBottom: '4rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '1rem' }}>
        Contact & Feedback
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', lineHeight: 1.6 }}>
        Have questions about Axnna&apos;s methodology or want to share feedback? Reach out directly on Telegram.
      </p>

      <div
        className="axnna-surface"
        style={{
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '1.25rem',
        }}
      >
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Click below to open Telegram and send your message directly.
        </p>

        <a
          href={TELEGRAM_DIRECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="button-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <span>Give Feedback</span>
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  );
}
