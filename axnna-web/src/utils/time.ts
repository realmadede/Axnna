const SQLITE_UTC_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
const ISO_NO_TZ_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const HAS_TZ_OR_OFFSET_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parses ISO-8601 strings (with Z or explicit offset) and SQLite UTC
 * `CURRENT_TIMESTAMP` strings (`YYYY-MM-DD HH:MM:SS`) into UTC epoch ms.
 * Returns null for null, undefined, or invalid date values.
 */
export function parseUtcTimestampMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  let normalized = trimmed;
  if (SQLITE_UTC_PATTERN.test(trimmed)) {
    normalized = trimmed.replace(' ', 'T') + 'Z';
  } else if (ISO_NO_TZ_PATTERN.test(trimmed) && !HAS_TZ_OR_OFFSET_PATTERN.test(trimmed)) {
    normalized = trimmed + 'Z';
  } else if (!trimmed.includes('T') && !SQLITE_UTC_PATTERN.test(trimmed) && !HAS_TZ_OR_OFFSET_PATTERN.test(trimmed)) {
    return null;
  }

  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Normalizes any valid SQLite UTC or ISO timestamp to canonical UTC ISO-8601 (`...Z`).
 */
export function normalizeUtcIso(value: string | null | undefined): string | null {
  const ms = parseUtcTimestampMs(value);
  if (ms === null) return null;
  return new Date(ms).toISOString();
}

/**
 * Formats an API or SQLite UTC timestamp safely in the viewer's locale without
 * misinterpreting timezone-less SQLite UTC strings as local time.
 */
export function formatDisplayTime(value: string | null | undefined, emptyLabel: string = 'Never'): string {
  if (!value) return emptyLabel;
  const ms = parseUtcTimestampMs(value);
  if (ms === null) return String(value);
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats an epoch timestamp (ms) into SQLite `YYYY-MM-DD HH:MM:SS` UTC format
 * for consistent comparison with `CURRENT_TIMESTAMP` columns.
 */
export function toSqliteUtcTimestamp(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Standard FX / XAUUSD weekly market schedule in UTC:
 * Closed from Friday 22:00 UTC until Sunday 22:00 UTC.
 */
export function isFxMarketClosedUtc(utcMs: number = Date.now()): boolean {
  const d = new Date(utcMs);
  const day = d.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
  const hour = d.getUTCHours();
  if (day === 6) return true;
  if (day === 5 && hour >= 22) return true;
  if (day === 0 && hour < 22) return true;
  return false;
}

/**
 * Returns the most recent Friday 22:00 UTC session close epoch ms at or before `utcMs`.
 */
export function getMostRecentFxSessionCloseMs(utcMs: number = Date.now()): number {
  const d = new Date(utcMs);
  const day = d.getUTCDay();
  const daysSinceFriday = (day + 2) % 7;
  const friday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceFriday, 22, 0, 0, 0));
  if (friday.getTime() > utcMs) {
    friday.setUTCDate(friday.getUTCDate() - 7);
  }
  return friday.getTime();
}
