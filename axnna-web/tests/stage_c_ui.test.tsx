// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Status from '../src/pages/Status';
import Contact from '../src/pages/Contact';
import Config from '../src/pages/Config';

const mockOverviewPayload = {
  environment: 'staging',
  pagination: { page: 1, pageSize: 25 },
  totals: {
    usersTotal: 12,
    connectedUsers: 9,
    signalsTotal: 64,
    alertEligibleSignals: 7,
    alertedSignals: 5,
    paperTradesTotal: 2,
    deliveriesTotal: 18,
    sentDeliveries: 16,
    failedDeliveries: 2,
    securityTotal: 4,
    openSecurityEvents: 1,
    contactTotal: 3,
    newContactSubmissions: 1,
    auditTotal: 20,
  },
  filteredTotals: {
    users: 12,
    signals: 64,
    security: 4,
    paperTrades: 2,
  },
  systemConfig: {
    globalNotificationsEnabled: true,
    secrets: [{ key: 'TWELVEDATA_API_KEY', configured: true, scope: 'Market Data Ingestion' }],
  },
  systemHealth: {
    overallStatus: 'HEALTHY',
    subsystems: [
      { name: 'Database (D1)', status: 'HEALTHY', detail: 'Connected', lastUpdated: '2026-11-17T10:00:00.000Z' },
      { name: 'Market Data (TwelveData)', status: 'HEALTHY', detail: '8/8 feeds healthy', lastUpdated: '2026-11-17T10:05:00.000Z' },
    ],
    recentJobs: [
      { id: 'job_1', job_name: 'CRON_SYNC', status: 'SUCCEEDED', started_at: '2026-11-17T10:05:00.000Z', finished_at: '2026-11-17T10:05:02.000Z', duration_ms: 2000, summary: 'Synced cleanly', error_message: null },
    ],
  },
  marketHealth: [
    { instrument: 'EURUSD', timeframe: '5M', provider: 'twelvedata', last_completed_candle: '2026-11-17T10:00:00.000Z', last_successful_fetch: '2026-11-17 10:05:00', status: 'HEALTHY', error_count: 0 },
  ],
  providerHealth: [
    { provider_name: 'twelvedata', service_type: 'MARKET_DATA', status: 'HEALTHY', last_successful_sync: '2026-11-17T10:05:00.000Z', last_failure: null, error_count: 0 },
  ],
  economicCalendar: { totalEvents: 14, lastSync: '2026-11-17 10:05:00' },
  strategies: [{ id: 's1', strategy_id: 'AXNNA_V1_LIQUIDITY_FVG', name: 'Liquidity Sweep + FVG', active_status: 'ACTIVE', description: 'Primary V1' }],
  strategyStates: [{ instrument: 'EURUSD', strategy_id: 'AXNNA_V1_LIQUIDITY_FVG', strategy_version: 'technical-v1', last_processed_5m_timestamp: '2026-11-17T10:00:00.000Z', updated_at: '2026-11-17 10:05:00' }],
  users: [
    { id: 'u_1', telegram_user_id: '55501', telegram_chat_id: '55501', telegram_username_snapshot: 'alpha_trader', telegram_first_name_snapshot: 'Alpha', telegram_last_name_snapshot: null, status: 'CONNECTED', signal_notifications_enabled: 1, connected_at: '2026-11-17T08:00:00.000Z', last_seen_at: null, sent_alerts: 3 },
  ],
  signals: [
    { signal_id: 'sig_1', strategy_id: 'AXNNA_V1_LIQUIDITY_FVG', strategy_version: 'technical-v1', instrument: 'EURUSD', direction: 'LONG', generated_at: '2026-11-17T09:55:00.000Z', entry: 1.1, structural_stop: 1.095, structural_target: 1.11, structural_rr: 2.0, status: 'ALERTED', technical_score: 82, rejection_reason: null, market_context: '{"macroRegime":"NEUTRAL"}' },
  ],
  riskDecisions: [
    { id: 'rd_1', signal_id: 'sig_1', instrument: 'EURUSD', direction: 'LONG', strategy_version: 'technical-v1', technical_score: 82, decision: 'APPROVED', reason_code: 'RISK_APPROVED', reason_detail: 'Passed all checks', event_risk: 'LOW', confluence: 'NEUTRAL', evaluated_at: '2026-11-17 09:55:00' },
  ],
  paperTrading: {
    mode: 'SIMULATION_ONLY',
    account: { id: 'default', name: 'Axnna Simulation Account', starting_balance: 10000, current_balance: 10185.5, risk_per_trade_percent: 1.0, currency: 'USD' },
    summary: {
      startingBalance: 10000,
      currentBalance: 10185.5,
      realizedPnl: 185.5,
      unrealizedPnl: 0,
      openPositions: 0,
      pendingPositions: 0,
      closedPositions: 1,
      cancelledOrExpired: 0,
      wins: 1,
      losses: 0,
      winRate: 100,
      profitFactor: null,
      expectancyPnl: 185.5,
      averageR: 1.855,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
    },
    equityCurve: [{ timestamp: '2026-11-17T10:25:00.000Z', balance: 10185.5, signalId: 'sig_1' }],
    byInstrument: [{ instrument: 'EURUSD', trades: 1, wins: 1, losses: 0, netPnl: 185.5, totalR: 1.855 }],
    byStrategyVersion: [{ strategyVersion: 'technical-v1', trades: 1, wins: 1, losses: 0, netPnl: 185.5, totalR: 1.855 }],
    trades: [
      { id: 'paper_sig_1', signal_id: 'sig_1', instrument: 'EURUSD', direction: 'LONG', strategy_version: 'technical-v1', intended_entry: 1.1, stop_loss: 1.095, target_price: 1.11, entry_price: 1.10005, exit_price: 1.11, risk_amount: 100, status: 'TARGET_HIT', outcome: 'WIN', gross_pnl: 199, estimated_costs: 13.5, net_pnl: 185.5, r_multiple: 1.855, duration_ms: 1500000, signal_timestamp: '2026-11-17T09:55:00.000Z', entry_timestamp: '2026-11-17T10:00:00.000Z', exit_timestamp: '2026-11-17T10:25:00.000Z' },
    ],
  },
  deliveries: [
    { id: 'del_fail', signal_id: 'sig_1', axnna_user_id: 'u_1', destination: '55501', status: 'FAILED', provider_message_id: null, attempt_count: 2, delivered_at: null, created_at: '2026-11-17 09:56:00', last_error: 'HTTP 502', last_http_status: 502, next_retry_at: null },
  ],
  analytics: {
    days: 7,
    summary: { totalEvents: 40, uniqueVisitors: 11, totalVisits: 15, pageViews: 32 },
    topPages: [{ path: '/', views: 20 }],
    topReferrers: [{ source: 'Direct', visits: 12 }],
    devices: [{ device: 'desktop', count: 25 }],
    browsers: [{ browser: 'Chrome', count: 25 }],
    countries: [{ country: 'KE', count: 20 }],
    dailyTrends: [{ day: '2026-11-17', page_views: 32, unique_visitors: 11 }],
    funnel: [{ event_type: 'PAGE_VIEW', count: 32 }],
  },
  securityEvents: [
    { id: 'sec_open_1', event_type: 'ADMIN_LOGIN_FAILED', severity: 'HIGH', source_category: 'ADMIN_AUTH', actor_id: 'abc123', resource: '/api/auth/config', details: null, resolution_status: 'OPEN', resolved_at: null, created_at: '2026-11-17 09:00:00' },
  ],
  contactSubmissions: [
    { id: 'cnt_1', category: 'Bug Report', message: 'Chart tooltip offset on Safari.', contact_info: 'user@example.com', status: 'NEW', created_at: '2026-11-17 09:10:00' },
  ],
  auditEvents: [
    { event_id: 'aud_1', event_type: 'ADMIN_LOGIN_SUCCESS', timestamp: '2026-11-17 09:20:00', axnna_user_id: null, metadata: '{}', actor_source: 'ADMIN_CONFIG' },
  ],
};

