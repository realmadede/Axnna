import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { formatDisplayTime, parseUtcTimestampMs } from '../utils/time';

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

function statusDotColor(status: string): string {
  if (status === 'OPERATIONAL' || status === 'HEALTHY') return 'var(--success-color)';
  if (status === 'DEGRADED' || status === 'UNAVAILABLE') return 'var(--error-color)';
  return 'var(--text-muted)';
}

function formatRelativeAge(iso: string | null): string | null {
  const ms = parseUtcTimestampMs(iso);
  if (ms === null) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function formatTime(iso: string | null): string {
  const base = formatDisplayTime(iso, 'Pending initial check');
  const age = formatRelativeAge(iso);
  return age ? `${age} • ${base}` : base;
}

function formatSubsystemStatus(sub: PublicSubsystem): string {
  if (sub.name === 'Notification Retries' && sub.status === 'UNKNOWN') {
    return 'IDLE (0 QUEUED)';
  }
  return sub.status;
}

function resolveDisplayOverallStatus(data: PublicStatusPayload): {
  label: 'OPERATIONAL' | 'DEGRADED' | 'INITIALIZING';
  note: string | null;
} {
  if (data.overallStatus === 'INITIALIZING') {
    const hasProblem = data.subsystems.some((s) => s.status === 'DEGRADED' || s.status === 'UNAVAILABLE');
    const hasHealthyCore = data.subsystems.some((s) => s.status === 'HEALTHY');
    const allUnknownAreNonCritical = data.subsystems
      .filter((s) => s.status === 'UNKNOWN')
      .every((s) => s.name === 'Notification Retries');
    if (!hasProblem && hasHealthyCore && allUnknownAreNonCritical) {
      return { label: 'OPERATIONAL', note: 'All active pipelines healthy (notification retry queue idle)' };
    }
  }
  return { label: data.overallStatus, note: null };
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

  const resolvedOverall = data ? resolveDisplayOverallStatus(data) : null;

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', paddingBottom: '3rem', minHeight: '520px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="admin-header">
        <div>
          <h1 style={{ fontSize: 'clamp(1.65rem, 3.6vw, 2.15rem)', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Activity size={22} color="var(--accent-color)" /> System Status
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            Operational availability for Axnna services and monitored instruments.
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

      {data && resolvedOverall && (
        <>
          <div className="axnna-surface status-card">
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <div>
                <div className="admin-kpi-label">Overall Status</div>
                <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {resolvedOverall.label}
                </div>
                {resolvedOverall.note && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {resolvedOverall.note}
                  </div>
                )}
              </div>
              <span className={statusBadge(resolvedOverall.label)}>{resolvedOverall.label}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              <span>Monitored instruments: <strong className="mono" style={{ color: 'var(--text-color)' }}>{data.monitoredInstruments.join(', ')}</strong></span>
              <span className="mono">Checked: {formatTime(data.checkedAt)}</span>
            </div>
          </div>

          <div className="axnna-surface status-card">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Subsystems</h2>
            <div className="status-list">
              {data.subsystems.map((sub) => (
                <div key={sub.name} className="status-row">
                  <div className="status-row-name">
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: statusDotColor(sub.status),
                        flexShrink: 0,
                      }}
                    />
                    <span>{sub.name}</span>
                  </div>
                  <div className="status-row-meta">
                    <span className={statusBadge(sub.status)}>{formatSubsystemStatus(sub)}</span>
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
