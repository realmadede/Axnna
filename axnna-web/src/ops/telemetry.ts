import type { Env } from '../worker';
import { getMostRecentFxSessionCloseMs, isFxMarketClosedUtc, normalizeUtcIso, parseUtcTimestampMs, toSqliteUtcTimestamp } from '../utils/time';

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'MISCONFIGURED' | 'UNKNOWN';
export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ActorHashPurpose = 'admin_auth' | 'feedback' | 'analytics' | 'security' | 'telegram';

export interface SecurityEventInput {
  eventType: string;
  severity: SecuritySeverity;
  sourceCategory: string;
  actorId?: string | null;
  resource?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ScheduledJobRow {
  id: string;
  job_name: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  error_summary?: string | null;
}

function getMetaChanges(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const meta = (result as { meta?: { changes?: unknown } }).meta;
  return Number(meta?.changes ?? 0);
}

const KNOWN_PLACEHOLDERS = new Set([
  'mock_key',
  'changeme',
  'default',
  'placeholder',
  'dev-fallback',
  'axnna-admin-2026',
  'secret',
  'password',
]);

let ephemeralIsolateSalt: string | null = null;

function getEphemeralIsolateSalt(): string {
  if (!ephemeralIsolateSalt) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    ephemeralIsolateSalt = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return ephemeralIsolateSalt;
}

/** Validates that a runtime secret is configured, non-placeholder, and meets minimum length. */
export function hasRealSecret(val?: string, minLength: number = 1): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (trimmed.length < minLength) return false;
  const lower = trimmed.toLowerCase();
  if (lower.includes('your_') || KNOWN_PLACEHOLDERS.has(lower)) return false;
  return true;
}

/** Extracts client IP trusting Cloudflare headers in staging/production and X-Forwarded-For only locally. */
export function extractClientIp(request: Request, env?: Pick<Env, 'ENVIRONMENT'>): string {
  const cfIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (cfIp) return cfIp;

  const isLocalDev = !env?.ENVIRONMENT || env.ENVIRONMENT === 'development';
  if (isLocalDev) {
    const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
    return 'local';
  }

  return 'edge-unknown';
}

function getActorSigningMaterial(env?: Partial<Env>): string {
  const candidate =
    env?.ACTOR_HASH_SECRET?.trim() ||
    env?.TELEGRAM_WEBHOOK_SECRET?.trim() ||
    env?.TWELVEDATA_API_KEY?.trim();
  if (candidate && candidate.length >= 8) {
    return candidate;
  }
  return getEphemeralIsolateSalt();
}

/** Computes a domain-separated HMAC-SHA256 pseudonymous identifier (never raw IP). */
export async function computeHmacActorHash(
  raw: string,
  purpose: ActorHashPurpose,
  env?: Partial<Env>
): Promise<string> {
  const keyMaterial = getActorSigningMaterial(env);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(`${purpose}:${raw}`)
  );
  return Array.from(new Uint8Array(sig))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function getRequestActorHash(
  request: Request,
  env?: Partial<Env>,
  purpose: ActorHashPurpose = 'security'
): Promise<string> {
  const ip = extractClientIp(request, env);
  return computeHmacActorHash(ip, purpose, env);
}

