import { useState, useEffect } from 'react';
import { MessageSquare, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface SessionInitResponse {
  token?: string;
}

interface SessionStatusResponse {
  status?: 'WAITING' | 'CONNECTED' | 'EXPIRED';
}

type ConnectionStatus = 'STARTING' | 'WAITING' | 'CONNECTED' | 'EXPIRED' | 'ERROR';

export default function ConnectTelegram() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('STARTING');

  useEffect(() => {
    fetch('/api/telegram/session', { method: 'POST' })
      .then((res) => res.json() as Promise<SessionInitResponse>)
      .then((data) => {
        if (!data.token) {
          setStatus('ERROR');
          return;
        }
        setToken(data.token);
        setStatus('WAITING');
      })
      .catch(() => setStatus('ERROR'));
  }, []);

  useEffect(() => {
    if (status !== 'WAITING' || !token) return;

    const interval = setInterval(() => {
      fetch(`/api/telegram/session/${token}`)
        .then((res) => res.json() as Promise<SessionStatusResponse>)
        .then((data) => {
          if (data.status === 'CONNECTED') {
            setStatus('CONNECTED');
            clearInterval(interval);
          } else if (data.status === 'EXPIRED') {
            setStatus('EXPIRED');
            clearInterval(interval);
          }
        })
        .catch(() => {});
    }, 2000);

    return () => clearInterval(interval);
  }, [token, status]);

  return (
    <div className="container section-padding" style={{ maxWidth: '580px' }}>
      <div className="glass-card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
        <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.25rem)', fontWeight: 700, letterSpacing: '-0.02em' }}>
          Connect Telegram
        </h1>

        {status === 'STARTING' && (
          <p style={{ color: 'var(--text-muted)' }}>Preparing secure connection...</p>
        )}

        {status === 'WAITING' && token && (
          <>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Open the Axnna Telegram bot and press Start to link your account for real-time signal alerts.
            </p>
            <a
              href={`https://t.me/AxnnaSignalsBot?start=${token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="button-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.5rem' }}
            >
              <MessageSquare size={18} />
              Open Telegram App
            </a>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={14} /> Waiting for confirmation...
            </span>
          </>
        )}

        {status === 'CONNECTED' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <CheckCircle2 size={36} color="var(--success-color)" />
            <h2 style={{ fontSize: '1.35rem', fontWeight: 600 }}>Telegram Connected</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Signal notifications and Daily Recaps are now active on your Telegram account.
            </p>
          </div>
        )}

        {status === 'EXPIRED' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <AlertCircle size={32} color="var(--text-muted)" />
            <p style={{ color: 'var(--text-muted)' }}>Connection session expired. Refresh to generate a new link.</p>
            <button type="button" className="button-secondary" onClick={() => window.location.reload()}>
              Try Again
            </button>
          </div>
        )}

        {status === 'ERROR' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <AlertCircle size={32} color="var(--error-color)" />
            <p style={{ color: 'var(--text-muted)' }}>Unable to initialize a Telegram session. Please try again later.</p>
          </div>
        )}
      </div>
    </div>
  );
}
