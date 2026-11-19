// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Status from '../src/pages/Status';
import Contact from '../src/pages/Contact';
import FAQ from '../src/pages/FAQ';
import Strategies from '../src/pages/Strategies';

describe('Stage C Interactive UI Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Status page shows stable skeleton while loading, transitions to operational data, and handles HTTP errors', async () => {
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

    const { container } = render(<Status />);
    expect(screen.getByText('Checking...')).toBeTruthy();
    expect(container.querySelector('.status-skeleton-card')).toBeTruthy();

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

  it('Status page maps idle Notification Retries to OPERATIONAL when all core systems are healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            overallStatus: 'INITIALIZING',
            checkedAt: '2026-11-19T00:36:02.000Z',
            monitoredInstruments: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'],
            subsystems: [
              { name: 'Market Data (TwelveData + Tiingo)', status: 'HEALTHY', lastUpdated: '2026-11-19T00:30:18.000Z' },
              { name: 'Notification Retries', status: 'UNKNOWN', lastUpdated: null },
            ],
          }),
          { status: 200 }
        )
      )
    );

    render(<Status />);
    await waitFor(() => {
      expect(screen.getAllByText('OPERATIONAL').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('IDLE (0 QUEUED)')).toBeTruthy();
  });

  it('FAQ renders accessible collapsible accordions', () => {
    render(<FAQ />);
    const firstTrigger = screen.getByRole('button', { name: /What is Axnna\?/i });
    const secondTrigger = screen.getByRole('button', { name: /How does Axnna work\?/i });
    expect(firstTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(secondTrigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(secondTrigger);
    expect(firstTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(secondTrigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('Contact page renders only a Give Feedback button linking to Telegram without exposing username text', () => {
    render(<Contact />);
    const link = screen.getByRole('link', { name: /give feedback/i });
    expect(link.getAttribute('href')).toBe('https://t.me/mad_ede');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText(/mad_ede/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send Feedback' })).toBeNull();
  });

  it('Strategies page renders SetupDiagram SVG and live forward performance breakdown from /api/performance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            mode: 'FORWARD_PAPER_SIMULATION',
            generatedAt: '2026-11-19T01:00:00.000Z',
            summary: {
              totalTrackedSetups: 3,
              openTrades: 1,
              pendingTrades: 0,
              closedTrades: 2,
              expiredOrCancelled: 0,
              wins: 1,
              losses: 1,
              winRate: 50,
              totalR: 0.9,
              averageR: 0.45,
            },
            byInstrument: [
              { instrument: 'EURUSD', closedTrades: 1, wins: 1, losses: 0, winRate: 100, totalR: 1.9, averageR: 1.9 },
            ],
            byScoreBand: [
              { band: '75-84', closedTrades: 1, wins: 1, losses: 0, winRate: 100, averageR: 1.9 },
            ],
          }),
          { status: 200 }
        )
      )
    );

    render(<Strategies />);
    expect(screen.getByRole('img', { name: /liquidity sweep/i })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('50%')).toBeTruthy();
    });
    expect(screen.getByText('+0.9R')).toBeTruthy();
    expect(screen.getByText('Score 75-84')).toBeTruthy();
  });
});
