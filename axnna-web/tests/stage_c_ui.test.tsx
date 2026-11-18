// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Status from '../src/pages/Status';
import Contact from '../src/pages/Contact';

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

  it('Contact page renders only a Give Feedback button linking to Telegram without exposing username text', () => {
    render(<Contact />);
    const link = screen.getByRole('link', { name: /give feedback/i });
    expect(link.getAttribute('href')).toBe('https://t.me/mad_ede');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText(/mad_ede/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send Feedback' })).toBeNull();
  });
});