/** Appends a sanitized security event into `security_events` without throwing. */
export async function recordSecurityEvent(db: D1Database, input: SecurityEventInput): Promise<void> {
  try {
    const details = input.details ? JSON.stringify(input.details).slice(0, 500) : null;
    await db
      .prepare(
        `INSERT INTO security_events (id, event_type, severity, source_category, actor_id, resource, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.eventType.slice(0, 80),
        input.severity,
        input.sourceCategory.slice(0, 40),
        input.actorId ? input.actorId.slice(0, 80) : null,
        input.resource ? input.resource.slice(0, 120) : null,
        details
      )
      .run();
  } catch {
    // Do not block request flow if security_events table is absent in partial test DBs
  }
}

/**
 * Updates `provider_health_state` with a consistent failure/recovery state machine:
 * - 'HEALTHY' resets error_count to 0 and records last_successful_sync.
 * - 'DEGRADED' (transient/partial): 1st error sets DEGRADED, 2+ consecutive errors escalate to FAILED.
 * - 'FAILED' (full outage): immediately marks FAILED and increments error_count.
 */
export async function recordProviderHealth(
  db: D1Database,
  providerName: string,
  serviceType: string,
  outcome: 'HEALTHY' | 'DEGRADED' | 'FAILED'
): Promise<void> {
  try {
    const now = new Date().toISOString();
    if (outcome === 'HEALTHY') {
      await db
        .prepare(
          `INSERT INTO provider_health_state (provider_name, service_type, status, last_successful_sync, error_count, updated_at)
           VALUES (?, ?, 'HEALTHY', ?, 0, CURRENT_TIMESTAMP)
           ON CONFLICT(provider_name) DO UPDATE SET
             service_type = excluded.service_type,
             status = 'HEALTHY',
             last_successful_sync = excluded.last_successful_sync,
             error_count = 0,
             updated_at = CURRENT_TIMESTAMP`
        )
        .bind(providerName, serviceType, now)
        .run();
      return;
    }

    const initialStatus = outcome === 'FAILED' ? 'FAILED' : 'DEGRADED';
    await db
      .prepare(
        `INSERT INTO provider_health_state (provider_name, service_type, status, last_failure, error_count, updated_at)
         VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(provider_name) DO UPDATE SET
           service_type = excluded.service_type,
           status = CASE
                      WHEN ? = 'FAILED' THEN 'FAILED'
                      WHEN provider_health_state.error_count >= 1 THEN 'FAILED'
                      ELSE 'DEGRADED'
                    END,
           last_failure = excluded.last_failure,
           error_count = provider_health_state.error_count + 1,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(providerName, serviceType, initialStatus, now, outcome)
      .run();
  } catch {
    // Do not break synchronization if provider_health_state write fails
  }
}

export async function startJobRun(db: D1Database, jobName: string): Promise<{ id: string; startedAtMs: number }> {
  const id = crypto.randomUUID();
  const startedAtMs = Date.now();
  try {
    await db
      .prepare(
        `INSERT INTO scheduled_job_runs (id, job_name, status, started_at)
         VALUES (?, ?, 'STARTED', ?)`
      )
      .bind(id, jobName, new Date(startedAtMs).toISOString())
      .run();
  } catch {
    // Ignore if table unavailable
  }
  return { id, startedAtMs };
}

export async function finishJobRun(
  db: D1Database,
  id: string,
  startedAtMs: number,
  status: 'SUCCEEDED' | 'DEGRADED' | 'FAILED',
  summary?: string,
  errorMessage?: string
): Promise<void> {
  try {
    const finishedMs = Date.now();
    await db
      .prepare(
        `UPDATE scheduled_job_runs
         SET status = ?, finished_at = ?, duration_ms = ?, summary = ?, error_message = ?
         WHERE id = ?`
      )
      .bind(
        status,
        new Date(finishedMs).toISOString(),
        Math.max(0, finishedMs - startedAtMs),
        summary ? summary.slice(0, 400) : null,
        errorMessage ? errorMessage.slice(0, 400) : null,
        id
      )
      .run();
  } catch {
    // Ignore if table unavailable
  }
}

const SYNC_LOCK_NAME = 'CRON_OR_MANUAL_SYNC';

/** Atomically acquires a named time-bounded D1 lease, reclaiming expired abandoned leases. */
export async function acquireNamedLease(
  db: D1Database,
  lockName: string,
  ownerId: string,
  ttlMs: number = 10 * 60 * 1000
): Promise<{ acquired: boolean; currentOwner?: string; expiresAt?: string }> {
  const nowMs = Date.now();
  const acquiredIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + ttlMs).toISOString();

  try {
    const res = await db
      .prepare(
        `INSERT INTO sync_leases (lock_name, owner_id, acquired_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(lock_name) DO UPDATE SET
           owner_id = excluded.owner_id,
           acquired_at = excluded.acquired_at,
           expires_at = excluded.expires_at
         WHERE sync_leases.expires_at <= excluded.acquired_at`
      )
      .bind(lockName, ownerId, acquiredIso, expiresIso)
      .run();

    const changes = getMetaChanges(res);
    if (changes > 0) {
      return { acquired: true, expiresAt: expiresIso };
    }

    const holder = await db
      .prepare(`SELECT owner_id, expires_at FROM sync_leases WHERE lock_name = ?`)
      .bind(lockName)
      .first() as { owner_id?: string; expires_at?: string } | null;

    return {
      acquired: false,
      currentOwner: holder?.owner_id,
      expiresAt: holder?.expires_at,
    };
  } catch {
    // Fallback allow if sync_leases table is absent in legacy test fixtures
    return { acquired: true };
  }
}

