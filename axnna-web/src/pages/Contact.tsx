import { useState } from 'react';

export default function Contact() {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    
    // Contract: The backend needs an endpoint to handle this payload securely.
    // e.g. POST /api/feedback
    // Currently, we just mock the request delay.
    setTimeout(() => {
      setStatus('error');
    }, 1000);
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', paddingBottom: '4rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '1rem' }}>Contact & Feedback</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '3rem', lineHeight: 1.6 }}>
        Have questions about Axnna's methodology? Experiencing issues with Telegram delivery? Let us know below.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Feedback Type</label>
          <select style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}>
            <option>General Inquiry</option>
            <option>Bug Report</option>
            <option>Feature Request</option>
            <option>Account Assistance</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Message</label>
          <textarea required rows={5} placeholder="How can we help?" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)', resize: 'vertical' }}></textarea>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Optional Contact (Email or Telegram)</label>
          <input type="text" placeholder="@username or email@domain.com" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }} />
        </div>

        {status === 'error' && (
          <div style={{ padding: '1rem', backgroundColor: 'rgba(255,59,48,0.1)', color: 'var(--error-color)', borderRadius: '8px', fontSize: '0.85rem' }}>
            Submission endpoint (/api/feedback) is not yet implemented on the backend. Please try again later.
          </div>
        )}

        <button type="submit" className="button-primary" disabled={status === 'submitting'} style={{ marginTop: '1rem' }}>
          {status === 'submitting' ? 'Sending...' : 'Send Feedback'}
        </button>
      </form>
    </div>
  );
}
