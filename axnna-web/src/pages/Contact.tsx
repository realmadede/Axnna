import { useState } from 'react';

const CATEGORIES = ['General Inquiry', 'Bug Report', 'Feature Request', 'Account Assistance'] as const;

export default function Contact() {
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [feedbackText, setFeedbackText] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setFeedbackText(null);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message,
          contact: contact.trim() || undefined,
          website: website || undefined,
        }),
      });

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Submission failed (HTTP ${res.status})`);
      }

      setStatus('success');
      setFeedbackText(data?.message || 'Your message has been saved and queued for review.');
      setMessage('');
      setContact('');
    } catch (err: any) {
      setStatus('error');
      setFeedbackText(err.message || 'Unable to submit feedback right now.');
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', paddingBottom: '4rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '1rem' }}>Contact & Feedback</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '3rem', lineHeight: 1.6 }}>
        Have questions about Axnna's methodology? Experiencing issues with Telegram delivery? Let us know below.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <label htmlFor="contact-category" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
            Feedback Type
          </label>
          <select
            id="contact-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="contact-message" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
            Message
          </label>
          <textarea
            id="contact-message"
            required
            minLength={10}
            maxLength={2000}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="How can we help? (10-2000 characters)"
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)', resize: 'vertical' }}
          />
        </div>

        <div>
          <label htmlFor="contact-info" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
            Optional Contact (Email or Telegram)
          </label>
          <input
            id="contact-info"
            type="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="@username or email@domain.com"
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
          />
        </div>

        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
        />

        {status === 'success' && feedbackText && (
          <div className="admin-alert admin-alert--ok">{feedbackText}</div>
        )}

        {status === 'error' && feedbackText && (
          <div className="admin-alert admin-alert--err">{feedbackText}</div>
        )}

        <button type="submit" className="button-primary" disabled={status === 'submitting'} style={{ marginTop: '1rem' }}>
          {status === 'submitting' ? 'Sending...' : 'Send Feedback'}
        </button>
      </form>
    </div>
  );
}
