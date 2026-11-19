import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Clock, Copy, LogOut, MessageSquare } from 'lucide-react';

const SESSION_STORAGE_KEY = 'axnna_tg_session_token';

interface SessionInitResponse {
  token?: string;
}

interface SessionStatusResponse {
  status?: 'PENDING' | 'CONNECTED' | 'EXPIRED' | 'DISCONNECTED' | 'NOT_FOUND';
}

type ConnectionStatus =
  | 'CHECKING'
  | 'WAITING'
  | 'CONNECTED'
  | 'ALREADY_CONNECTED'
  | 'DISCONNECTED'
  | 'EXPIRED'
  | 'RATE_LIMITED'
  | 'ERROR';

export default function ConnectTelegram() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('CHECKING');
  const [copied, setCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const createNewSession = useCallback(() => {
    setStatus('CHECKING');
    fetch('/api/telegram/session', { method: 'POST' })
      .then(async (res) => {
        if (res.status === 429) {
          setStatus('RATE_LIMITED');
          return;
        }
        const data = (await res.json()) as SessionInitResponse;
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
    const savedToken = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!savedToken) {
      createNewSession();
      return;
    }

    fetch(`/api/telegram/session/${savedToken}`)
      .then((res) => (res.ok ? (res.json() as Promise<SessionStatusResponse>) : { status: 'NOT_FOUND' as const }))
      .then((data) => {
        if (data.status === 'CONNECTED') {
          setToken(savedToken);
          setStatus('ALREADY_CONNECTED');
          return;
        }
        localStorage.removeItem(SESSION_STORAGE_KEY);
        createNewSession();
      })
      .catch(() => createNewSession());
  }, [createNewSession]);

  useEffect(() => {
    if (status !== 'WAITING' || !token) return;

    const interval = setInterval(() => {
      fetch(`/api/telegram/session/${token}`)
        .then((res) => res.json() as Promise<SessionStatusResponse>)
        .then((data) => {
          if (data.status === 'CONNECTED') {
            localStorage.setItem(SESSION_STORAGE_KEY, token);
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

  const handleDisconnect = async () => {
    const activeToken = token || localStorage.getItem(SESSION_STORAGE_KEY);
    setDisconnecting(true);
    try {
      if (activeToken) {
        await fetch('/api/telegram/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: activeToken }),
        });
      }
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setToken(null);
      setStatus('DISCONNECTED');
    } catch {
      setStatus('ERROR');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="container section-padding" style={{ maxWidth: '620px' }}>
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
        <div style={{ textAlign: 'center' }}>
          <span className="admin-kpi-label">Telegram Linking</span>
          <h1 style={{ fontSize: 'clamp(1.65rem, 3.8vw, 2.2rem)', fontWeight: 700, letterSpacing: '-0.02em', marginTop: '0.3rem' }}>
            Connect Telegram
          </h1>
        </div>

        {status === 'WAITING' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.7rem', fontSize: '0.82rem' }}>
            <div style={{ padding: '0.7rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
              <div className="mono" style={{ color: 'var(--accent-color)', fontWeight: 600 }}>01 OPEN BOT</div>
              <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>Launch @AxnnaSignalsBot</div>
            </div>
            <div style={{ padding: '0.7rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
              <div className="mono" style={{ color: 'var(--accent-color)', fontWeight: 600 }}>02 TAP START</div>
              <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>Verify one-time token</div>
            </div>
            <div style={{ padding: '0.7rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
              <div className="mono" style={{ color: 'var(--accent-color)', fontWeight: 600 }}>03 RECEIVE ALERTS</div>
              <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>Real-time setups + /status</div>
            </div>
          </div>
        )}

        {status === 'CHECKING' && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Checking Telegram connection status...</p>
        )}

        {status === 'WAITING' && token && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.95rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.55, fontSize: '0.94rem' }}>
              Click below to open Telegram and press Start, or copy the verification command directly into the bot chat.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.7rem' }}>
              <a
                href={`https://t.me/AxnnaSignalsBot?start=${token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="button-primary"
              >
                <MessageSquare size={17} />
                Open Telegram App
              </a>
              <button type="button" className="button-secondary" onClick={copyCommand}>
                {copied ? <Check size={16} color="var(--success-color)" /> : <Copy size={16} />}
                <span>{copied ? 'Copied command' : 'Copy /start command'}</span>
              </button>
            </div>
            <span className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={14} /> Waiting for Telegram confirmation...
            </span>
          </div>
        )}

        {(status === 'CONNECTED' || status === 'ALREADY_CONNECTED') && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem', textAlign: 'center' }}>
            <CheckCircle2 size={34} color="var(--success-color)" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
              {status === 'ALREADY_CONNECTED' ? 'Already Connected' : 'Telegram Connected'}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.94rem', lineHeight: 1.55 }}>
              Signal notifications and Daily Recaps are active on your Telegram account. You can also use{' '}
              <span className="mono">/status</span>, <span className="mono">/recap</span>, or{' '}
              <span className="mono">/disconnect</span> directly inside the bot.
            </p>
            <button
              type="button"
              className="button-secondary"
              disabled={disconnecting}
              onClick={handleDisconnect}
              style={{ marginTop: '0.35rem' }}
            >
              <LogOut size={16} />
              <span>{disconnecting ? 'Disconnecting...' : 'Disconnect Telegram'}</span>
            </button>
          </div>
        )}

        {status === 'DISCONNECTED' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.9rem', textAlign: 'center' }}>
            <AlertCircle size={30} color="var(--text-muted)" />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Telegram Disconnected</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.94rem' }}>
              Signal alerts and Daily Recaps have been stopped for your account.
            </p>
            <button type="button" className="button-primary" onClick={createNewSession}>
              Connect Again
            </button>
          </div>
        )}

        {status === 'EXPIRED' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.9rem', textAlign: 'center' }}>
            <AlertCircle size={30} color="var(--text-muted)" />
            <p style={{ color: 'var(--text-muted)' }}>Connection session expired. Generate a fresh link to continue.</p>
            <button type="button" className="button-secondary" onClick={createNewSession}>
              Try Again
            </button>
          </div>
        )}

        {status === 'RATE_LIMITED' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.9rem', textAlign: 'center' }}>
            <AlertCircle size={30} color="var(--warn-color)" />
            <p style={{ color: 'var(--text-muted)' }}>Too many connection attempts. Please wait a bit before trying again.</p>
          </div>
        )}

        {status === 'ERROR' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.9rem', textAlign: 'center' }}>
            <AlertCircle size={30} color="var(--error-color)" />
            <p style={{ color: 'var(--text-muted)' }}>Unable to update your Telegram connection. Please try again.</p>
            <button type="button" className="button-secondary" onClick={createNewSession}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
