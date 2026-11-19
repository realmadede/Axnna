import { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Clock, Copy, MessageSquare } from 'lucide-react';

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
  const [copied, setCopied] = useState(false);

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

  const startCommand = token ? `/start ${token}` : '';

  const copyCommand = async () => {
    if (!startCommand || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(startCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in non-secure context
    }
  };

  return (
    <div className="container section-padding" style={{ maxWidth: '620px' }}>
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ textAlign: 'center' }}>
          <span className="admin-kpi-label">Telegram Linking</span>
          <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.25rem)', fontWeight: 700, letterSpacing: '-0.02em', marginTop: '0.35rem' }}>
            Connect Telegram
          </h1>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', fontSize: '0.82rem' }}>
          <div style={{ padding: '0.75rem', borderRadius: '10px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
            <div className="mono" style={{ color: 'var(--accent-color)', fontWeight: 600 }}>01 OPEN BOT</div>
            <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>Launch @AxnnaSignalsBot</div>
          </div>
          <div style={{ padding: '0.75rem', borderRadius: '10px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
            <div className="mono" style={{ color: 'var(--accent-color)', fontWeight: 600 }}>02 TAP START</div>
            <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>Verify one-time token</div>
          </div>
          <div style={{ padding: '0.75rem', borderRadius: '10px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
            <div className="mono" style={{ color: 'var(--accent-color)', fontWeight: 600 }}>03 RECEIVE ALERTS</div>
            <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>Real-time setups + /status</div>
          </div>
        </div>

        {status === 'STARTING' && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Preparing secure connection...</p>
        )}

        {status === 'WAITING' && token && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Click below to open Telegram and press Start, or copy the verification command directly into the bot chat.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.75rem' }}>
              <a
                href={`https://t.me/AxnnaSignalsBot?start=${token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="button-primary"
              >
                <MessageSquare size={18} />
                Open Telegram App
              </a>
              <button type="button" className="button-secondary" onClick={copyCommand}>
                {copied ? <Check size={16} color="var(--success-color)" /> : <Copy size={16} />}
                <span>{copied ? 'Copied command' : 'Copy /start command'}</span>
              </button>
            </div>
            <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={14} /> Waiting for Telegram confirmation...
            </span>
          </div>
        )}

        {status === 'CONNECTED' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', textAlign: 'center' }}>
            <CheckCircle2 size={36} color="var(--success-color)" />
            <h2 style={{ fontSize: '1.35rem', fontWeight: 600 }}>Telegram Connected</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Signal notifications and Daily Recaps are now active on your Telegram account.
            </p>
          </div>
        )}

        {status === 'EXPIRED' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center' }}>
            <AlertCircle size={32} color="var(--text-muted)" />
            <p style={{ color: 'var(--text-muted)' }}>Connection session expired. Refresh to generate a new link.</p>
            <button type="button" className="button-secondary" onClick={() => window.location.reload()}>
              Try Again
            </button>
          </div>
        )}

        {status === 'ERROR' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center' }}>
            <AlertCircle size={32} color="var(--error-color)" />
            <p style={{ color: 'var(--text-muted)' }}>Unable to initialize a Telegram session. Please try again later.</p>
          </div>
        )}
      </div>
    </div>
  );
}