/** Releases a named lease strictly if held by the specified owner token. */
export async function releaseNamedLease(db: D1Database, lockName: string, ownerId: string): Promise<boolean> {
  try {
    const res = await db
      .prepare(`DELETE FROM sync_leases WHERE lock_name = ? AND owner_id = ?`)
      .bind(lockName, ownerId)
      .run();
    return getMetaChanges(res) > 0;
  } catch {
    return false;
  }
}

/** Atomically acquires the CRON/Manual synchronization lease. */
export async function acquireSyncLease(
  db: D1Database,
  ownerId: string,
  ttlMs: number = 10 * 60 * 1000
): Promise<{ acquired: boolean; currentOwner?: string; expiresAt?: string }> {
  return acquireNamedLease(db, SYNC_LOCK_NAME, ownerId, ttlMs);
}

/** Releases the CRON/Manual sync lease strictly if held by the specified owner token. */
export async function releaseSyncLease(db: D1Database, ownerId: string): Promise<boolean> {
  return releaseNamedLease(db, SYNC_LOCK_NAME, ownerId);
}

/** Atomic sliding-window D1 rate-limit check backed by `rate_limit_counters`. */
export async function checkD1RateLimit(
  db: D1Database,
  bucketKey: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; count: number; retryAfterSec: number }> {
  const nowMs = Date.now();
  const nowSql = toSqliteUtcTimestamp(nowMs);
  const cutoffSql = toSqliteUtcTimestamp(nowMs - windowSeconds * 1000);

  try {
    const res = await db
      .prepare(
        `INSERT INTO rate_limit_counters (bucket_key, window_start, count, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(bucket_key) DO UPDATE SET
           window_start = CASE
             WHEN rate_limit_counters.window_start <= ? THEN excluded.window_start
             ELSE rate_limit_counters.window_start
           END,
           count = CASE
             WHEN rate_limit_counters.window_start <= ? THEN 1
             ELSE rate_limit_counters.count + 1
           END,
           updated_at = excluded.updated_at
         WHERE rate_limit_counters.window_start <= ? OR rate_limit_counters.count < ?`
      )
      .bind(bucketKey, nowSql, nowSql, cutoffSql, cutoffSql, cutoffSql, maxRequests)
      .run();

    const changes = getMetaChanges(res);
    const row = await db
      .prepare(`SELECT window_start, count FROM rate_limit_counters WHERE bucket_key = ?`)
      .bind(bucketKey)
      .first() as { window_start?: string; count?: number } | null;

    const currentCount = Number(row?.count ?? 1);
    const startMs = parseUtcTimestampMs(row?.window_start) ?? nowMs;
    const retryAfterSec = Math.max(1, Math.ceil((startMs + windowSeconds * 1000 - nowMs) / 1000));

    return {
      allowed: changes > 0,
      count: currentCount,
      retryAfterSec,
    };
  } catch {
    // Do not break requests if rate_limit_counters table is absent
    return { allowed: true, count: 1, retryAfterSec: windowSeconds };
  }
}

/**
 * Bounded operational data pruning executed daily to prevent unbounded D1 growth
 * while preserving audit_events and recent security evidence.
 */
