import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, LogOut, Play, RefreshCw, Search } from 'lucide-react';
import { Button, Glass, Input, SegmentedControl, Switch } from '../components/AdminUi';
import { formatDisplayTime } from '../utils/time';

interface MarketHealthRow {
  instrument: string;
  timeframe: string;
  provider: string;
  last_completed_candle: string | null;
  last_successful_fetch: string | null;
  status: string;
  error_count: number;
}

interface ProviderHealthRow {
  provider_name: string;
  service_type: string;
  status: string;
  last_successful_sync: string | null;
  last_failure: string | null;
  error_count: number;
}

interface StrategyRow {
  id: string;
  strategy_id: string;
  name: string;
  active_status: string;
  description: string | null;
}

interface StrategyStateRow {
  instrument: string;
  strategy_id: string;
  strategy_version: string;
  last_processed_5m_timestamp: string | null;
  updated_at: string;
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
  sent_alerts?: number;
}

interface SignalRow {
  signal_id: string;
  strategy_id: string;
  strategy_version: string;
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
  market_context: string | null;
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
  last_error: string | null;
  last_http_status: number | null;
  next_retry_at: string | null;
}

interface SecurityEventRow {
  id: string;
  event_type: string;
  severity: string;
  source_category: string;
  actor_id: string | null;
  resource: string | null;
  details: string | null;
  resolution_status: string;
  resolved_at: string | null;
  created_at: string;
}

