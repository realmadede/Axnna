import { useCallback, useEffect, useState } from 'react';
import { Lock, LogOut, RefreshCw, Play } from 'lucide-react';
import { Button, Glass, Input, SegmentedControl, Switch } from 'glisse';

interface MarketHealthRow {
  instrument: string;
  timeframe: string;
  provider: string;
  last_completed_candle: string | null;
  last_successful_fetch: string | null;
  status: string;
  error_count: number;
}

interface StrategyRow {
  id: string;
  strategy_id: string;
  name: string;
  active_status: string;
  description: string | null;
}

interface UserRow {
  id: string;
  telegram_user_id: string;
  telegram_chat_id: string;
  telegram_username_snapshot: string | null;
  telegram_first_name_snapshot: string | null;
  telegram_last_name_snapshot: string | null;
  status: string;
  signal_notifications_enabled: number;
  connected_at: string;
  last_seen_at: string | null;
}

interface SignalRow {
  signal_id: string;
  strategy_id: string;
  instrument: string;
  direction: string;
  generated_at: string;
  entry: number | null;
  structural_stop: number | null;
  structural_target: number | null;
  structural_rr: number | null;
  status: string;
  technical_score: number | null;
  rejection_reason: string | null;
}

interface DeliveryRow {
  id: string;
  signal_id: string;
  axnna_user_id: string;
  destination: string;
  status: string;
  provider_message_id: string | null;
  attempt_count: number;
  delivered_at: string | null;
  created_at: string;
}

interface AuditRow {
  event_id: string;
  event_type: string;
  timestamp: string;
  axnna_user_id: string | null;
  metadata: string | null;
  actor_source: string;
}

interface OverviewData {
  systemConfig: {
    globalNotificationsEnabled: boolean;
  };
  marketHealth: MarketHealthRow[];
  economicCalendar: {
    totalEvents: number;
    lastSync: string | null;
  };
  strategies: StrategyRow[];
  users: UserRow[];
  signals: SignalRow[];
  deliveries: DeliveryRow[];
  auditEvents: AuditRow[];
}

type AdminTab = 'overview' | 'signals' | 'users' | 'deliveries' | 'audit';

function formatTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function badgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === 'HEALTHY' || s === 'ACTIVE' || s === 'CONNECTED' || s === 'SENT' || s === 'ALERTED') {
    return 'admin-badge admin-badge--ok';
  }
  if (s === 'ALERT_ELIGIBLE' || s === 'QUALIFIED') {
    return 'admin-badge admin-badge--accent';
  }
  if (s === 'FAILED' || s === 'REJECTED' || s === 'DISCONNECTED' || s === 'DISABLED') {
    return 'admin-badge admin-badge--err';
  }
  return 'admin-badge';
}