export async function pruneOperationalTables(
  db: D1Database,
  nowMs: number = Date.now()
): Promise<{ analyticsDeleted: number; jobsDeleted: number; securityDeleted: number; rateLimitsDeleted: number; economicEventsDeleted: number; marketCandlesDeleted: number }> {
  const cutoff90dSql = toSqliteUtcTimestamp(nowMs - 90 * 24 * 60 * 60 * 1000);
  const cutoff90dIso = new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff180dSql = toSqliteUtcTimestamp(nowMs - 180 * 24 * 60 * 60 * 1000);
  const cutoff365dSql = toSqliteUtcTimestamp(nowMs - 365 * 24 * 60 * 60 * 1000);
  const cutoff2dSql = toSqliteUtcTimestamp(nowMs - 2 * 24 * 60 * 60 * 1000);

  const pruneBatch = async (sql: string, ...bindings: string[]): Promise<number> => {
    try {
      const res = await db.prepare(sql).bind(...bindings).run();
      return getMetaChanges(res);
    } catch {
      return 0;
    }
  };

  const [
    analyticsDeleted,
    jobsDeleted,
    securityDeleted,
    rateLimitsDeleted,
    economicEventsDeleted,
    marketCandlesDeleted,
  ] = await Promise.all([
    pruneBatch(
      `DELETE FROM analytics_events WHERE id IN (SELECT id FROM analytics_events WHERE created_at < ? LIMIT 500)`,
      cutoff90dSql
    ),
    pruneBatch(
      `DELETE FROM scheduled_job_runs WHERE id IN (SELECT id FROM scheduled_job_runs WHERE started_at < ? AND status != 'STARTED' LIMIT 500)`,
      cutoff90dIso
    ),
    pruneBatch(
      `DELETE FROM security_events WHERE id IN (SELECT id FROM security_events WHERE (resolution_status = 'RESOLVED' AND created_at < ?) OR created_at < ? LIMIT 500)`,
      cutoff180dSql,
      cutoff365dSql
    ),
    pruneBatch(
      `DELETE FROM rate_limit_counters WHERE bucket_key IN (SELECT bucket_key FROM rate_limit_counters WHERE updated_at < ? LIMIT 500)`,
      cutoff2dSql
    ),
    pruneBatch(
      `DELETE FROM economic_events WHERE id IN (SELECT id FROM economic_events WHERE timestamp < ? LIMIT 500)`,
      cutoff90dIso
    ),
    pruneBatch(
      `DELETE FROM market_candles WHERE id IN (SELECT id FROM market_candles WHERE timestamp < ? LIMIT 500)`,
      cutoff90dIso
    ),
  ]);

  return { analyticsDeleted, jobsDeleted, securityDeleted, rateLimitsDeleted, economicEventsDeleted, marketCandlesDeleted };
}

export function getSecretStatus(env: Env): Array<{ key: string; configured: boolean; scope: string }> {
  return [
    { key: 'TWELVEDATA_API_KEY', configured: hasRealSecret(env.TWELVEDATA_API_KEY), scope: 'Market Data Ingestion' },
    { key: 'TIINGO_API_KEY', configured: hasRealSecret(env.TIINGO_API_KEY), scope: 'Market Data Fallback' },
    { key: 'TELEGRAM_BOT_TOKEN', configured: hasRealSecret(env.TELEGRAM_BOT_TOKEN), scope: 'Telegram Bot API Delivery' },
    { key: 'TELEGRAM_WEBHOOK_SECRET', configured: hasRealSecret(env.TELEGRAM_WEBHOOK_SECRET), scope: 'Telegram Webhook Auth' },
    { key: 'BACKTEST_SECRET', configured: hasRealSecret(env.BACKTEST_SECRET), scope: 'Dev Backtest Endpoint' },
    { key: 'ALLOWED_ORIGINS', configured: Boolean(env.ALLOWED_ORIGINS?.trim()), scope: 'CORS Allowlist' },
  ];
}

export interface SubsystemHealth {
  name: string;
  status: HealthStatus;
  detail: string;
  lastUpdated: string | null;
}