interface ContactSubmissionRow {
  id: string;
  category: string;
  message: string;
  contact_info: string | null;
  status: string;
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

interface SubsystemHealthRow {
  name: string;
  status: string;
  detail: string;
  lastUpdated: string | null;
}

interface JobRunRow {
  id: string;
  job_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary: string | null;
  error_message: string | null;
}

interface RiskDecisionRow {
  id: string;
  signal_id: string;
  instrument: string;
  direction: string;
  strategy_version: string;
  technical_score: number;
  decision: 'APPROVED' | 'REJECTED';
  reason_code: string;
  reason_detail: string | null;
  event_risk: string | null;
  confluence: string | null;
  evaluated_at: string;
}

interface PaperTradeItem {
  id: string;
  signal_id: string;
  instrument: string;
  direction: string;
  strategy_version: string;
  intended_entry: number;
  stop_loss: number;
  target_price: number;
  entry_price: number | null;
  exit_price: number | null;
  risk_amount: number;
  status: string;
  outcome: string | null;
  gross_pnl: number | null;
  estimated_costs: number;
  net_pnl: number | null;
  r_multiple: number | null;
  unrealized_pnl?: number | null;
  unrealized_r?: number | null;
  duration_ms?: number | null;
  signal_timestamp: string;
  entry_timestamp: string | null;
  exit_timestamp: string | null;
}

interface OverviewTotals {
  usersTotal: number;
  connectedUsers: number;
  signalsTotal: number;
  alertEligibleSignals: number;
  alertedSignals: number;
  paperTradesTotal: number;
  riskDecisionsTotal?: number;
  riskApprovedTotal?: number;
  riskRejectedTotal?: number;
  deliveriesTotal: number;
  sentDeliveries: number;
  failedDeliveries: number;
  securityTotal: number;
  openSecurityEvents: number;
  contactTotal: number;
  newContactSubmissions: number;
  auditTotal: number;
}

interface OverviewData {
  environment: string;
  pagination?: {
    page: number;
    pageSize: number;
  };
  totals?: OverviewTotals;
  filteredTotals?: {
    users: number;
    signals: number;
    security: number;
    paperTrades: number;
  };
  systemConfig: {
    globalNotificationsEnabled: boolean;
    secrets: Array<{ key: string; configured: boolean; scope: string }>;
  };
  systemHealth: {
    overallStatus: string;
    subsystems: SubsystemHealthRow[];
    recentJobs: JobRunRow[];
  };
  marketHealth: MarketHealthRow[];
  providerHealth: ProviderHealthRow[];
  economicCalendar: {
    totalEvents: number;
    lastSync: string | null;
  };
  strategies: StrategyRow[];
  strategyStates: StrategyStateRow[];
  users: UserRow[];
  signals: SignalRow[];
  riskDecisions?: RiskDecisionRow[];
  paperTrading: {
    mode?: 'SIMULATION_ONLY';
    summaryScope?: 'ALL_ACCOUNT_TRADES';
    filteredTotal?: number;
    stageStatus?: string;
    account?: {
      id: string;
      name: string;
      starting_balance: number;
      current_balance: number;
      risk_per_trade_percent: number;
      currency: string;
    };
    summary?: {
      startingBalance: number;
      currentBalance: number;
      realizedPnl: number;
      unrealizedPnl: number;
      openPositions: number;
      pendingPositions: number;
      closedPositions: number;
      cancelledOrExpired: number;
      wins: number;
      losses: number;
      winRate: number;
      profitFactor: number | null;
      expectancyPnl: number;
      averageR: number;
      maxDrawdown: number;
      maxDrawdownPercent: number;
    };
    equityCurve?: Array<{ timestamp: string; balance: number; signalId: string }>;
    byInstrument?: Array<{ instrument: string; trades: number; wins: number; losses: number; netPnl: number; totalR: number }>;
    byStrategyVersion?: Array<{ strategyVersion: string; trades: number; wins: number; losses: number; netPnl: number; totalR: number }>;
    trades: PaperTradeItem[];
  };
  deliveries: DeliveryRow[];
  analytics: {
    days: number;
    summary: {
      totalEvents: number;
      uniqueVisitors: number;
      totalVisits: number;
      pageViews: number;
    };
    topPages: Array<{ path: string; views: number }>;
    topReferrers: Array<{ source: string; visits: number }>;
    devices: Array<{ device: string; count: number }>;
    browsers: Array<{ browser: string; count: number }>;
    countries: Array<{ country: string; count: number }>;
    dailyTrends: Array<{ day: string; page_views: number; unique_visitors: number }>;
    funnel: Array<{ event_type: string; count: number }>;
  };
  securityEvents: SecurityEventRow[];
  contactSubmissions: ContactSubmissionRow[];
  auditEvents: AuditRow[];
}

type AdminTab =
  | 'overview'
  | 'users'
  | 'market'
  | 'signals'
  | 'telegram'
  | 'paper'
  | 'analytics'
  | 'security'
  | 'health'
  | 'config'
  | 'audit';

function formatTime(iso: string | null | undefined): string {
  return formatDisplayTime(iso, 'Never');
}

function badgeClass(status: string): string {
  const s = status.toUpperCase();
  if (
    s === 'HEALTHY' ||
    s === 'ACTIVE' ||
    s === 'CONNECTED' ||
    s === 'SENT' ||
    s === 'ALERTED' ||
    s === 'SUCCEEDED' ||
    s === 'RESOLVED' ||
    s === 'CONFIGURED' ||
    s === 'LOW'
  ) {
    return 'admin-badge admin-badge--ok';
  }
  if (s === 'ALERT_ELIGIBLE' || s === 'QUALIFIED' || s === 'ACKNOWLEDGED' || s === 'REVIEWED' || s === 'NEW') {
    return 'admin-badge admin-badge--accent';
  }
  if (s === 'DEGRADED' || s === 'RETRY_SCHEDULED' || s === 'MEDIUM' || s === 'UNKNOWN') {
    return 'admin-badge admin-badge--warn';
  }
  if (
    s === 'FAILED' ||
    s === 'REJECTED' ||
    s === 'DISCONNECTED' ||
    s === 'DISABLED' ||
    s === 'PERMANENT_FAILURE' ||
    s === 'EXHAUSTED' ||
    s === 'UNAVAILABLE' ||
    s === 'MISCONFIGURED' ||
    s === 'HIGH' ||
    s === 'CRITICAL' ||
    s === 'MISSING' ||
    s === 'OPEN'
  ) {
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
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [analyticsDays, setAnalyticsDays] = useState<number>(7);
  const [page, setPage] = useState<number>(1);
  const pageSize = 25;

  // Filters
  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'ALL' | 'CONNECTED' | 'DISCONNECTED'>('ALL');
  const [signalInstrumentFilter, setSignalInstrumentFilter] = useState<string>('ALL');
  const [paperInstrumentFilter, setPaperInstrumentFilter] = useState<string>('ALL');
  const [paperVersionFilter, setPaperVersionFilter] = useState<string>('ALL');
  const [paperStartingBalance, setPaperStartingBalance] = useState<string>('10000');
  const [paperRiskPercent, setPaperRiskPercent] = useState<string>('1.0');
  const [confirmPaperReset, setConfirmPaperReset] = useState<boolean>(false);
  const [securitySeverityFilter, setSecuritySeverityFilter] = useState<string>('ALL');
  const [securityResolutionFilter, setSecurityResolutionFilter] = useState<string>('ALL');

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedUserSearch(userSearch.trim());
    }, 250);
    return () => clearTimeout(handle);
  }, [userSearch]);

  const fetchOverview = useCallback(async (daysOverride?: number, pageOverride?: number) => {
    setLoadingData(true);
    setError(null);
    const days = daysOverride ?? analyticsDays;
    const nextPage = pageOverride ?? page;
    try {
      const params = new URLSearchParams({
        days: String(days),
        page: String(nextPage),
        pageSize: String(pageSize),
        paperInstrument: paperInstrumentFilter,
        paperVersion: paperVersionFilter,
        userSearch: debouncedUserSearch,
        userStatus: userStatusFilter,
        signalInstrument: signalInstrumentFilter,
        securitySeverity: securitySeverityFilter,
        securityResolution: securityResolutionFilter,
      });
      const res = await fetch(`/api/config/overview?${params.toString()}`, {
        credentials: 'same-origin',
      });
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
      if (data.paperTrading?.account) {
        setPaperStartingBalance(String(data.paperTrading.account.starting_balance));
        setPaperRiskPercent(String(data.paperTrading.account.risk_per_trade_percent));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingData(false);
    }
  }, [analyticsDays, page, paperInstrumentFilter, paperVersionFilter, debouncedUserSearch, userStatusFilter, signalInstrumentFilter, securitySeverityFilter, securityResolutionFilter]);

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
    await fetch('/api/auth/config/logout', {
      method: 'POST',
      headers: { 'X-Requested-With': 'AxnnaAdmin' },
      credentials: 'same-origin',
    }).catch(() => {});
    setIsAuthenticated(false);
    setOverview(null);
    setNotice(null);
    setError(null);
    setWarning(null);
    setNotice(null);
  };

  const adminPost = async (path: string, body?: unknown, successMsg?: string, busyId?: string) => {
    if (busyId) setBusyKey(busyId);
    setError(null);
    setWarning(null);
    setNotice(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'AxnnaAdmin' },
        credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      if (successMsg) setNotice(successMsg);
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (busyId) setBusyKey(null);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setError(null);
    setWarning(null);
    setNotice(null);
    try {
      const res = await fetch('/api/config/sync', {
        method: 'POST',
        headers: { 'X-Requested-With': 'AxnnaAdmin' },
        credentials: 'same-origin',
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false || body?.status === 'FAILED') {
        throw new Error(body?.error || `Manual sync failed (${res.status}).`);
      }
      if (body?.status === 'DEGRADED') {
        setWarning(body?.summary ? `Sync completed with partial failures (${body.summary}).` : 'Sync completed with partial failures.');
      } else {
        setNotice(body?.summary ? `Sync succeeded (${body.summary}).` : 'Market, economic calendar, and strategy sync completed.');
      }
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
      await fetchOverview();
    } finally {
      setSyncing(false);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!overview) return [];
    return overview.users.filter((u) => {
      if (userStatusFilter !== 'ALL' && u.status !== userStatusFilter) return false;
      if (!userSearch.trim()) return true;
      const q = userSearch.trim().toLowerCase();
      return (
        u.telegram_user_id.toLowerCase().includes(q) ||
        (u.telegram_username_snapshot || '').toLowerCase().includes(q) ||
        (u.telegram_first_name_snapshot || '').toLowerCase().includes(q)
      );
    });
  }, [overview, userSearch, userStatusFilter]);

  const filteredSignals = useMemo(() => {
    if (!overview) return [];
    return overview.signals.filter((s) =>
      signalInstrumentFilter === 'ALL' ? true : s.instrument === signalInstrumentFilter
    );
  }, [overview, signalInstrumentFilter]);

  const filteredSecurity = useMemo(() => {
    if (!overview) return [];
    return overview.securityEvents.filter((ev) => {
      if (securitySeverityFilter !== 'ALL' && ev.severity !== securitySeverityFilter) return false;
      if (securityResolutionFilter !== 'ALL' && ev.resolution_status !== securityResolutionFilter) return false;
      return true;
    });
  }, [overview, securitySeverityFilter, securityResolutionFilter]);

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
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Operations Console</h1>
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

  const connectedUsers = overview?.totals?.connectedUsers ?? overview?.users.filter((u) => u.status === 'CONNECTED').length ?? 0;
  const totalUsers = overview?.totals?.usersTotal ?? overview?.users.length ?? 0;
  const totalSignals = overview?.totals?.signalsTotal ?? overview?.signals.length ?? 0;
  const alertEligibleCount = overview?.totals?.alertEligibleSignals ?? overview?.signals.filter((s) => s.status === 'ALERT_ELIGIBLE' || s.status === 'ALERTED').length ?? 0;
  const healthyFeeds = overview?.marketHealth.filter((m) => m.status === 'HEALTHY').length ?? 0;
  const totalFeeds = overview?.marketHealth.length ?? 0;
  const sentDeliveries = overview?.totals?.sentDeliveries ?? overview?.deliveries.filter((d) => d.status === 'SENT').length ?? 0;
  const failedDeliveries = overview?.totals?.failedDeliveries ?? overview?.deliveries.filter((d) => d.status !== 'SENT').length ?? 0;
  const openSecurityCount = overview?.totals?.openSecurityEvents ?? overview?.securityEvents.filter((s) => s.resolution_status === 'OPEN').length ?? 0;
  const newInboxCount = overview?.totals?.newContactSubmissions ?? overview?.contactSubmissions.filter((c) => c.status === 'NEW').length ?? 0;

  const renderPagination = (totalCount: number) => {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    if (totalPages <= 1 && page === 1) return null;
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        <span>
          Page {page} of {totalPages} ({totalCount} total records)
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            variant="glass"
            disabled={page <= 1 || loadingData}
            onClick={() => {
              const prev = Math.max(1, page - 1);
              setPage(prev);
              fetchOverview(analyticsDays, prev);
            }}
          >
            Previous
          </Button>
          <Button
            variant="glass"
            disabled={page >= totalPages || loadingData}
            onClick={() => {
              const next = Math.min(totalPages, page + 1);
              setPage(next);
              fetchOverview(analyticsDays, next);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Operations Console</h1>
            {overview && (
              <span className={badgeClass(overview.systemHealth.overallStatus)}>
                {overview.systemHealth.overallStatus}
              </span>
            )}
            {overview && <span className="admin-badge">{overview.environment}</span>}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Real-time operational visibility across market feeds, strategy state, Telegram alerts, analytics, and security.
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
          <Button variant="glass" icon={<RefreshCw size={15} />} onClick={() => fetchOverview()} disabled={loadingData}>
            Refresh
          </Button>
          <Button variant="glass" destructive icon={<LogOut size={15} />} onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </div>

      {error && <div className="admin-alert admin-alert--err">{error}</div>}
      {warning && <div className="admin-alert admin-alert--warn">{warning}</div>}
      {notice && <div className="admin-alert admin-alert--ok">{notice}</div>}

      <div className="admin-kpi-grid">
        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Telegram Connected</span>
          <span className="admin-kpi-value">{connectedUsers}</span>
          <span className="admin-kpi-sub">
            {totalUsers} total | {overview?.analytics.summary.uniqueVisitors ?? 0} unique visitors
          </span>
        </Glass>

        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Signals Generated</span>
          <span className="admin-kpi-value">{totalSignals}</span>
          <span className="admin-kpi-sub">{alertEligibleCount} alert-eligible/alerted</span>
        </Glass>

        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Deliveries</span>
          <span className="admin-kpi-value">{sentDeliveries}</span>
          <span className="admin-kpi-sub">{failedDeliveries} retrying/failed</span>
        </Glass>

        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Market Feeds</span>
          <span className="admin-kpi-value">
            {healthyFeeds}/{totalFeeds}
          </span>
          <span className="admin-kpi-sub">
            Calendar: {overview?.economicCalendar.totalEvents ?? 0} events
          </span>
        </Glass>

        <Glass className="admin-kpi-card">
          <span className="admin-kpi-label">Open Security Events</span>
          <span className="admin-kpi-value">{openSecurityCount}</span>
          <span className="admin-kpi-sub">{newInboxCount} new inbox items</span>
        </Glass>
      </div>

      <div className="admin-tabs-wrap">
        <SegmentedControl
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as AdminTab);
            if (page !== 1) {
              setPage(1);
              fetchOverview(analyticsDays, 1);
            }
          }}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'users', label: `Users (${totalUsers})` },
            { value: 'market', label: 'Market Data' },
            { value: 'signals', label: `Signals (${totalSignals})` },
            { value: 'telegram', label: 'Telegram' },
            { value: 'paper', label: 'Paper Trading' },
            { value: 'analytics', label: 'Analytics' },
            { value: 'security', label: `Security (${openSecurityCount})` },
            { value: 'health', label: 'System Health' },
            { value: 'config', label: 'Config & Inbox' },
            { value: 'audit', label: 'Audit Log' },
          ]}
        />
      </div>

      {activeTab === 'overview' && (
        <div className="admin-subgrid">
          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Operational Subsystems</h2>
            {overview?.systemHealth.subsystems.map((sub) => (
              <div
                key={sub.name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  borderBottom: '1px solid var(--border-color)',
                  paddingBottom: '0.6rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{sub.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{sub.detail}</div>
                </div>
                <span className={badgeClass(sub.status)}>{sub.status}</span>
              </div>
            ))}
          </Glass>

          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Latest Scheduled Jobs</h2>
            {overview?.systemHealth.recentJobs.length ? (
              overview.systemHealth.recentJobs.slice(0, 6).map((job) => (
                <div
                  key={job.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    borderBottom: '1px solid var(--border-color)',
                    paddingBottom: '0.6rem',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{job.job_name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {formatTime(job.started_at)} {job.duration_ms !== null ? `(${job.duration_ms}ms)` : ''}
                    </div>
                  </div>
                  <span className={badgeClass(job.status)}>{job.status}</span>
                </div>
              ))
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No scheduled job executions recorded yet. Click Run Sync Now to run the first pipeline cycle.
              </p>
            )}
          </Glass>
        </div>
      )}

      {activeTab === 'users' && (
        <Glass className="admin-panel">
          <div className="admin-header">
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Telegram Subscribers</h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Axnna uses Telegram-first identity (no separate email/password accounts). Unique web visitors are tracked separately in Analytics.
              </p>
            </div>
            <div className="admin-filter-row">
              <Input
                placeholder="Search user or @handle"
                aria-label="Search users"
                value={userSearch}
                onValueChange={(v) => {
                  setUserSearch(v);
                  setPage(1);
                }}
                icon={<Search size={15} />}
              />
              <select
                className="admin-select"
                aria-label="Filter user status"
                value={userStatusFilter}
                onChange={(e) => {
                  setUserStatusFilter(e.target.value as any);
                  setPage(1);
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="CONNECTED">CONNECTED</option>
                <option value="DISCONNECTED">DISCONNECTED</option>
              </select>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Subscriber</th>
                  <th>Telegram ID</th>
                  <th>Status</th>
                  <th>Alerts Sent</th>
                  <th>Notifications</th>
                  <th>Connected</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length ? (
                  filteredUsers.map((u) => {
                    const label = u.telegram_username_snapshot
                      ? `@${u.telegram_username_snapshot}`
                      : u.telegram_first_name_snapshot || u.telegram_user_id;
                    return (
                      <tr key={u.id}>
                        <td data-label="Subscriber">{label}</td>
                        <td data-label="Telegram ID">{u.telegram_user_id}</td>
                        <td data-label="Status">
                          <span className={badgeClass(u.status)}>{u.status}</span>
                        </td>
                        <td data-label="Alerts Sent">{u.sent_alerts ?? 0}</td>
                        <td data-label="Notifications">
                          <Switch
                            aria-label={`Notifications for ${label}`}
                            checked={u.signal_notifications_enabled === 1}
                            disabled={busyKey === `user-notif-${u.id}`}
                            onCheckedChange={(checked) =>
                              adminPost(
                                `/api/config/users/${encodeURIComponent(u.id)}/toggle`,
                                { notificationsEnabled: checked },
                                `Updated notifications for ${label}.`,
                                `user-notif-${u.id}`
                              )
                            }
                          />
                        </td>
                        <td data-label="Connected">{formatTime(u.connected_at)}</td>
                        <td data-label="Action">
                          <Button
                            variant="glass"
                            destructive={u.status === 'CONNECTED'}
                            disabled={busyKey === `user-status-${u.id}`}
                            onClick={() =>
                              adminPost(
                                `/api/config/users/${encodeURIComponent(u.id)}/toggle`,
                                { status: u.status === 'CONNECTED' ? 'DISCONNECTED' : 'CONNECTED' },
                                `Updated connection status for ${label}.`,
                                `user-status-${u.id}`
                              )
                            }
                          >
                            {u.status === 'CONNECTED' ? 'Disconnect' : 'Reconnect'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                      No Telegram subscribers match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderPagination(overview?.filteredTotals?.users ?? totalUsers)}
        </Glass>
      )}

      {activeTab === 'market' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Provider Health State</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Last Success</th>
                    <th>Last Failure</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.providerHealth.length ? (
                    overview.providerHealth.map((p) => (
                      <tr key={p.provider_name}>
                        <td data-label="Provider">{p.provider_name}</td>
                        <td data-label="Service">{p.service_type}</td>
                        <td data-label="Status">
                          <span className={badgeClass(p.status)}>{p.status}</span>
                        </td>
                        <td data-label="Last Success">{formatTime(p.last_successful_sync)}</td>
                        <td data-label="Last Failure">{formatTime(p.last_failure)}</td>
                        <td data-label="Errors">{p.error_count}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                        No provider health checks recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Glass>

          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Market Data Synchronization (5M & 1H)</h2>
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
        </div>
      )}

      {activeTab === 'signals' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Glass className="admin-panel">
            <div className="admin-header">
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Signals & Strategy Observability (Read-Only)</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Setup Strength Score (0-100) reflects structural alignment, not win probability.
                </p>
              </div>
              <select
                className="admin-select"
                aria-label="Filter signal instrument"
                value={signalInstrumentFilter}
                onChange={(e) => {
                  setSignalInstrumentFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="ALL">All Instruments</option>
                <option value="EURUSD">EURUSD</option>
                <option value="GBPUSD">GBPUSD</option>
                <option value="USDJPY">USDJPY</option>
                <option value="XAUUSD">XAUUSD</option>
              </select>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Direction</th>
                    <th>Status</th>
                    <th>Version</th>
                    <th>Strength Score</th>
                    <th>Entry</th>
                    <th>R:R</th>
                    <th>Reason / Context</th>
                    <th>Generated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignals.length ? (
                    filteredSignals.map((sig) => (
                      <tr key={sig.signal_id}>
                        <td data-label="Instrument">{sig.instrument}</td>
                        <td data-label="Direction">{sig.direction}</td>
                        <td data-label="Status">
                          <span className={badgeClass(sig.status)}>{sig.status}</span>
                        </td>
                        <td data-label="Version">{sig.strategy_version}</td>
                        <td data-label="Strength Score">{sig.technical_score ?? 0}/100</td>
                        <td data-label="Entry">{sig.entry ?? '-'}</td>
                        <td data-label="R:R">{sig.structural_rr !== null ? sig.structural_rr.toFixed(2) : '-'}</td>
                        <td data-label="Reason / Context">{sig.rejection_reason || (sig.market_context ? 'Macro attached' : '-')}</td>
                        <td data-label="Generated">{formatTime(sig.generated_at)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} style={{ color: 'var(--text-muted)' }}>
                        No signals recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {renderPagination(overview?.filteredTotals?.signals ?? totalSignals)}
          </Glass>

          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Persisted Incremental Strategy States</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Strategy</th>
                    <th>Version</th>
                    <th>Last Processed 5M Candle</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.strategyStates.length ? (
                    overview.strategyStates.map((st) => (
                      <tr key={`${st.instrument}-${st.strategy_id}`}>
                        <td data-label="Instrument">{st.instrument}</td>
                        <td data-label="Strategy">{st.strategy_id}</td>
                        <td data-label="Version">{st.strategy_version}</td>
                        <td data-label="Last 5M Candle">{formatTime(st.last_processed_5m_timestamp)}</td>
                        <td data-label="Updated">{formatTime(st.updated_at)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                        No persisted strategy states yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Glass>

          <Glass className="admin-panel">
            <div className="admin-header">
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Risk Gate Decisions</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Approved: {overview?.totals?.riskApprovedTotal ?? 0} | Rejected: {overview?.totals?.riskRejectedTotal ?? 0}
                </p>
              </div>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Signal ID</th>
                    <th>Instrument</th>
                    <th>Decision</th>
                    <th>Reason</th>
                    <th>Event Risk</th>
                    <th>Evaluated</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.riskDecisions?.length ? (
                    overview.riskDecisions.map((rd) => (
                      <tr key={rd.id}>
                        <td data-label="Signal ID">{rd.signal_id}</td>
                        <td data-label="Instrument">{rd.instrument} ({rd.direction})</td>
                        <td data-label="Decision">
                          <span className={badgeClass(rd.decision === 'APPROVED' ? 'HEALTHY' : 'REJECTED')}>{rd.decision}</span>
                        </td>
                        <td data-label="Reason">{rd.reason_code}: {rd.reason_detail || '-'}</td>
                        <td data-label="Event Risk">{rd.event_risk || '-'}</td>
                        <td data-label="Evaluated">{formatTime(rd.evaluated_at)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                        No risk gate evaluations recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Glass>
        </div>
      )}

      {activeTab === 'telegram' && (
        <Glass className="admin-panel">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Telegram Delivery Queue & History</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Signal ID</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Next Retry</th>
                  <th>Last Error</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {overview?.deliveries.length ? (
                  overview.deliveries.map((d) => {
                    const canRetry = (d.status === 'RETRY_SCHEDULED' || d.status === 'FAILED') && d.attempt_count < 5;
                    return (
                      <tr key={d.id}>
                        <td data-label="Signal ID">{d.signal_id}</td>
                        <td data-label="Status">
                          <span className={badgeClass(d.status)}>{d.status}</span>
                        </td>
                        <td data-label="Attempts">{d.attempt_count}/5</td>
                        <td data-label="Next Retry">{d.next_retry_at ? formatTime(d.next_retry_at) : '-'}</td>
                        <td data-label="Last Error">{d.last_error || (d.provider_message_id ? `Msg ${d.provider_message_id}` : '-')}</td>
                        <td data-label="Action">
                          {canRetry ? (
                            <Button
                              variant="glass"
                              disabled={busyKey === `retry-${d.id}`}
                              onClick={() =>
                                adminPost(
                                  `/api/config/deliveries/${encodeURIComponent(d.id)}/retry`,
                                  {},
                                  'Retry attempt executed.',
                                  `retry-${d.id}`
                                )
                              }
                            >
                              Retry Once
                            </Button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Terminal</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
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
          {renderPagination(overview?.totals?.deliveriesTotal ?? overview?.deliveries.length ?? 0)}
        </Glass>
      )}

      {activeTab === 'paper' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Glass className="admin-panel">
            <div className="admin-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Paper Trading Simulation</h2>
                  <span className="admin-badge admin-badge--accent">SIMULATION ONLY (NO REAL MONEY)</span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  Conservative simulation using completed 5M candles only, spread + slippage + commission costs, and stop-first intra-candle tie-breaking.
                  {(paperInstrumentFilter !== 'ALL' || paperVersionFilter !== 'ALL') &&
                    ' Portfolio KPIs & equity curve below reflect all account trades; the trade table is filtered.'}
                </p>
              </div>
              <div className="admin-filter-row">
                <select
                  className="admin-select"
                  aria-label="Filter paper instrument"
                  value={paperInstrumentFilter}
                  onChange={(e) => {
                    setPaperInstrumentFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">All Instruments</option>
                  <option value="EURUSD">EURUSD</option>
                  <option value="GBPUSD">GBPUSD</option>
                  <option value="USDJPY">USDJPY</option>
                  <option value="XAUUSD">XAUUSD</option>
                </select>
                <select
                  className="admin-select"
                  aria-label="Filter paper strategy version"
                  value={paperVersionFilter}
                  onChange={(e) => {
                    setPaperVersionFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">All Versions</option>
                  <option value="technical-v1">technical-v1</option>
                </select>
              </div>
            </div>

            <div className="admin-kpi-grid">
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Virtual Balance</span>
                <span className="admin-kpi-value">
                  ${(overview?.paperTrading.summary?.currentBalance ?? 10000).toFixed(2)}
                </span>
                <span className="admin-kpi-sub">
                  Start: ${(overview?.paperTrading.summary?.startingBalance ?? 10000).toFixed(2)}
                </span>
              </div>
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Realized / Unrealized P&amp;L</span>
                <span className="admin-kpi-value">
                  ${(overview?.paperTrading.summary?.realizedPnl ?? 0).toFixed(2)}
                </span>
                <span className="admin-kpi-sub">
                  Open Floating: ${(overview?.paperTrading.summary?.unrealizedPnl ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Positions (Open / Closed)</span>
                <span className="admin-kpi-value">
                  {overview?.paperTrading.summary?.openPositions ?? 0} / {overview?.paperTrading.summary?.closedPositions ?? 0}
                </span>
                <span className="admin-kpi-sub">
                  Pending: {overview?.paperTrading.summary?.pendingPositions ?? 0} | Exp/Inv: {overview?.paperTrading.summary?.cancelledOrExpired ?? 0}
                </span>
              </div>
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Win Rate &amp; Avg R</span>
                <span className="admin-kpi-value">
                  {(overview?.paperTrading.summary?.winRate ?? 0).toFixed(1)}%
                </span>
                <span className="admin-kpi-sub">
                  W/L: {overview?.paperTrading.summary?.wins ?? 0}/{overview?.paperTrading.summary?.losses ?? 0} | Avg R: {(overview?.paperTrading.summary?.averageR ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Profit Factor &amp; Max DD</span>
                <span className="admin-kpi-value">
                  {overview?.paperTrading.summary?.profitFactor !== null && overview?.paperTrading.summary?.profitFactor !== undefined
                    ? overview.paperTrading.summary.profitFactor.toFixed(2)
                    : '-'}
                </span>
                <span className="admin-kpi-sub">
                  Expectancy: ${(overview?.paperTrading.summary?.expectancyPnl ?? 0).toFixed(2)} | DD: {(overview?.paperTrading.summary?.maxDrawdownPercent ?? 0).toFixed(2)}%
                </span>
              </div>
            </div>
          </Glass>

          <div className="admin-subgrid">
            <Glass className="admin-panel">
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Equity Curve</h3>
              {overview?.paperTrading.equityCurve?.length ? (
                overview.paperTrading.equityCurve.map((pt, idx) => (
                  <div key={`${pt.signalId}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>{formatTime(pt.timestamp)} ({pt.signalId})</span>
                    <strong>${pt.balance.toFixed(2)}</strong>
                  </div>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                  No closed paper trades yet. Equity points appear only from persisted closed trades.
                </p>
              )}
            </Glass>

            <Glass className="admin-panel">
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Performance Attribution</h3>
              {overview?.paperTrading.byInstrument?.length ? (
                <>
                  {overview.paperTrading.byInstrument.map((b) => (
                    <div key={b.instrument} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span>{b.instrument} ({b.wins}W/{b.losses}L)</span>
                      <strong>${b.netPnl.toFixed(2)} ({b.totalR.toFixed(2)}R)</strong>
                    </div>
                  ))}
                  {overview.paperTrading.byStrategyVersion?.map((v) => (
                    <div key={v.strategyVersion} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <span>Version {v.strategyVersion} ({v.trades} closed)</span>
                      <span>${v.netPnl.toFixed(2)}</span>
                    </div>
                  ))}
                </>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                  No instrument or strategy attribution available until trades close.
                </p>
              )}
            </Glass>

            <Glass className="admin-panel">
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Simulation Account Configuration</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <Input
                  type="number"
                  aria-label="Starting virtual balance"
                  placeholder="Starting balance (USD)"
                  value={paperStartingBalance}
                  onValueChange={setPaperStartingBalance}
                />
                <Input
                  type="number"
                  aria-label="Risk per trade percent"
                  placeholder="Risk per trade (%)"
                  value={paperRiskPercent}
                  onValueChange={setPaperRiskPercent}
                />
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Button
                    variant="glass"
                    disabled={busyKey === 'paper-account'}
                    onClick={() =>
                      adminPost(
                        '/api/config/paper/account',
                        {
                          startingBalance: Number(paperStartingBalance),
                          riskPerTradePercent: Number(paperRiskPercent),
                          resetAccount: false,
                        },
                        'Paper account configuration saved.',
                        'paper-account'
                      )
                    }
                  >
                    Save Account Config
                  </Button>
                  {!confirmPaperReset ? (
                    <Button
                      variant="glass"
                      destructive
                      disabled={busyKey === 'paper-account'}
                      onClick={() => setConfirmPaperReset(true)}
                    >
                      Reset Simulation Account
                    </Button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        SIMULATION ONLY: Clears persisted simulated trades for the default account while preserving signals and audit logs.
                      </span>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Button
                          variant="glass"
                          destructive
                          disabled={busyKey === 'paper-account'}
                          onClick={async () => {
                            await adminPost(
                              '/api/config/paper/account',
                              {
                                startingBalance: Number(paperStartingBalance),
                                riskPerTradePercent: Number(paperRiskPercent),
                                resetAccount: true,
                              },
                              'Simulation paper account reset.',
                              'paper-account'
                            );
                            setConfirmPaperReset(false);
                          }}
                        >
                          Confirm Reset
                        </Button>
                        <Button variant="glass" onClick={() => setConfirmPaperReset(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Glass>
          </div>

          <Glass className="admin-panel">
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Persisted Paper Trade History</h3>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Signal ID</th>
                    <th>Instrument</th>
                    <th>Version</th>
                    <th>Direction</th>
                    <th>Status</th>
                    <th>Entry</th>
                    <th>Exit / Target / Stop</th>
                    <th>Net P&amp;L</th>
                    <th>R</th>
                    <th>Duration</th>
                    <th>Entry Time</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.paperTrading.trades.length ? (
                    overview.paperTrading.trades.map((t) => {
                      const durMin = t.duration_ms !== null && t.duration_ms !== undefined ? Math.round(t.duration_ms / 60000) : null;
                      return (
                        <tr key={t.id}>
                          <td data-label="Signal ID">{t.signal_id}</td>
                          <td data-label="Instrument">{t.instrument}</td>
                          <td data-label="Version">{t.strategy_version}</td>
                          <td data-label="Direction">{t.direction}</td>
                          <td data-label="Status">
                            <span className={badgeClass(t.status)}>{t.status}</span>
                          </td>
                          <td data-label="Entry">{t.entry_price ?? t.intended_entry}</td>
                          <td data-label="Exit / Target / Stop">
                            {t.exit_price !== null ? `${t.exit_price}` : `${t.target_price} / ${t.stop_loss}`}
                          </td>
                          <td data-label="Net P&L">
                            {t.net_pnl !== null
                              ? `$${t.net_pnl.toFixed(2)}`
                              : t.unrealized_pnl !== null && t.unrealized_pnl !== undefined
                                ? `$${t.unrealized_pnl.toFixed(2)} (open)`
                                : '-'}
                          </td>
                          <td data-label="R">
                            {t.r_multiple !== null
                              ? `${t.r_multiple.toFixed(2)}R`
                              : t.unrealized_r !== null && t.unrealized_r !== undefined
                                ? `${t.unrealized_r.toFixed(2)}R`
                                : '-'}
                          </td>
                          <td data-label="Duration">{durMin !== null ? `${durMin}m` : '-'}</td>
                          <td data-label="Entry Time">{formatTime(t.entry_timestamp || t.signal_timestamp)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={11} style={{ color: 'var(--text-muted)' }}>
                        No persisted paper trades recorded yet. Risk-approved setups register automatically as PENDING_ENTRY.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {renderPagination(overview?.filteredTotals?.paperTrades ?? overview?.paperTrading.filteredTotal ?? overview?.totals?.paperTradesTotal ?? overview?.paperTrading.trades.length ?? 0)}
          </Glass>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Glass className="admin-panel">
            <div className="admin-header">
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>First-Party Privacy-Safe Analytics</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Anonymous visitor/session counters with zero IP storage or browser fingerprinting.
                </p>
              </div>
              <select
                className="admin-select"
                aria-label="Analytics window"
                value={analyticsDays}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setAnalyticsDays(next);
                  fetchOverview(next);
                }}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>

            <div className="admin-kpi-grid">
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Page Views</span>
                <span className="admin-kpi-value">{overview?.analytics.summary.pageViews ?? 0}</span>
              </div>
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Unique Visitors</span>
                <span className="admin-kpi-value">{overview?.analytics.summary.uniqueVisitors ?? 0}</span>
              </div>
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Sessions</span>
                <span className="admin-kpi-value">{overview?.analytics.summary.totalVisits ?? 0}</span>
              </div>
              <div className="admin-kpi-card" style={{ border: '1px solid var(--border-color)' }}>
                <span className="admin-kpi-label">Total Events</span>
                <span className="admin-kpi-value">{overview?.analytics.summary.totalEvents ?? 0}</span>
              </div>
            </div>
          </Glass>

          <div className="admin-subgrid">
            <Glass className="admin-panel">
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Top Pages</h3>
              {overview?.analytics.topPages.length ? (
                overview.analytics.topPages.map((p) => (
                  <div key={p.path} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                    <span>{p.path}</span>
                    <strong>{p.views}</strong>
                  </div>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No page view events recorded yet.</p>
              )}
            </Glass>

            <Glass className="admin-panel">
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Devices, Browsers & Countries</h3>
              {overview?.analytics.devices.length ? (
                <>
                  {overview.analytics.devices.map((d) => (
                    <div key={d.device} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                      <span>Device: {d.device}</span>
                      <strong>{d.count}</strong>
                    </div>
                  ))}
                  {overview.analytics.browsers.map((b) => (
                    <div key={b.browser} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                      <span>Browser: {b.browser}</span>
                      <strong>{b.count}</strong>
                    </div>
                  ))}
                  {overview.analytics.countries.map((c) => (
                    <div key={c.country} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                      <span>Country: {c.country}</span>
                      <strong>{c.count}</strong>
                    </div>
                  ))}
                </>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No analytics breakdowns recorded yet.</p>
              )}
            </Glass>

            <Glass className="admin-panel">
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Conversion Funnel & Referrers</h3>
              {overview?.analytics.funnel.length ? (
                <>
                  {overview.analytics.funnel.map((f) => (
                    <div key={f.event_type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                      <span>{f.event_type}</span>
                      <strong>{f.count}</strong>
                    </div>
                  ))}
                  {overview.analytics.topReferrers.map((r) => (
                    <div key={r.source} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                      <span>Source: {r.source}</span>
                      <span>{r.visits}</span>
                    </div>
                  ))}
                </>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No funnel events recorded yet.</p>
              )}
            </Glass>

            <Glass className="admin-panel">
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Daily Page View Trends</h3>
              {overview?.analytics.dailyTrends.length ? (
                overview.analytics.dailyTrends.map((t) => (
                  <div key={t.day} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                    <span>{t.day}</span>
                    <strong>{t.page_views} views ({t.unique_visitors} unique)</strong>
                  </div>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No daily trend points recorded yet.</p>
              )}
            </Glass>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <Glass className="admin-panel">
          <div className="admin-header">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Security Events</h2>
            <div className="admin-filter-row">
              <select
                className="admin-select"
                aria-label="Filter severity"
                value={securitySeverityFilter}
                onChange={(e) => {
                  setSecuritySeverityFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>
              <select
                className="admin-select"
                aria-label="Filter resolution"
                value={securityResolutionFilter}
                onChange={(e) => {
                  setSecurityResolutionFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="OPEN">OPEN</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="RESOLVED">RESOLVED</option>
              </select>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Severity</th>
                  <th>Category</th>
                  <th>Resource</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSecurity.length ? (
                  filteredSecurity.map((ev) => (
                    <tr key={ev.id}>
                      <td data-label="Event">{ev.event_type}</td>
                      <td data-label="Severity">
                        <span className={badgeClass(ev.severity)}>{ev.severity}</span>
                      </td>
                      <td data-label="Category">{ev.source_category}</td>
                      <td data-label="Resource">{ev.resource || '-'}</td>
                      <td data-label="Status">
                        <span className={badgeClass(ev.resolution_status)}>{ev.resolution_status}</span>
                      </td>
                      <td data-label="Time">{formatTime(ev.created_at)}</td>
                      <td data-label="Action">
                        {ev.resolution_status !== 'RESOLVED' ? (
                          <Button
                            variant="glass"
                            disabled={busyKey === `sec-${ev.id}`}
                            onClick={() =>
                              adminPost(
                                `/api/config/security/${encodeURIComponent(ev.id)}/resolve`,
                                { resolutionStatus: 'RESOLVED' },
                                'Security event marked RESOLVED.',
                                `sec-${ev.id}`
                              )
                            }
                          >
                            Resolve
                          </Button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Resolved</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                      No security events match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderPagination(overview?.filteredTotals?.security ?? overview?.totals?.securityTotal ?? overview?.securityEvents.length ?? 0)}
        </Glass>
      )}

      {activeTab === 'health' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Subsystem Health Matrix</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Subsystem</th>
                    <th>Status</th>
                    <th>Details</th>
                    <th>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.systemHealth.subsystems.map((sub) => (
                    <tr key={sub.name}>
                      <td data-label="Subsystem">{sub.name}</td>
                      <td data-label="Status">
                        <span className={badgeClass(sub.status)}>{sub.status}</span>
                      </td>
                      <td data-label="Details">{sub.detail}</td>
                      <td data-label="Last Updated">{formatTime(sub.lastUpdated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Glass>

          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Scheduled Job Execution History</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Summary / Error</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.systemHealth.recentJobs.length ? (
                    overview.systemHealth.recentJobs.map((job) => (
                      <tr key={job.id}>
                        <td data-label="Job">{job.job_name}</td>
                        <td data-label="Status">
                          <span className={badgeClass(job.status)}>{job.status}</span>
                        </td>
                        <td data-label="Duration">{job.duration_ms !== null ? `${job.duration_ms}ms` : '-'}</td>
                        <td data-label="Summary / Error">{job.error_message || job.summary || '-'}</td>
                        <td data-label="Started">{formatTime(job.started_at)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                        No scheduled job executions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Glass>
        </div>
      )}

      {activeTab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                onCheckedChange={(checked) =>
                  adminPost(
                    '/api/config/system/notifications',
                    { enabled: checked },
                    `Global Telegram alerts ${checked ? 'enabled' : 'paused'}.`,
                    'global-notifications'
                  )
                }
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
                  onCheckedChange={(checked) =>
                    adminPost(
                      `/api/config/strategies/${encodeURIComponent(strat.strategy_id)}/toggle`,
                      { activeStatus: checked ? 'ACTIVE' : 'DISABLED' },
                      `Strategy ${strat.strategy_id} set to ${checked ? 'ACTIVE' : 'DISABLED'}.`,
                      `strat-${strat.strategy_id}`
                    )
                  }
                />
              </Glass>
            ))}
          </div>

          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Environment & Secret Configuration Status</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Shows presence only. Secret values are never transmitted or rendered.
            </p>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Scope</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.systemConfig.secrets.map((sec) => (
                    <tr key={sec.key}>
                      <td data-label="Variable">{sec.key}</td>
                      <td data-label="Scope">{sec.scope}</td>
                      <td data-label="Status">
                        <span className={badgeClass(sec.configured ? 'CONFIGURED' : 'MISSING')}>
                          {sec.configured ? 'CONFIGURED' : 'MISSING'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Glass>

          <Glass className="admin-panel">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Contact & Feedback Inbox</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Message</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.contactSubmissions.length ? (
                    overview.contactSubmissions.map((sub) => (
                      <tr key={sub.id}>
                        <td data-label="Category">{sub.category}</td>
                        <td data-label="Message">{sub.message}</td>
                        <td data-label="Contact">{sub.contact_info || '-'}</td>
                        <td data-label="Status">
                          <span className={badgeClass(sub.status)}>{sub.status}</span>
                        </td>
                        <td data-label="Submitted">{formatTime(sub.created_at)}</td>
                        <td data-label="Action">
                          {sub.status !== 'RESOLVED' ? (
                            <Button
                              variant="glass"
                              disabled={busyKey === `contact-${sub.id}`}
                              onClick={() =>
                                adminPost(
                                  `/api/config/contact/${encodeURIComponent(sub.id)}/status`,
                                  { status: sub.status === 'NEW' ? 'REVIEWED' : 'RESOLVED' },
                                  'Submission status updated.',
                                  `contact-${sub.id}`
                                )
                              }
                            >
                              {sub.status === 'NEW' ? 'Mark Reviewed' : 'Resolve'}
                            </Button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Resolved</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                        No contact submissions received yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {renderPagination(overview?.totals?.contactTotal ?? overview?.contactSubmissions.length ?? 0)}
          </Glass>
        </div>
      )}

      {activeTab === 'audit' && (
        <Glass className="admin-panel">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Privileged Audit Log</h2>
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
          {renderPagination(overview?.totals?.auditTotal ?? overview?.auditEvents.length ?? 0)}
        </Glass>
      )}
    </div>
  );
}
