import { useState, useEffect } from 'react';

export default function ConnectTelegram() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('STARTING');

  useEffect(() => {
    // 1. Request a connection token from the Worker
    fetch('/api/telegram/session', { method: 'POST' })
      .then(res => res.json())
      .then((data: any) => {
        setToken(data.token);
        setStatus('WAITING');
      })
      .catch(() => setStatus('ERROR'));
  }, []);

  useEffect(() => {
    if (status !== 'WAITING' || !token) return;

    // 2. Poll for connection status
    const interval = setInterval(() => {
      fetch(`/api/telegram/session/${token}`)
        .then(res => res.json())
        .then((data: any) => {
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
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h1>Connect Telegram</h1>
      
      {status === 'STARTING' && <p>Preparing secure connection...</p>}
      
      {status === 'WAITING' && token && (
        <>
          <p>Waiting for Telegram...</p>
          <a 
            href={`https://t.me/AxnnaBot?start=${token}`} 
            target="_blank" 
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '1rem 2rem',
              backgroundColor: '#0088cc',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              marginTop: '1rem'
            }}
          >
            Open Telegram App
          </a>
        </>
      )}

      {status === 'CONNECTED' && (
        <div>
          <h2>Telegram Connected ✓</h2>
          <p>You are now an Axnna User. Signal notifications are active.</p>
        </div>
      )}

      {status === 'EXPIRED' && (
        <div>
          <p>Connection expired. Please refresh to try again.</p>
        </div>
      )}

      {status === 'ERROR' && (
        <div>
          <p>An error occurred. Please try again later.</p>
        </div>
      )}
    </div>
  );
}
