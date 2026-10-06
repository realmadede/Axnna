import { useState } from 'react';

export default function Config() {
  const [isAuthenticated, ] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contract: 
  // In a production environment, the backend MUST expose an authentication endpoint (e.g., /api/auth/config)
  // and a protected data endpoint (e.g., /api/config/users).
  // The frontend relies on secure HttpOnly cookies or JWTs to authenticate this view.
  // We do not simulate fake authentication here as per requirements.

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // Future Integration:
      // const res = await fetch('/api/auth/config', { method: 'POST', body: ... })
      // if (!res.ok) throw new Error('Unauthorized');
      
      // For now, fail gracefully as the backend endpoint does not exist yet
      throw new Error('Config Authentication Endpoint (/api/auth/config) not yet implemented on backend.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: '400px', margin: '4rem auto', backgroundColor: 'var(--card-bg)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', fontWeight: 600 }}>System Config</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Restricted access. Requires administrator authorization.
        </p>
        
        {error && (
          <div style={{ padding: '1rem', backgroundColor: 'rgba(255,59,48,0.1)', color: 'var(--error-color)', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input type="password" placeholder="Passphrase" style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.5)', color: 'white' }} />
          <button type="submit" className="button-primary" disabled={loading}>
            {loading ? 'Authenticating...' : 'Authorize'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h1>Config Overview</h1>
      {/* Will display real users once backend is implemented */}
    </div>
  );
}
