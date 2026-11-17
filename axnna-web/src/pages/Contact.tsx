import { ExternalLink, MessageCircle } from 'lucide-react';

const TELEGRAM_DIRECT_URL = 'https://t.me/mad_ede';

export default function Contact() {
  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', paddingBottom: '4rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '1rem' }}>
        Contact & Feedback
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', lineHeight: 1.6 }}>
        Have questions about Axnna&apos;s methodology or need help with Telegram alerts? Reach out directly on Telegram.
      </p>

      <div
        className="axnna-surface"
        style={{
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <MessageCircle size={22} color="var(--accent-color)" />
          <div>
            <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>Direct Telegram Support</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>t.me/mad_ede</div>
          </div>
        </div>

        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Send feedback, bug reports, or account inquiries directly via Telegram for the fastest response.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
          <a
            href={TELEGRAM_DIRECT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="button-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <span>Message @mad_ede on Telegram</span>
            <ExternalLink size={16} />
          </a>
          <a
            href={TELEGRAM_DIRECT_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.9rem', color: 'var(--accent-color)', textDecoration: 'underline' }}
          >
            t.me/mad_ede
          </a>
        </div>
      </div>
    </div>
  );
}
