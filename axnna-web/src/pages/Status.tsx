import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { formatDisplayTime } from '../utils/time';

interface PublicSubsystem {
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
  lastUpdated: string | null;
}

interface PublicStatusPayload {
  overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'INITIALIZING';
  checkedAt: string;
  monitoredInstruments: string[];
  subsystems: PublicSubsystem[];
}

function statusBadge(status: string): string {
  if (status === 'OPERATIONAL' || status === 'HEALTHY') return 'admin-badge admin-badge--ok';
  if (status === 'DEGRADED' || status === 'UNAVAILABLE') return 'admin-badge admin-badge--err';
  return 'admin-badge';
}

function formatTime(iso: string | null): string {
  return formatDisplayTime(iso, 'Pending initial check');
}

export default function Status() {
  const [data, setData] = useState<PublicStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`Status check returned HTTP ${res.status}`);
      const json = (await res.json()) as PublicStatusPayload;
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load system status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', paddingBottom: '4rem', minHeight: '620px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="admin-header">
        <div>
          <h1 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Activity size={28} color="var(--accent-color)" /> System Status
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            High-level operational availability for Axnna services and monitored instruments.
          </p>
        </div>
        <button
          type="button"
          className="status-refresh-btn"
          onClick={loadStatus}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'status-spin' : undefined} />
          <span>{loading ? 'Checking...' : 'Refresh'}</span>
        </button>
      </div>

      {error && <div className="admin-alert admin-alert--err">{error}</div>}

      {!data && !error && (
        <>
          <div className="axnna-surface status-card status-skeleton-card" aria-hidden="true">
            <div className="status-skeleton-line" style={{ width: '140px', height: '14px' }} />
            <div className="status-skeleton-line" style={{ width: '210px', height: '24px' }} />
            <div className="status-skeleton-line" style={{ width: '320px', height: '13px' }} />
          </div>
          <div className="axnna-surface status-card status-skeleton-card" aria-hidden="true">
            <div className="status-skeleton-line" style={{ width: '120px', height: '18px' }} />
            <div className="status-skeleton-list">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="status-skeleton-row">
                  <div className="status-skeleton-line" style={{ width: '42%', height: '14px' }} />
                  <div className="status-skeleton-line" style={{ width: '82px', height: '22px', borderRadius: '9999px' }} />
                  <div className="status-skeleton-line" style={{ width: '28%', height: '14px' }} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {data && (
        <>
          <div className="axnna-surface status-card">
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <div>
                <div className="admin-kpi-label">Overall Status</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem' }}>{data.overallStatus}</div>
              </div>
              <span className={statusBadge(data.overallStatus)}>{data.overallStatus}</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Monitored instruments: {data.monitoredInstruments.join(', ')} | Checked: {formatTime(data.checkedAt)}
            </div>
          </div>

          <div className="axnna-surface status-card">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Subsystems</h2>
            <div className="status-list">
              {data.subsystems.map((sub) => (
                <div key={sub.name} className="status-row">
                  <div className="status-row-name">{sub.name}</div>
                  <div className="status-row-meta">
                    <span className={statusBadge(sub.status)}>{sub.status}</span>
                    <span className="status-row-time">{formatTime(sub.lastUpdated)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