export async function evaluateSystemHealth(env: Env): Promise<{
  overallStatus: HealthStatus;
  subsystems: SubsystemHealth[];
  recentJobs: ScheduledJobRow[];
}> {
  const secretMap = Object.fromEntries(getSecretStatus(env).map((s) => [s.key, s.configured]));
  const nowMs = Date.now();
  const subsystems: SubsystemHealth[] = [];

  // 1. Database health
  let dbHealthy = false;
  try {
    const mig = await env.DB.prepare(
      `SELECT name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 1`
    ).first() as { name?: string; applied_at?: string } | null;
    dbHealthy = true;
    subsystems.push({
      name: 'Database (D1)',
      status: 'HEALTHY',
      detail: `Connected (latest migration: ${mig?.name || 'applied'})`,
      lastUpdated: normalizeUtcIso(mig?.applied_at || null),
    });
  } catch {
    try {
      await env.DB.prepare(`SELECT 1 as ok`).first();
      dbHealthy = true;
      subsystems.push({
        name: 'Database (D1)',
        status: 'HEALTHY',
        detail: 'Connected',
        lastUpdated: null,
      });
    } catch {
      subsystems.push({
        name: 'Database (D1)',
        status: 'UNAVAILABLE',
        detail: 'Unable to query D1 database',
        lastUpdated: null,
      });
    }
  }

  if (!dbHealthy) {
    return { overallStatus: 'UNAVAILABLE', subsystems, recentJobs: [] };
  }

  // Run independent health queries in parallel to keep /status fast
  const [
    marketRes,
    calHealth,
    stratState,
    activeStrat,
    deliveriesRes,
    jobsRes,
    latestRecap,
  ] = await Promise.all([
    env.DB.prepare(`SELECT status, last_successful_fetch, error_count FROM market_data_state`).all(),
    env.DB.prepare(
      `SELECT status, last_successful_sync, last_failure, error_count FROM provider_health_state WHERE service_type = 'ECONOMIC_CALENDAR' LIMIT 1`
    ).first() as Promise<{ status?: string; last_successful_sync?: string | null; last_failure?: string | null; error_count?: number } | null>,
    env.DB.prepare(`SELECT MAX(updated_at) as last_run, COUNT(*) as tracked_pairs FROM strategy_state`).first() as Promise<{ last_run?: string | null; tracked_pairs?: number } | null>,
    env.DB.prepare(`SELECT active_status FROM strategies WHERE strategy_id = 'AXNNA_V1_LIQUIDITY_FVG'`).first() as Promise<{ active_status?: string } | null>,
    env.DB.prepare(
      `SELECT status, COALESCE(delivered_at, last_attempt_at, created_at) as event_ts
       FROM notification_deliveries
       ORDER BY COALESCE(last_attempt_at, created_at) DESC, rowid DESC
       LIMIT 20`
    ).all(),
    env.DB.prepare(
      `SELECT id, job_name, status, started_at, finished_at, duration_ms, summary, error_message
       FROM scheduled_job_runs
       ORDER BY started_at DESC, rowid DESC
       LIMIT 15`
    ).all(),
    env.DB.prepare(
      `SELECT status, started_at, summary FROM scheduled_job_runs WHERE job_name = 'DAILY_RECAP' ORDER BY started_at DESC, rowid DESC LIMIT 1`
    ).first().catch(() => null) as Promise<{ status?: string; started_at?: string; summary?: string } | null>,
  ]);

  // 2. Market data health (normalized UTC comparison + FX weekend awareness)
  const marketRows = (marketRes.results || []) as Array<{ status: string; last_successful_fetch: string | null; error_count: number }>;

  let marketStatus: HealthStatus = 'UNKNOWN';
  let marketDetail = 'No synchronization runs recorded yet';
  let latestMarketFetch: string | null = null;

  if (!secretMap.TWELVEDATA_API_KEY && !secretMap.TIINGO_API_KEY) {
    marketStatus = 'MISCONFIGURED';
    marketDetail = 'No market data provider key configured';
  } else if (marketRows.length > 0) {
    const failed = marketRows.filter((r) => r.status === 'FAILED').length;
    const degraded = marketRows.filter((r) => r.status === 'DEGRADED').length;
    const timestamps = marketRows
      .map((r) => parseUtcTimestampMs(r.last_successful_fetch))
      .filter((t): t is number => t !== null && t > 0);
    const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
    latestMarketFetch = maxTs > 0 ? new Date(maxTs).toISOString() : null;
    const weekendClosedRecent =
      isFxMarketClosedUtc(nowMs) &&
      maxTs >= getMostRecentFxSessionCloseMs(nowMs) - 35 * 60 * 1000;
    const stale = maxTs > 0 && nowMs - maxTs > 35 * 60 * 1000 && !weekendClosedRecent;

    if (failed === marketRows.length) {
      marketStatus = 'UNAVAILABLE';
      marketDetail = `All ${marketRows.length} market feeds failing`;
    } else if (failed > 0 || degraded > 0 || stale) {
      marketStatus = 'DEGRADED';
      marketDetail = stale
        ? 'Market data is stale (>35m since last fetch)'
        : `${failed + degraded}/${marketRows.length} feeds failing/degraded`;
    } else {
      marketStatus = 'HEALTHY';
      marketDetail = `${marketRows.length}/${marketRows.length} feeds healthy`;
    }
  }
  subsystems.push({
    name: 'Market Data (TwelveData + Tiingo)',
    status: marketStatus,
    detail: marketDetail,
    lastUpdated: latestMarketFetch,
  });

  // 3. Economic Calendar health (provider status + 2h staleness check)
  let calStatus: HealthStatus = 'UNKNOWN';
  let calDetail = 'No economic calendar sync recorded yet';
  const calLastSuccessMs = parseUtcTimestampMs(calHealth?.last_successful_sync);
  const calStale = calLastSuccessMs !== null && nowMs - calLastSuccessMs > 2 * 60 * 60 * 1000;

  if (calHealth) {
    if (calHealth.status === 'FAILED') {
      calStatus = 'UNAVAILABLE';
      calDetail = `Calendar sync failing (${calHealth.error_count ?? 1} consecutive errors)`;
    } else if (calHealth.status === 'DEGRADED' || calStale) {
      calStatus = 'DEGRADED';
      calDetail = calStale
        ? 'Economic calendar sync is stale (>2h since last success)'
        : `Calendar sync degraded (${calHealth.error_count ?? 1} errors)`;
    } else {
      calStatus = 'HEALTHY';
      calDetail = 'Keyless economic calendar syncing normally';
    }
  }
  subsystems.push({
    name: 'Economic Calendar',
    status: calStatus,
    detail: calDetail,
    lastUpdated: normalizeUtcIso(calHealth?.last_successful_sync || calHealth?.last_failure || null),
  });

  // 4. Strategy Engine health
  const stratCount = Number(stratState?.tracked_pairs ?? 0);
  subsystems.push({
    name: 'Strategy Engine',
    status: activeStrat?.active_status === 'DISABLED' ? 'DEGRADED' : stratCount > 0 ? 'HEALTHY' : 'UNKNOWN',
    detail:
      activeStrat?.active_status === 'DISABLED'
        ? 'Primary strategy is currently DISABLED by admin'
        : stratCount > 0
          ? `Tracking incremental state for ${stratCount} instrument(s)`
          : 'Awaiting initial candle synchronization',
    lastUpdated: normalizeUtcIso(stratState?.last_run || null),
  });

  // 5. Telegram health evaluated over recent 20 deliveries window
  const recentDeliveries = (deliveriesRes.results || []) as Array<{ status: string; event_ts: string | null }>;

  const recentTotal = recentDeliveries.length;
  const recentSent = recentDeliveries.filter((d) => d.status === 'SENT').length;
  const recentFailures =
    recentDeliveries.filter((d) => ['RETRY_SCHEDULED', 'EXHAUSTED', 'PERMANENT_FAILURE', 'FAILED'].includes(d.status)).length;
  const latestDeliveryTs = recentDeliveries[0]?.event_ts || null;

  let tgStatus: HealthStatus = 'HEALTHY';
  let tgDetail = 'Bot token and webhook secret configured';
  if (!secretMap.TELEGRAM_BOT_TOKEN || !secretMap.TELEGRAM_WEBHOOK_SECRET) {
    tgStatus = 'MISCONFIGURED';
    tgDetail = !secretMap.TELEGRAM_BOT_TOKEN
      ? 'TELEGRAM_BOT_TOKEN is missing'
      : 'TELEGRAM_WEBHOOK_SECRET is missing';
  } else if (recentTotal > 0 && (recentFailures >= 3 || recentFailures > recentSent)) {
    tgStatus = 'DEGRADED';
    tgDetail = `${recentFailures}/${recentTotal} recent deliveries failed or retrying`;
  }
  subsystems.push({
    name: 'Telegram Delivery & Webhook',
    status: tgStatus,
    detail: tgDetail,
    lastUpdated: normalizeUtcIso(latestDeliveryTs),
  });

  // 6. Scheduled jobs health (handles STARTED orphans and stale CRON >35m under */15 schedule)
  const recentJobs = (jobsRes.results || []) as unknown as ScheduledJobRow[];

  let jobStatus: HealthStatus = 'UNKNOWN';
  let jobDetail = 'No scheduled runs recorded yet';
  let lastJobTime: string | null = null;
  if (recentJobs.length > 0) {
    const latest = recentJobs[0];
    const latestStartMs = parseUtcTimestampMs(latest.started_at);
    const latestFinishMs = parseUtcTimestampMs(latest.finished_at);
    lastJobTime = normalizeUtcIso(latest.started_at);

    if (latest.status === 'STARTED') {
      const elapsedMs = latestStartMs !== null ? nowMs - latestStartMs : 0;
      if (elapsedMs > 10 * 60 * 1000) {
        jobStatus = 'DEGRADED';
        jobDetail = `Orphaned ${latest.job_name} stuck in STARTED for >10m`;
      } else {
        jobStatus = 'HEALTHY';
        jobDetail = `${latest.job_name} currently executing`;
      }
    } else if (latest.status === 'FAILED') {
      jobStatus = 'UNAVAILABLE';
      jobDetail = `Latest ${latest.job_name} failed`;
    } else if (latest.status === 'DEGRADED') {
      jobStatus = 'DEGRADED';
      jobDetail = `Latest ${latest.job_name} completed with partial failures`;
    } else if (
      latestFinishMs !== null &&
      nowMs - latestFinishMs > 35 * 60 * 1000 &&
      !isFxMarketClosedUtc(nowMs)
    ) {
      jobStatus = 'DEGRADED';
      jobDetail = `Scheduled sync overdue (>35m since latest ${latest.job_name})`;
    } else {
      jobStatus = 'HEALTHY';
      jobDetail = `Latest ${latest.job_name} succeeded (${latest.duration_ms ?? 0}ms)`;
    }
  }
  subsystems.push({
    name: 'Scheduled Jobs (Cron)',
    status: jobStatus,
    detail: jobDetail,
    lastUpdated: lastJobTime,
  });

  // 7. Daily Recap visibility
  let recapStatus: HealthStatus = 'UNKNOWN';
  let recapDetail = 'No Daily Recap executions recorded yet';
  let recapLastUpdated: string | null = null;
  if (latestRecap) {
    recapLastUpdated = normalizeUtcIso(latestRecap.started_at || null);
    if (latestRecap.status === 'FAILED') {
      recapStatus = 'UNAVAILABLE';
      recapDetail = latestRecap.summary || 'Latest Daily Recap failed';
    } else if (latestRecap.status === 'DEGRADED') {
      recapStatus = 'DEGRADED';
      recapDetail = latestRecap.summary || 'Latest Daily Recap partially failed';
    } else {
      recapStatus = 'HEALTHY';
      recapDetail = latestRecap.summary || 'Latest Daily Recap succeeded';
    }
  }
  subsystems.push({
    name: 'Daily Recap (21:00 UTC)',
    status: recapStatus,
    detail: recapDetail,
    lastUpdated: recapLastUpdated,
  });

  // 8. Notification Retries queue health
  const retryDueCount =
    recentDeliveries.filter((d) => d.status === 'RETRY_SCHEDULED' || d.status === 'EXHAUSTED').length;
  subsystems.push({
    name: 'Notification Retries',
    status: retryDueCount >= 3 ? 'DEGRADED' : recentTotal > 0 ? 'HEALTHY' : 'UNKNOWN',
    detail:
      retryDueCount > 0
        ? `${retryDueCount} recent delivery retry/exhausted item(s)`
        : recentTotal > 0
          ? 'Retry queue clear'
          : 'No delivery attempts recorded yet',
    lastUpdated: normalizeUtcIso(latestDeliveryTs),
  });

  let overallStatus: HealthStatus = 'HEALTHY';
  if (subsystems.some((s) => s.status === 'UNAVAILABLE' || s.status === 'MISCONFIGURED' || s.status === 'DEGRADED')) {
    overallStatus = 'DEGRADED';
  } else if (subsystems.some((s) => s.status === 'UNKNOWN')) {
    overallStatus = 'UNKNOWN';
  }

  return { overallStatus, subsystems, recentJobs };
}
