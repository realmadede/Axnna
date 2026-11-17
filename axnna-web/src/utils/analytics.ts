export type ClientAnalyticsEventType = 'PAGE_VIEW' | 'TELEGRAM_CONNECT_STARTED';

function getOrCreateId(storage: Storage | undefined, key: string): string {
  try {
    const existing = storage?.getItem(key);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const generated = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    storage?.setItem(key, generated);
    return generated;
  } catch {
    return `${Date.now()}-anon`;
  }
}

export function trackAnalyticsEvent(eventType: ClientAnalyticsEventType, pathname: string): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;

  const visitorId = getOrCreateId(window.localStorage, 'axnna_vid');
  const sessionId = getOrCreateId(window.sessionStorage, 'axnna_sid');
  const cleanPath = (pathname || '/').split('?')[0].split('#')[0] || '/';

  let utmSource: string | undefined;
  try {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get('utm_source')?.trim();
    if (candidate && /^[A-Za-z0-9._-]{1,60}$/.test(candidate)) {
      utmSource = candidate;
    }
  } catch {
    utmSource = undefined;
  }

  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      eventType,
      path: cleanPath,
      referrer: document.referrer || undefined,
      utmSource,
      visitorId,
      sessionId,
    }),
  }).catch(() => {});
}