describe('Stage C Interactive UI & Admin Console Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Status page transitions from loading to operational data and handles HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            overallStatus: 'OPERATIONAL',
            checkedAt: '2026-11-17T10:00:00.000Z',
            monitoredInstruments: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'],
            subsystems: [{ name: 'Database (D1)', status: 'HEALTHY', lastUpdated: '2026-11-17 10:00:00' }],
          }),
          { status: 200 }
        )
      )
    );

    render(<Status />);
    expect(screen.getByText('Checking...')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByText('OPERATIONAL').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Database (D1)')).toBeTruthy();
    expect(screen.getByText(/EURUSD, GBPUSD, USDJPY, XAUUSD/)).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 })));
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => {
      expect(screen.getByText(/HTTP 503/)).toBeTruthy();
    });
  });

  it('Contact form submits feedback to /api/feedback and displays success or error feedback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: 'c_1', message: 'Saved cleanly.' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Too many submissions.' }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<Contact />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Testing feedback form submission path.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback' }));

    await waitFor(() => {
      expect(screen.getByText('Saved cleanly.')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Second submission expecting 429 error.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback' }));
    await waitFor(() => {
      expect(screen.getByText('Too many submissions.')).toBeTruthy();
    });
  });

  it('Config Admin console handles login, true SQL totals KPIs, all key tabs, sync warnings/failures, retries, and resolution', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr === '/api/auth/config' && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ authenticated: false, configured: true }), { status: 200 });
      }
      if (urlStr === '/api/auth/config' && init?.method === 'POST') {
        return new Response(JSON.stringify({ authenticated: true }), { status: 200 });
      }
      if (urlStr.startsWith('/api/config/overview')) {
        if (urlStr.includes('paperInstrument=USDJPY')) {
          return new Response(
            JSON.stringify({
              ...mockOverviewPayload,
              filteredTotals: { ...mockOverviewPayload.filteredTotals, paperTrades: 0 },
              paperTrading: {
                ...mockOverviewPayload.paperTrading,
                filteredTotal: 0,
                trades: [],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify(mockOverviewPayload), { status: 200 });
      }
      if (urlStr === '/api/config/sync') {
        return new Response(
          JSON.stringify({ ok: true, status: 'DEGRADED', summary: 'Calendar events: 2; market feed failures: 1/8' }),
          { status: 200 }
        );
      }
      if (urlStr.includes('/retry')) {
        return new Response(JSON.stringify({ ok: true, status: 'SENT' }), { status: 200 });
      }
      if (urlStr.includes('/resolve')) {
        return new Response(JSON.stringify({ ok: true, resolutionStatus: 'RESOLVED' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Config />);

    await waitFor(() => {
      expect(screen.getByLabelText('Admin passphrase')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Admin passphrase'), { target: { value: 'admin-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));

    // Verifies true totals (64 signals, 9 connected users) rather than array length
    await waitFor(() => {
      expect(screen.getByText('64')).toBeTruthy();
    });
    expect(screen.getByText('9')).toBeTruthy();

    // DEGRADED sync surfaces warning alert, not green success
    fireEvent.click(screen.getByRole('button', { name: 'Run Sync Now' }));
    await waitFor(() => {
      expect(screen.getByText(/partial failures/i)).toBeTruthy();
    });

    // Signals tab displays strategy_version column
    fireEvent.click(screen.getAllByText('Signals (64)')[0]);
    await waitFor(() => {
      expect(screen.getAllByText('technical-v1').length).toBeGreaterThan(0);
    });

    // Telegram tab enables Retry Once for FAILED deliveries (<5 attempts)
    fireEvent.click(screen.getAllByText('Telegram')[0]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry Once' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry Once' }));
    await waitFor(() => {
      expect(screen.getByText('Retry attempt executed.')).toBeTruthy();
    });

    // Analytics tab renders Daily Page View Trends
    fireEvent.click(screen.getAllByText('Analytics')[0]);
    await waitFor(() => {
      expect(screen.getByText('Daily Page View Trends')).toBeTruthy();
      expect(screen.getByText('32 views (11 unique)')).toBeTruthy();
    });

    // Security tab renders OPEN events and resolves
    fireEvent.click(screen.getAllByText('Security (1)')[0]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => {
      expect(screen.getByText('Security event marked RESOLVED.')).toBeTruthy();
    });

    // Config & Inbox tab renders feedback and hides secrets
    fireEvent.click(screen.getAllByText('Config & Inbox')[0]);
    await waitFor(() => {
      expect(screen.getByText('TWELVEDATA_API_KEY')).toBeTruthy();
      expect(screen.getByText('Chart tooltip offset on Safari.')).toBeTruthy();
    });

    // Signals tab also displays Risk Gate Decisions
    fireEvent.click(screen.getAllByText('Signals (64)')[0]);
    await waitFor(() => {
      expect(screen.getByText('Risk Gate Decisions')).toBeTruthy();
      expect(screen.getByText(/RISK_APPROVED/)).toBeTruthy();
    });

    // Paper Trading tab renders real simulation metrics, equity curve, account config save, filter state, and Reset confirmation
    fireEvent.click(screen.getAllByText('Paper Trading')[0]);
    await waitFor(() => {
      expect(screen.getByText('SIMULATION ONLY (NO REAL MONEY)')).toBeTruthy();
      expect(screen.getAllByText('$10185.50').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Account Config' }));
    await waitFor(() => {
      expect(screen.getByText('Paper account configuration saved.')).toBeTruthy();
    });

    // Instrument filter shows global-vs-table clarification label
    fireEvent.change(screen.getByLabelText('Filter paper instrument'), { target: { value: 'USDJPY' } });
    await waitFor(() => {
      expect(screen.getByText(/Portfolio KPIs & equity curve below reflect all account trades/)).toBeTruthy();
      expect(screen.getByText(/No persisted paper trades recorded yet/)).toBeTruthy();
    });

    // Guarded Reset Simulation Account: cancel then confirm
    fireEvent.click(screen.getByRole('button', { name: 'Reset Simulation Account' }));
    expect(screen.getByText(/SIMULATION ONLY: Clears persisted simulated trades/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm Reset' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Simulation Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reset' }));
    await waitFor(() => {
      expect(screen.getByText('Simulation paper account reset.')).toBeTruthy();
    });
  });
});