export default function Config() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  const fetchOverview = useCallback(async () => {
    setLoadingData(true);
    setError(null);
    try {
      const res = await fetch('/api/config/overview', { credentials: 'same-origin' });
      if (res.status === 401) {
        setIsAuthenticated(false);
        setOverview(null);
        return;
      }
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to load config overview (${res.status})`);
      }
      const data = (await res.json()) as OverviewData;
      setOverview(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/config', { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data: any) => {
        if (data?.authenticated) {
          setIsAuthenticated(true);
        }
      })
      .catch(() => {})
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchOverview();
    }
  }, [isAuthenticated, fetchOverview]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch('/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ passphrase }),
      });

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Authentication failed.');
      }

      setPassphrase('');
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/config/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setIsAuthenticated(false);
    setOverview(null);
    setNotice(null);
    setError(null);
  };

  const handleGlobalNotifications = async (enabled: boolean) => {
    setBusyKey('global-notifications');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/config/system/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to update global notifications.');
      setNotice(`Global Telegram alerts ${enabled ? 'enabled' : 'paused'}.`);
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  };

  const handleStrategyToggle = async (strategyId: string, enabled: boolean) => {
    setBusyKey(`strat-${strategyId}`);
    setError(null);
    setNotice(null);
    try {
      const activeStatus = enabled ? 'ACTIVE' : 'DISABLED';
      const res = await fetch(`/api/config/strategies/${encodeURIComponent(strategyId)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ activeStatus }),
      });
      if (!res.ok) throw new Error('Failed to update strategy status.');
      setNotice(`Strategy ${strategyId} set to ${activeStatus}.`);
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  };

  const handleUserNotificationToggle = async (userId: string, enabled: boolean) => {
    setBusyKey(`user-notif-${userId}`);
    setError(null);
    try {
      const res = await fetch(`/api/config/users/${encodeURIComponent(userId)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ notificationsEnabled: enabled }),
      });
      if (!res.ok) throw new Error('Failed to update user notification setting.');
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  };

  const handleUserStatusToggle = async (userId: string, currentStatus: string) => {
    setBusyKey(`user-status-${userId}`);
    setError(null);
    try {
      const status = currentStatus === 'CONNECTED' ? 'DISCONNECTED' : 'CONNECTED';
      const res = await fetch(`/api/config/users/${encodeURIComponent(userId)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update user connection status.');
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/config/sync', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) throw new Error('Manual sync failed.');
      setNotice('Market, economic calendar, and strategy sync completed.');
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="admin-login-wrap">
        <p style={{ color: 'var(--text-muted)' }}>Checking session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="admin-login-wrap">
        <Glass className="admin-login-card">
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>System Config</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Restricted administrator access. Enter your configured passphrase to continue.
            </p>
          </div>

          {error && <div className="admin-alert admin-alert--err">{error}</div>}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Input
              type="password"
              placeholder="Admin passphrase"
              aria-label="Admin passphrase"
              value={passphrase}
              onValueChange={setPassphrase}
              icon={<Lock size={16} />}
              disabled={authLoading}
              required
            />
            <Button type="submit" variant="filled" disabled={authLoading || !passphrase}>
              {authLoading ? 'Authenticating...' : 'Authorize'}
            </Button>
          </form>
        </Glass>
      </div>
    );
  }

  const connectedUsers = overview?.users.filter((u) => u.status === 'CONNECTED').length ?? 0;
  const healthyFeeds = overview?.marketHealth.filter((m) => m.status === 'HEALTHY').length ?? 0;
  const totalFeeds = overview?.marketHealth.length ?? 0;
  const sentDeliveries = overview?.deliveries.filter((d) => d.status === 'SENT').length ?? 0;

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' }}>System Config</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Live operational controls, provider health, Telegram subscribers, and signal audit log.
          </p>
        </div>

        <div className="admin-actions">
          <Button
            variant="filled"
            icon={<Play size={15} />}
            onClick={handleManualSync}
            disabled={syncing || loadingData}
          >
            {syncing ? 'Syncing...' : 'Run Sync Now'}
          </Button>
          <Button
            variant="glass"
            icon={<RefreshCw size={15} />}
            onClick={fetchOverview}
            disabled={loadingData}
          >
            Refresh
          </Button>
          <Button variant="glass" destructive icon={<LogOut size={15} />} onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </div>

      {error && <div className="admin-alert admin-alert--err">{error}</div>}
      {notice && <div className="admin-alert admin-alert--ok">{notice}</div>}

      <div className="admin-kpi-grid">
        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Connected Users</span>
          <span className="admin-kpi-value">{connectedUsers}</span>
          <span className="admin-kpi-sub">{overview?.users.length ?? 0} total registered</span>
        </Glass>

        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Market Feeds</span>
          <span className="admin-kpi-value">
            {healthyFeeds}/{totalFeeds}
          </span>
          <span className="admin-kpi-sub">TwelveData 5M & 1H</span>
        </Glass>

        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Economic Events</span>
          <span className="admin-kpi-value">{overview?.economicCalendar.totalEvents ?? 0}</span>
          <span className="admin-kpi-sub">Last sync: {formatTime(overview?.economicCalendar.lastSync)}</span>
        </Glass>

        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Telegram Deliveries</span>
          <span className="admin-kpi-value">{sentDeliveries}</span>
          <span className="admin-kpi-sub">Out of {overview?.deliveries.length ?? 0} recent attempts</span>
        </Glass>
      </div>

      <div className="admin-controls-grid">
        <Glass className="admin-control-row">
          <div>
            <div style={{ fontWeight: 600 }}>Global Signal Alerts</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Master kill-switch for outgoing Telegram messages
            </div>
          </div>
          <Switch
            aria-label="Global Signal Alerts"
            checked={overview?.systemConfig.globalNotificationsEnabled ?? true}
            disabled={busyKey === 'global-notifications' || !overview}
            onCheckedChange={handleGlobalNotifications}
          />
        </Glass>

        {overview?.strategies.map((strat) => (
          <Glass key={strat.strategy_id} className="admin-control-row">
            <div>
              <div style={{ fontWeight: 600 }}>{strat.name}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {strat.strategy_id} ({strat.active_status})
              </div>
            </div>
            <Switch
              aria-label={`Toggle ${strat.name}`}
              checked={strat.active_status === 'ACTIVE'}
              disabled={busyKey === `strat-${strat.strategy_id}`}
              onCheckedChange={(checked) => handleStrategyToggle(strat.strategy_id, checked)}
            />
          </Glass>
        ))}
      </div>

      <div className="admin-tabs-wrap">
        <SegmentedControl
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as AdminTab)}
          items={[
            { value: 'overview', label: 'Feed Health' },
            { value: 'signals', label: `Signals (${overview?.signals.length ?? 0})` },
            { value: 'users', label: `Users (${overview?.users.length ?? 0})` },
            { value: 'deliveries', label: `Deliveries (${overview?.deliveries.length ?? 0})` },
            { value: 'audit', label: 'Audit Log' },
          ]}
        />
      </div>

      {activeTab === 'overview' && (
        <Glass className="admin-panel">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Market Data Feed Health</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Timeframe</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Last Candle</th>
                  <th>Last Fetch</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {overview?.marketHealth.length ? (
                  overview.marketHealth.map((row) => (
                    <tr key={`${row.instrument}-${row.timeframe}`}>
                      <td data-label="Instrument">{row.instrument}</td>
                      <td data-label="Timeframe">{row.timeframe}</td>
                      <td data-label="Provider">{row.provider}</td>
                      <td data-label="Status">
                        <span className={badgeClass(row.status)}>{row.status}</span>
                      </td>
                      <td data-label="Last Candle">{formatTime(row.last_completed_candle)}</td>
                      <td data-label="Last Fetch">{formatTime(row.last_successful_fetch)}</td>
                      <td data-label="Errors">{row.error_count}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                      No market feed records yet. Click Run Sync Now to populate.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Glass>
      )}

      {activeTab === 'signals' && (
        <Glass className="admin-panel">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Recent Candidate & Alerted Signals</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Direction</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Entry</th>
                  <th>R:R</th>
                  <th>Reason</th>
                  <th>Generated</th>
                </tr>
              </thead>
              <tbody>
                {overview?.signals.length ? (
                  overview.signals.map((sig) => (
                    <tr key={sig.signal_id}>
                      <td data-label="Instrument">{sig.instrument}</td>
                      <td data-label="Direction">{sig.direction}</td>
                      <td data-label="Status">
                        <span className={badgeClass(sig.status)}>{sig.status}</span>
                      </td>
                      <td data-label="Score">{sig.technical_score ?? 0}</td>
                      <td data-label="Entry">{sig.entry ?? '-'}</td>
                      <td data-label="R:R">{sig.structural_rr !== null ? sig.structural_rr.toFixed(2) : '-'}</td>
                      <td data-label="Reason">{sig.rejection_reason || '-'}</td>
                      <td data-label="Generated">{formatTime(sig.generated_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} style={{ color: 'var(--text-muted)' }}>
                      No signals recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Glass>
      )}

      {activeTab === 'users' && (
        <Glass className="admin-panel">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Connected Telegram Users</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Notifications</th>
                  <th>Connected</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {overview?.users.length ? (
                  overview.users.map((u) => {
                    const label = u.telegram_username_snapshot
                      ? `@${u.telegram_username_snapshot}`
                      : u.telegram_first_name_snapshot || u.telegram_user_id;
                    return (
                      <tr key={u.id}>
                        <td data-label="User">{label}</td>
                        <td data-label="Status">
                          <span className={badgeClass(u.status)}>{u.status}</span>
                        </td>
                        <td data-label="Notifications">
                          <Switch
                            aria-label={`Notifications for ${label}`}
                            checked={u.signal_notifications_enabled === 1}
                            disabled={busyKey === `user-notif-${u.id}`}
                            onCheckedChange={(checked) => handleUserNotificationToggle(u.id, checked)}
                          />
                        </td>
                        <td data-label="Connected">{formatTime(u.connected_at)}</td>
                        <td data-label="Action">
                          <Button
                            variant="glass"
                            destructive={u.status === 'CONNECTED'}
                            disabled={busyKey === `user-status-${u.id}`}
                            onClick={() => handleUserStatusToggle(u.id, u.status)}
                          >
                            {u.status === 'CONNECTED' ? 'Disconnect' : 'Reconnect'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                      No Telegram users connected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Glass>
      )}

      {activeTab === 'deliveries' && (
        <Glass className="admin-panel">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Telegram Delivery History</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Signal ID</th>
                  <th>Chat ID</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Message ID</th>
                  <th>Delivered</th>
                </tr>
              </thead>
              <tbody>
                {overview?.deliveries.length ? (
                  overview.deliveries.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Signal ID">{d.signal_id}</td>
                      <td data-label="Chat ID">{d.destination}</td>
                      <td data-label="Status">
                        <span className={badgeClass(d.status)}>{d.status}</span>
                      </td>
                      <td data-label="Attempts">{d.attempt_count}</td>
                      <td data-label="Message ID">{d.provider_message_id || '-'}</td>
                      <td data-label="Delivered">{formatTime(d.delivered_at || d.created_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                      No Telegram deliveries logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Glass>
      )}

      {activeTab === 'audit' && (
        <Glass className="admin-panel">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Audit Log</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Source</th>
                  <th>Metadata</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {overview?.auditEvents.length ? (
                  overview.auditEvents.map((ev) => (
                    <tr key={ev.event_id}>
                      <td data-label="Event">{ev.event_type}</td>
                      <td data-label="Source">{ev.actor_source}</td>
                      <td data-label="Metadata">{ev.metadata || '-'}</td>
                      <td data-label="Time">{formatTime(ev.timestamp)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                      No audit events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Glass>
      )}
    </div>
  );
}
