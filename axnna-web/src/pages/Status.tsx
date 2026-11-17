import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { Button, Glass } from '../components/AdminUi';
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
    } catch (err: any) {
      setError(err.message || 'Unable to load system status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', paddingBottom: '4rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="admin-header">
        <div>
          <h1 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Activity size={28} color="var(--accent-color)" /> System Status
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            High-level operational availability for Axnna services and monitored instruments.
          </p>
        </div>
        <Button variant="glass" icon={<RefreshCw size={15} />} onClick={loadStatus} disabled={loading}>
          {loading ? 'Checking...' : 'Refresh'}
        </Button>
      </div>

      {error && <div className="admin-alert admin-alert--err">{error}</div>}

      {data && (
        <>
          <Glass className="admin-panel">
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
          </Glass>

          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Subsystems</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Subsystem</th>
                    <th>Status</th>
                    <th>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subsystems.map((sub) => (
                    <tr key={sub.name}>
                      <td data-label="Subsystem">{sub.name}</td>
                      <td data-label="Status">
                        <span className={statusBadge(sub.status)}>{sub.status}</span>
                      </td>
                      <td data-label="Last Updated">{formatTime(sub.lastUpdated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Glass>
        </>
      )}
    </div>
  );
}
