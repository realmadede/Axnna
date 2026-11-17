import type { Env } from '../worker';
import { readJsonBodyWithLimit } from '../worker';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  extractSessionCookie,
  SessionPayload,
  verifyPassphrase,
  verifySessionToken,
} from './auth';
import {
  evaluateSystemHealth,
  getRequestActorHash,
  getSecretStatus,
  hasRealSecret,
  recordSecurityEvent,
} from '../ops/telemetry';
import { getPaperPortfolioOverview } from '../engine/PaperTradingEngine';
import { parseUtcTimestampMs, toSqliteUtcTimestamp } from '../utils/time';

const MAX_LOGIN_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface SyncActionResult {
  status: 'SUCCEEDED' | 'DEGRADED' | 'FAILED' | 'ALREADY_RUNNING';
  summary?: string;
  error?: string;
}

function isConfiguredAdminAuth(env: Env): boolean {
  return hasRealSecret(env.ADMIN_PASSPHRASE, 8) && hasRealSecret(env.ADMIN_SESSION_SECRET, 32);
}

export function isAllowedAdminOrigin(request: Request, url: URL, env: Env): boolean {
  const originHeader = request.headers.get('Origin');
  const refererHeader = request.headers.get('Referer');

  let candidateOrigin: string | null = originHeader;
  if (!candidateOrigin && refererHeader) {
    try {
      candidateOrigin = new URL(refererHeader).origin;
    } catch {
      return false;
    }
  }

  if (!candidateOrigin) return true;
  if (candidateOrigin === url.origin) return true;

  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (configured.includes(candidateOrigin)) return true;

  const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (isLocalHost && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(candidateOrigin)) {
    return true;
  }

  return false;
}

async function getSessionVersion(env: Env): Promise<string> {
  try {
    const row = await env.DB.prepare(
      `SELECT value FROM system_config WHERE "key" = 'admin_session_version'`
    ).first();
    if (row && typeof row.value === 'string' && row.value.length > 0) {
      return row.value;
    }
  } catch {
    // Fallback to default version
  }
  return '1';
}

async function isNonceRevoked(env: Env, nonce: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT nonce FROM revoked_admin_sessions WHERE nonce = ?`
    ).bind(nonce).first();
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function authenticateAdminRequest(
  request: Request,
  env: Env
): Promise<{ authenticated: boolean; payload?: SessionPayload }> {
  if (!isConfiguredAdminAuth(env)) return { authenticated: false };
  const token = extractSessionCookie(request);
  if (!token) return { authenticated: false };

  const currentVersion = await getSessionVersion(env);
  const verified = await verifySessionToken(token, env.ADMIN_SESSION_SECRET!, currentVersion);
  if (!verified.valid || !verified.payload) return { authenticated: false };

  if (await isNonceRevoked(env, verified.payload.nonce)) {
    return { authenticated: false };
  }
  return { authenticated: true, payload: verified.payload };
}

async function recordAudit(env: Env, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_events (event_id, event_type, metadata, actor_source) VALUES (?, ?, ?, 'ADMIN_CONFIG')`
    ).bind(crypto.randomUUID(), eventType, metadata ? JSON.stringify(metadata) : null).run();
  } catch {
    // Do not fail admin actions if audit insert fails
  }
}

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string>,
  extra?: Record<string, string>
): Response {
  return Response.json(body, {
    status,
    headers: { ...headers, ...extra },
  });
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/** Handles `/api/auth/config*` and `/api/config/*` admin endpoints. Returns null if path does not match. */
export async function handleAdminRoutes(
  request: Request,
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>,
  actions: {
    runSync: () => Promise<SyncActionResult>;
    retrySingleDelivery: (deliveryId: string) => Promise<{ ok: boolean; status: string; error?: string }>;
  }
): Promise<Response | null> {
  const isHttps = url.protocol === 'https:';

  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const auth = await authenticateAdminRequest(request, env);
    return jsonResponse(
      { authenticated: auth.authenticated, configured: isConfiguredAdminAuth(env) },
      200,
      corsHeaders
    );
  }

  if (url.pathname === '/api/auth/config' && request.method === 'POST') {
    const actorHash = await getRequestActorHash(request, env, 'admin_auth');
    if (!isAllowedAdminOrigin(request, url, env)) {
      await recordSecurityEvent(env.DB, {
        eventType: 'ADMIN_ORIGIN_REJECTED',
        severity: 'HIGH',
        sourceCategory: 'CSRF',
        actorId: await getRequestActorHash(request, env, 'security'),
        resource: url.pathname,
      });
      return jsonResponse({ error: 'Cross-origin request rejected.' }, 403, corsHeaders);
    }
    if (!isConfiguredAdminAuth(env)) {
      return jsonResponse(
        { error: 'ADMIN_PASSPHRASE (>=8 chars) and strong ADMIN_SESSION_SECRET (>=32 chars) must both be configured.' },
        503,
        corsHeaders
      );
    }
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return jsonResponse({ error: 'Content-Type must be application/json.' }, 415, corsHeaders);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const attemptRow = await env.DB.prepare(
      `SELECT failed_count, first_failed_at, locked_until FROM admin_login_attempts WHERE client_key = ?`
    ).bind(actorHash).first() as {
      failed_count?: number;
      first_failed_at?: string | null;
      locked_until?: string | null;
    } | null;

    if (attemptRow?.locked_until) {
      const lockedMs = parseUtcTimestampMs(attemptRow.locked_until);
      if (lockedMs !== null && lockedMs > nowMs) {
        const retryAfterSec = Math.max(1, Math.ceil((lockedMs - nowMs) / 1000));
        await recordAudit(env, 'ADMIN_LOGIN_LOCKED', { actorHash });
        await recordSecurityEvent(env.DB, {
          eventType: 'ADMIN_LOGIN_LOCKED',
          severity: 'HIGH',
          sourceCategory: 'RATE_LIMIT',
          actorId: await getRequestActorHash(request, env, 'security'),
          resource: url.pathname,
          details: { retryAfterSec },
        });
        return jsonResponse(
          { error: 'Too many failed attempts. Try again later.' },
          429,
          corsHeaders,
          { 'Retry-After': String(retryAfterSec) }
        );
      }
    }

    const parsedLogin = await readJsonBodyWithLimit(request, 8192);
    if (!parsedLogin.ok) {
      return jsonResponse({ error: parsedLogin.error }, parsedLogin.status, corsHeaders);
    }
    const body = parsedLogin.data;

    const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : '';
    const valid = await verifyPassphrase(passphrase, env.ADMIN_PASSPHRASE);
    if (!valid) {
      const firstFailedMs = parseUtcTimestampMs(attemptRow?.first_failed_at) ?? 0;
      const withinWindow = firstFailedMs > 0 && nowMs - firstFailedMs <= ATTEMPT_WINDOW_MS;
      const nextCount = withinWindow ? Number(attemptRow?.failed_count ?? 0) + 1 : 1;
      const nextFirstFailed = withinWindow ? attemptRow!.first_failed_at! : nowIso;
      const lockedUntil = nextCount >= MAX_LOGIN_ATTEMPTS ? new Date(nowMs + LOCKOUT_MS).toISOString() : null;

      await env.DB.prepare(`
        INSERT INTO admin_login_attempts (client_key, failed_count, first_failed_at, locked_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(client_key) DO UPDATE SET
          failed_count = excluded.failed_count,
          first_failed_at = excluded.first_failed_at,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at
      `).bind(actorHash, nextCount, nextFirstFailed, lockedUntil, nowIso).run();

      await recordAudit(env, 'ADMIN_LOGIN_FAILED', { actorHash, attempt: nextCount });
      await recordSecurityEvent(env.DB, {
        eventType: 'ADMIN_LOGIN_FAILED',
        severity: nextCount >= MAX_LOGIN_ATTEMPTS ? 'HIGH' : 'MEDIUM',
        sourceCategory: 'ADMIN_AUTH',
        actorId: await getRequestActorHash(request, env, 'security'),
        resource: url.pathname,
        details: { attempt: nextCount, locked: Boolean(lockedUntil) },
      });
      return jsonResponse({ error: 'Invalid passphrase.' }, 401, corsHeaders);
    }

    await env.DB.prepare(`DELETE FROM admin_login_attempts WHERE client_key = ?`).bind(actorHash).run();
    const version = await getSessionVersion(env);
    const token = await createSessionToken(env.ADMIN_SESSION_SECRET!, version);
    await recordAudit(env, 'ADMIN_LOGIN_SUCCESS', { actorHash });
    await recordSecurityEvent(env.DB, {
      eventType: 'ADMIN_LOGIN_SUCCESS',
      severity: 'LOW',
      sourceCategory: 'ADMIN_AUTH',
      actorId: await getRequestActorHash(request, env, 'security'),
      resource: url.pathname,
      details: { status: 'authenticated' },
    });

    return jsonResponse(
      { authenticated: true },
      200,
      corsHeaders,
      { 'Set-Cookie': buildSessionCookie(token, isHttps) }
    );
  }

  if (url.pathname === '/api/auth/config/logout' && request.method === 'POST') {
    const actorHash = await getRequestActorHash(request, env, 'security');
    if (!isAllowedAdminOrigin(request, url, env)) {
      await recordSecurityEvent(env.DB, {
        eventType: 'CSRF_ORIGIN_REJECTED',
        severity: 'HIGH',
        sourceCategory: 'CSRF',
        actorId: actorHash,
        resource: url.pathname,
      });
      return jsonResponse({ error: 'Cross-origin request rejected.' }, 403, corsHeaders);
    }
    if (request.headers.get('X-Requested-With') !== 'AxnnaAdmin') {
      await recordSecurityEvent(env.DB, {
        eventType: 'CSRF_HEADER_MISSING',
        severity: 'HIGH',
        sourceCategory: 'CSRF',
        actorId: actorHash,
        resource: url.pathname,
      });
      return jsonResponse({ error: 'Missing required CSRF header.' }, 403, corsHeaders);
    }

    const auth = await authenticateAdminRequest(request, env);
    if (auth.authenticated && auth.payload) {
      const nowSec = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT OR IGNORE INTO revoked_admin_sessions (nonce, expires_at) VALUES (?, ?)`
      ).bind(auth.payload.nonce, auth.payload.exp).run();
      await env.DB.prepare(
        `DELETE FROM revoked_admin_sessions WHERE expires_at < ?`
      ).bind(nowSec).run();
      await recordAudit(env, 'ADMIN_LOGOUT');
    }

    return jsonResponse(
      { authenticated: false },
      200,
      corsHeaders,
      { 'Set-Cookie': buildClearSessionCookie(isHttps) }
    );
  }

  if (!url.pathname.startsWith('/api/config')) {
    return null;
  }

  if (request.method !== 'GET') {
    const actorHash = await getRequestActorHash(request, env, 'security');
    if (!isAllowedAdminOrigin(request, url, env)) {
      await recordSecurityEvent(env.DB, {
        eventType: 'CSRF_ORIGIN_REJECTED',
        severity: 'HIGH',
        sourceCategory: 'CSRF',
        actorId: actorHash,
        resource: url.pathname,
      });
      return jsonResponse({ error: 'Cross-origin request rejected.' }, 403, corsHeaders);
    }
    if (request.headers.get('X-Requested-With') !== 'AxnnaAdmin') {
      await recordSecurityEvent(env.DB, {
        eventType: 'CSRF_HEADER_MISSING',
        severity: 'HIGH',
        sourceCategory: 'CSRF',
        actorId: actorHash,
        resource: url.pathname,
      });
      return jsonResponse({ error: 'Missing required CSRF header.' }, 403, corsHeaders);
    }
  }

  const auth = await authenticateAdminRequest(request, env);
  if (!auth.authenticated) {
    await recordSecurityEvent(env.DB, {
      eventType: 'ADMIN_API_UNAUTHORIZED',
      severity: 'MEDIUM',
      sourceCategory: 'API_AUTH',
      actorId: await getRequestActorHash(request, env, 'security'),
      resource: url.pathname,
    });
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  if (url.pathname === '/api/config/overview' && request.method === 'GET') {
    const daysParam = Number(url.searchParams.get('days') || '7');
    const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;
    const sinceSql = toSqliteUtcTimestamp(Date.now() - days * 24 * 60 * 60 * 1000);
    const page = clampInt(url.searchParams.get('page'), 1, 1, 500);
    const pageSize = clampInt(url.searchParams.get('pageSize'), 25, 5, 50);
    const offset = (page - 1) * pageSize;
    const paperInstrument = url.searchParams.get('paperInstrument') || 'ALL';
    const paperVersion = url.searchParams.get('paperVersion') || 'ALL';
    const userSearch = (url.searchParams.get('userSearch') || '').trim().slice(0, 64);
    const userStatusParam = (url.searchParams.get('userStatus') || 'ALL').toUpperCase();
    const userStatus = userStatusParam === 'CONNECTED' || userStatusParam === 'DISCONNECTED' ? userStatusParam : 'ALL';
    const signalInstrumentParam = (url.searchParams.get('signalInstrument') || 'ALL').toUpperCase();
    const signalInstrument = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'].includes(signalInstrumentParam)
      ? signalInstrumentParam
      : 'ALL';
    const secSevParam = (url.searchParams.get('securitySeverity') || 'ALL').toUpperCase();
    const secSeverity = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(secSevParam) ? secSevParam : 'ALL';
    const secResParam = (url.searchParams.get('securityResolution') || 'ALL').toUpperCase();
    const secResolution = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(secResParam) ? secResParam : 'ALL';

    const userWhereParts: string[] = [];
    const userBinds: unknown[] = [];
    if (userStatus !== 'ALL') {
      userWhereParts.push(`u.status = ?`);
      userBinds.push(userStatus);
    }
    if (userSearch) {
      userWhereParts.push(`(LOWER(u.telegram_user_id) LIKE ? OR LOWER(COALESCE(u.telegram_username_snapshot, '')) LIKE ? OR LOWER(COALESCE(u.telegram_first_name_snapshot, '')) LIKE ?)`);
      const pat = `%${userSearch.toLowerCase()}%`;
      userBinds.push(pat, pat, pat);
    }
    const userWhereSql = userWhereParts.length > 0 ? `WHERE ${userWhereParts.join(' AND ')}` : '';

    const sigWhereSql = signalInstrument !== 'ALL' ? `WHERE instrument = ?` : '';
    const sigBinds: unknown[] = signalInstrument !== 'ALL' ? [signalInstrument] : [];

    const secWhereParts: string[] = [];
    const secBinds: unknown[] = [];
    if (secSeverity !== 'ALL') {
      secWhereParts.push(`severity = ?`);
      secBinds.push(secSeverity);
    }
    if (secResolution !== 'ALL') {
      secWhereParts.push(`resolution_status = ?`);
      secBinds.push(secResolution);
    }
    const secWhereSql = secWhereParts.length > 0 ? `WHERE ${secWhereParts.join(' AND ')}` : '';

    const [
      sysRes,
      healthRes,
      providerHealthRes,
      stratRes,
      stratStateRes,
      usersCounts,
      usersFilteredCountRow,
      usersRes,
      signalsCounts,
      signalsFilteredCountRow,
      signalsRes,
      paperTradesCount,
      paperTradingOverview,
      riskCounts,
      riskDecisionsRes,
      deliveryCounts,
      deliveriesRes,
      eventsRes,
      auditCountRow,
      auditRes,
      secCounts,
      secFilteredCountRow,
      secEventsRes,
      contactCounts,
      contactRes,
      analyticsSummary,
      topPagesRes,
      topReferrersRes,
      deviceDistRes,
      browserDistRes,
      countryDistRes,
      dailyTrendsRes,
      funnelRes,
      systemHealth,
    ] = await Promise.all([
      env.DB.prepare(`SELECT "key", value, updated_at FROM system_config`).all(),
      env.DB.prepare(`SELECT * FROM market_data_state ORDER BY instrument ASC, timeframe ASC`).all(),
      env.DB.prepare(`SELECT * FROM provider_health_state ORDER BY provider_name ASC`).all(),
      env.DB.prepare(`SELECT id, strategy_id, name, active_status, description, updated_at FROM strategies ORDER BY name ASC`).all(),
      env.DB.prepare(`SELECT instrument, strategy_id, strategy_version, last_processed_5m_timestamp, updated_at FROM strategy_state ORDER BY instrument ASC`).all(),
      env.DB.prepare(`
        SELECT COUNT(*) as total_users,
               SUM(CASE WHEN status = 'CONNECTED' THEN 1 ELSE 0 END) as connected_users
        FROM axnna_users
      `).first(),
      env.DB.prepare(`SELECT COUNT(*) as filtered_users FROM axnna_users u ${userWhereSql}`).bind(...userBinds).first(),
      env.DB.prepare(`
        SELECT u.id, u.telegram_user_id, u.telegram_chat_id, u.telegram_username_snapshot,
               u.telegram_first_name_snapshot, u.telegram_last_name_snapshot,
               u.status, u.signal_notifications_enabled, u.connected_at, u.last_seen_at,
               (SELECT COUNT(*) FROM notification_deliveries nd WHERE nd.axnna_user_id = u.id AND nd.status = 'SENT') as sent_alerts
        FROM axnna_users u
        ${userWhereSql}
        ORDER BY u.connected_at DESC, u.id DESC
        LIMIT ? OFFSET ?
      `).bind(...userBinds, pageSize, offset).all(),
      env.DB.prepare(`
        SELECT COUNT(*) as total_signals,
               SUM(CASE WHEN status IN ('ALERT_ELIGIBLE', 'ALERTED') OR EXISTS (SELECT 1 FROM risk_decisions rd WHERE rd.signal_id = signals.signal_id AND rd.decision = 'APPROVED') THEN 1 ELSE 0 END) as alert_eligible_or_alerted,
               SUM(CASE WHEN status = 'ALERTED' OR EXISTS (SELECT 1 FROM notification_deliveries nd WHERE nd.signal_id = signals.signal_id AND nd.status = 'SENT') THEN 1 ELSE 0 END) as alerted_signals
        FROM signals
      `).first(),
      env.DB.prepare(`SELECT COUNT(*) as filtered_signals FROM signals ${sigWhereSql}`).bind(...sigBinds).first(),
      env.DB.prepare(`
        SELECT signal_id, strategy_id, strategy_version, instrument, direction, generated_at,
               entry, structural_stop, structural_target, structural_rr,
               status, technical_score, rejection_reason, market_context, evidence_payload
        FROM signals
        ${sigWhereSql}
        ORDER BY generated_at DESC, signal_id DESC
        LIMIT ? OFFSET ?
      `).bind(...sigBinds, pageSize, offset).all(),
      env.DB.prepare(`SELECT COUNT(*) as total FROM paper_trades`).first().catch(() => ({ total: 0 })),
      getPaperPortfolioOverview(env.DB, {
        instrument: paperInstrument,
        strategyVersion: paperVersion,
        limit: pageSize,
        offset,
      }),
      env.DB.prepare(`
        SELECT COUNT(*) as total_risk,
               SUM(CASE WHEN decision = 'APPROVED' THEN 1 ELSE 0 END) as approved_count,
               SUM(CASE WHEN decision = 'REJECTED' THEN 1 ELSE 0 END) as rejected_count
        FROM risk_decisions
      `).first().catch(() => ({ total_risk: 0, approved_count: 0, rejected_count: 0 })),
      env.DB.prepare(`
        SELECT id, signal_id, instrument, direction, strategy_version, technical_score,
               decision, reason_code, reason_detail, event_risk, confluence, evaluated_at
        FROM risk_decisions
        ORDER BY evaluated_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).bind(pageSize, offset).all().catch(() => ({ results: [] })),
      env.DB.prepare(`
        SELECT COUNT(*) as total_deliveries,
               SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent_deliveries,
               SUM(CASE WHEN status != 'SENT' THEN 1 ELSE 0 END) as failed_or_retrying
        FROM notification_deliveries
      `).first(),
      env.DB.prepare(`
        SELECT id, signal_id, axnna_user_id, destination, status,
               provider_message_id, attempt_count, last_attempt_at, delivered_at, created_at,
               last_error, last_http_status, next_retry_at
        FROM notification_deliveries
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).bind(pageSize, offset).all(),
      env.DB.prepare(`SELECT COUNT(*) as total, MAX(updated_at) as last_sync FROM economic_events`).first(),
      env.DB.prepare(`SELECT COUNT(*) as total FROM audit_events`).first(),
      env.DB.prepare(`
        SELECT event_id, event_type, timestamp, axnna_user_id, metadata, actor_source
        FROM audit_events
        ORDER BY timestamp DESC, event_id DESC
        LIMIT ? OFFSET ?
      `).bind(pageSize, offset).all(),
      env.DB.prepare(`
        SELECT COUNT(*) as total_security,
               SUM(CASE WHEN resolution_status = 'OPEN' THEN 1 ELSE 0 END) as open_security
        FROM security_events
      `).first(),
      env.DB.prepare(`SELECT COUNT(*) as filtered_security FROM security_events ${secWhereSql}`).bind(...secBinds).first(),
      env.DB.prepare(`
        SELECT id, event_type, severity, source_category, actor_id, resource, details, resolution_status, resolved_at, created_at
        FROM security_events
        ${secWhereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).bind(...secBinds, pageSize, offset).all(),
      env.DB.prepare(`
        SELECT COUNT(*) as total_contact,
               SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END) as new_contact
        FROM contact_submissions
      `).first(),
      env.DB.prepare(`
        SELECT id, category, message, contact_info, status, created_at
        FROM contact_submissions
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).bind(pageSize, offset).all(),
      env.DB.prepare(`
        SELECT COUNT(*) as total_events,
               COUNT(DISTINCT visitor_id) as unique_visitors,
               COUNT(DISTINCT session_id) as total_visits,
               SUM(CASE WHEN event_type = 'PAGE_VIEW' THEN 1 ELSE 0 END) as page_views
        FROM analytics_events
        WHERE created_at >= ?
      `).bind(sinceSql).first(),
      env.DB.prepare(`
        SELECT path, COUNT(*) as views
        FROM analytics_events
        WHERE event_type = 'PAGE_VIEW' AND created_at >= ?
        GROUP BY path
        ORDER BY views DESC, path ASC
        LIMIT 10
      `).bind(sinceSql).all(),
      env.DB.prepare(`
        SELECT COALESCE(NULLIF(referrer, ''), 'Direct') as source, COUNT(*) as visits
        FROM analytics_events
        WHERE event_type = 'PAGE_VIEW' AND created_at >= ?
        GROUP BY source
        ORDER BY visits DESC, source ASC
        LIMIT 10
      `).bind(sinceSql).all(),
      env.DB.prepare(`
        SELECT COALESCE(device_category, 'unknown') as device, COUNT(*) as count
        FROM analytics_events
        WHERE event_type = 'PAGE_VIEW' AND created_at >= ?
        GROUP BY device
      `).bind(sinceSql).all(),
      env.DB.prepare(`
        SELECT COALESCE(browser_category, 'Unknown') as browser, COUNT(*) as count
        FROM analytics_events
        WHERE event_type = 'PAGE_VIEW' AND created_at >= ?
        GROUP BY browser
      `).bind(sinceSql).all(),
      env.DB.prepare(`
        SELECT COALESCE(country_code, 'Unavailable') as country, COUNT(*) as count
        FROM analytics_events
        WHERE event_type = 'PAGE_VIEW' AND created_at >= ?
        GROUP BY country
        ORDER BY count DESC, country ASC
        LIMIT 15
      `).bind(sinceSql).all(),
      env.DB.prepare(`
        SELECT substr(created_at, 1, 10) as day, COUNT(*) as page_views, COUNT(DISTINCT visitor_id) as unique_visitors
        FROM analytics_events
        WHERE event_type = 'PAGE_VIEW' AND created_at >= ?
        GROUP BY day
        ORDER BY day ASC
      `).bind(sinceSql).all(),
      env.DB.prepare(`
        SELECT event_type, COUNT(*) as count
        FROM analytics_events
        WHERE created_at >= ?
        GROUP BY event_type
        ORDER BY count DESC, event_type ASC
      `).bind(sinceSql).all(),
      evaluateSystemHealth(env),
    ]);

    const configMap: Record<string, string> = {};
    for (const row of (sysRes.results || []) as Array<{ key: string; value: string }>) {
      configMap[row.key] = row.value;
    }

    return jsonResponse({
      environment: env.ENVIRONMENT || 'development',
      pagination: { page, pageSize },
      totals: {
        usersTotal: Number((usersCounts as any)?.total_users ?? 0),
        connectedUsers: Number((usersCounts as any)?.connected_users ?? 0),
        signalsTotal: Number((signalsCounts as any)?.total_signals ?? 0),
        alertEligibleSignals: Number((signalsCounts as any)?.alert_eligible_or_alerted ?? 0),
        alertedSignals: Number((signalsCounts as any)?.alerted_signals ?? 0),
        paperTradesTotal: Number((paperTradesCount as any)?.total ?? 0),
        riskDecisionsTotal: Number((riskCounts as any)?.total_risk ?? 0),
        riskApprovedTotal: Number((riskCounts as any)?.approved_count ?? 0),
        riskRejectedTotal: Number((riskCounts as any)?.rejected_count ?? 0),
        deliveriesTotal: Number((deliveryCounts as any)?.total_deliveries ?? 0),
        sentDeliveries: Number((deliveryCounts as any)?.sent_deliveries ?? 0),
        failedDeliveries: Number((deliveryCounts as any)?.failed_or_retrying ?? 0),
        securityTotal: Number((secCounts as any)?.total_security ?? 0),
        openSecurityEvents: Number((secCounts as any)?.open_security ?? 0),
        contactTotal: Number((contactCounts as any)?.total_contact ?? 0),
        newContactSubmissions: Number((contactCounts as any)?.new_contact ?? 0),
        auditTotal: Number((auditCountRow as any)?.total ?? 0),
      },
      filteredTotals: {
        users: Number((usersFilteredCountRow as any)?.filtered_users ?? 0),
        signals: Number((signalsFilteredCountRow as any)?.filtered_signals ?? 0),
        security: Number((secFilteredCountRow as any)?.filtered_security ?? 0),
        paperTrades: paperTradingOverview.filteredTotal,
      },
      systemConfig: {
        globalNotificationsEnabled: configMap.global_notifications_enabled !== 'false',
        secrets: getSecretStatus(env),
      },
      systemHealth,
      marketHealth: healthRes.results || [],
      providerHealth: providerHealthRes.results || [],
      economicCalendar: {
        totalEvents: Number((eventsRes as any)?.total ?? 0),
        lastSync: (eventsRes as any)?.last_sync ?? null,
      },
      strategies: stratRes.results || [],
      strategyStates: stratStateRes.results || [],
      users: usersRes.results || [],
      signals: signalsRes.results || [],
      riskDecisions: riskDecisionsRes.results || [],
      paperTrading: paperTradingOverview,
      deliveries: deliveriesRes.results || [],
      analytics: {
        days,
        summary: {
          totalEvents: Number((analyticsSummary as any)?.total_events ?? 0),
          uniqueVisitors: Number((analyticsSummary as any)?.unique_visitors ?? 0),
          totalVisits: Number((analyticsSummary as any)?.total_visits ?? 0),
          pageViews: Number((analyticsSummary as any)?.page_views ?? 0),
        },
        topPages: topPagesRes.results || [],
        topReferrers: topReferrersRes.results || [],
        devices: deviceDistRes.results || [],
        browsers: browserDistRes.results || [],
        countries: countryDistRes.results || [],
        dailyTrends: dailyTrendsRes.results || [],
        funnel: funnelRes.results || [],
      },
      securityEvents: secEventsRes.results || [],
      contactSubmissions: contactRes.results || [],
      auditEvents: auditRes.results || [],
    }, 200, corsHeaders);
  }

  if (url.pathname === '/api/config/system/notifications' && request.method === 'POST') {
    const parsedLogin = await readJsonBodyWithLimit(request, 8192);
    if (!parsedLogin.ok) {
      return jsonResponse({ error: parsedLogin.error }, parsedLogin.status, corsHeaders);
    }
    const body = parsedLogin.data;

    const enabled = Boolean(body?.enabled);
    await env.DB.prepare(`
      INSERT INTO system_config ("key", value, updated_at)
      VALUES ('global_notifications_enabled', ?, CURRENT_TIMESTAMP)
      ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(enabled ? 'true' : 'false').run();

    await recordAudit(env, 'GLOBAL_NOTIFICATIONS_UPDATED', { enabled });
    return jsonResponse({ ok: true, globalNotificationsEnabled: enabled }, 200, corsHeaders);
  }

  const stratMatch = url.pathname.match(/^\/api\/config\/strategies\/([^/]+)\/toggle$/);
  if (stratMatch && request.method === 'POST') {
    const strategyId = decodeURIComponent(stratMatch[1]);
    const parsedBody = await readJsonBodyWithLimit(request, 8192);
    if (!parsedBody.ok) {
      return jsonResponse({ error: parsedBody.error }, parsedBody.status, corsHeaders);
    }
    const body = parsedBody.data || {};

    const nextStatus = body?.activeStatus === 'ACTIVE' || body?.activeStatus === 'DISABLED'
      ? body.activeStatus
      : null;

    if (!nextStatus) {
      return jsonResponse({ error: 'activeStatus must be ACTIVE or DISABLED.' }, 400, corsHeaders);
    }

    const res = await env.DB.prepare(
      `UPDATE strategies SET active_status = ?, updated_at = CURRENT_TIMESTAMP WHERE strategy_id = ?`
    ).bind(nextStatus, strategyId).run();

    if (Number((res as any)?.meta?.changes ?? 0) === 0) {
      return jsonResponse({ error: 'Strategy not found.' }, 404, corsHeaders);
    }

    await recordAudit(env, 'STRATEGY_STATUS_UPDATED', { strategyId, activeStatus: nextStatus });
    return jsonResponse({ ok: true, strategyId, activeStatus: nextStatus }, 200, corsHeaders);
  }

  const userMatch = url.pathname.match(/^\/api\/config\/users\/([^/]+)\/toggle$/);
  if (userMatch && request.method === 'POST') {
    const userId = decodeURIComponent(userMatch[1]);
    const parsedBody = await readJsonBodyWithLimit(request, 8192);
    if (!parsedBody.ok) {
      return jsonResponse({ error: parsedBody.error }, parsedBody.status, corsHeaders);
    }
    const body = parsedBody.data || {};

    const hasNotif = typeof body?.notificationsEnabled === 'boolean';
    const hasStatus = body?.status === 'CONNECTED' || body?.status === 'DISCONNECTED';
    if (!hasNotif && !hasStatus) {
      return jsonResponse({ error: 'No valid user update fields supplied.' }, 400, corsHeaders);
    }

    if (hasNotif) {
      const res = await env.DB.prepare(
        `UPDATE axnna_users SET signal_notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(body.notificationsEnabled ? 1 : 0, userId).run();
      if (Number((res as any)?.meta?.changes ?? 0) === 0) {
        return jsonResponse({ error: 'User not found.' }, 404, corsHeaders);
      }
      await recordAudit(env, 'USER_NOTIFICATIONS_UPDATED', { userId, enabled: body.notificationsEnabled });
      try {
        await env.DB.prepare(
          `INSERT INTO analytics_events (id, visitor_id, session_id, event_type, path, device_category, browser_category)
           VALUES (?, ?, ?, 'ALERT_PREF_UPDATED', '/config', 'unknown', 'AdminConsole')`
        ).bind(crypto.randomUUID(), userId, `admin-${Date.now()}`).run();
      } catch {
        // Ignore analytics insertion error
      }
    }

    if (hasStatus) {
      const res = await env.DB.prepare(
        `UPDATE axnna_users SET status = ?, disconnected_at = CASE WHEN ? = 'DISCONNECTED' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(body.status, body.status, userId).run();
      if (Number((res as any)?.meta?.changes ?? 0) === 0) {
        return jsonResponse({ error: 'User not found.' }, 404, corsHeaders);
      }
      await recordAudit(env, 'USER_STATUS_UPDATED', { userId, status: body.status });
    }

    return jsonResponse({ ok: true, userId }, 200, corsHeaders);
  }

  const retryMatch = url.pathname.match(/^\/api\/config\/deliveries\/([^/]+)\/retry$/);
  if (retryMatch && request.method === 'POST') {
    const deliveryId = decodeURIComponent(retryMatch[1]);
    const result = await actions.retrySingleDelivery(deliveryId);
    await recordAudit(env, 'MANUAL_DELIVERY_RETRY', { deliveryId, resultStatus: result.status });
    if (!result.ok && result.status === 'NOT_FOUND') {
      return jsonResponse({ error: 'Delivery record not found.' }, 404, corsHeaders);
    }
    if (!result.ok && result.status === 'CONFLICT') {
      return jsonResponse({ error: result.error || 'Delivery retry already in progress.' }, 409, corsHeaders);
    }
    if (!result.ok && result.status === 'REJECTED') {
      return jsonResponse({ error: result.error || 'Delivery cannot be retried.' }, 400, corsHeaders);
    }
    return jsonResponse({ ok: result.ok, status: result.status, error: result.error || null }, 200, corsHeaders);
  }

  const secMatch = url.pathname.match(/^\/api\/config\/security\/([^/]+)\/resolve$/);
  if (secMatch && request.method === 'POST') {
    const secId = decodeURIComponent(secMatch[1]);
    let body: any = {};
    const parsedBody = await readJsonBodyWithLimit(request, 8192);
    if (!parsedBody.ok) {
      if (parsedBody.status === 413) {
        return jsonResponse({ error: parsedBody.error }, 413, corsHeaders);
      }
      body = {};
    } else {
      body = parsedBody.data || {};
    }
    const nextStatus = body?.resolutionStatus === 'ACKNOWLEDGED' || body?.resolutionStatus === 'RESOLVED'
      ? body.resolutionStatus
      : 'RESOLVED';

    const res = await env.DB.prepare(
      `UPDATE security_events
       SET resolution_status = ?, resolved_at = CASE WHEN ? = 'RESOLVED' THEN CURRENT_TIMESTAMP ELSE NULL END, resolved_by = 'ADMIN_CONFIG'
       WHERE id = ?`
    ).bind(nextStatus, nextStatus, secId).run();

    if (Number((res as any)?.meta?.changes ?? 0) === 0) {
      return jsonResponse({ error: 'Security event not found.' }, 404, corsHeaders);
    }

    await recordAudit(env, 'SECURITY_EVENT_UPDATED', { securityEventId: secId, resolutionStatus: nextStatus });
    return jsonResponse({ ok: true, id: secId, resolutionStatus: nextStatus }, 200, corsHeaders);
  }

  const contactMatch = url.pathname.match(/^\/api\/config\/contact\/([^/]+)\/status$/);
  if (contactMatch && request.method === 'POST') {
    const contactId = decodeURIComponent(contactMatch[1]);
    const parsedBody = await readJsonBodyWithLimit(request, 8192);
    if (!parsedBody.ok) {
      return jsonResponse({ error: parsedBody.error }, parsedBody.status, corsHeaders);
    }
    const body = parsedBody.data || {};
    const nextStatus = ['NEW', 'REVIEWED', 'RESOLVED'].includes(body?.status) ? body.status : null;
    if (!nextStatus) {
      return jsonResponse({ error: 'status must be NEW, REVIEWED, or RESOLVED.' }, 400, corsHeaders);
    }
    const res = await env.DB.prepare(`UPDATE contact_submissions SET status = ? WHERE id = ?`)
      .bind(nextStatus, contactId)
      .run();
    if (Number((res as any)?.meta?.changes ?? 0) === 0) {
      return jsonResponse({ error: 'Contact submission not found.' }, 404, corsHeaders);
    }
    await recordAudit(env, 'CONTACT_SUBMISSION_UPDATED', { contactId, status: nextStatus });
    return jsonResponse({ ok: true, id: contactId, status: nextStatus }, 200, corsHeaders);
  }

  if (url.pathname === '/api/config/paper/account' && request.method === 'POST') {
    const parsedBody = await readJsonBodyWithLimit(request, 8192);
    if (!parsedBody.ok) {
      return jsonResponse({ error: parsedBody.error }, parsedBody.status, corsHeaders);
    }
    const body = parsedBody.data || {};

    const startingBalance = Number(body?.startingBalance);
    const riskPerTradePercent = Number(body?.riskPerTradePercent);
    const resetAccount = body?.resetAccount === true;

    if (!Number.isFinite(startingBalance) || startingBalance < 100 || startingBalance > 10_000_000) {
      return jsonResponse({ error: 'startingBalance must be between 100 and 10,000,000.' }, 400, corsHeaders);
    }
    if (!Number.isFinite(riskPerTradePercent) || riskPerTradePercent < 0.1 || riskPerTradePercent > 5.0) {
      return jsonResponse({ error: 'riskPerTradePercent must be between 0.1 and 5.0.' }, 400, corsHeaders);
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO paper_accounts (id, name, starting_balance, current_balance, risk_per_trade_percent, currency)
       VALUES ('default', 'Axnna Simulation Account', ?, ?, ?, 'USD')`
    ).bind(startingBalance, startingBalance, riskPerTradePercent).run();

    if (resetAccount) {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM paper_trades WHERE account_id = 'default'`),
        env.DB.prepare(
          `UPDATE paper_accounts
           SET starting_balance = ?, current_balance = ?, risk_per_trade_percent = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = 'default'`
        ).bind(startingBalance, startingBalance, riskPerTradePercent),
        env.DB.prepare(
          `INSERT INTO audit_events (event_id, event_type, metadata, actor_source) VALUES (?, 'PAPER_ACCOUNT_RESET', ?, 'ADMIN_CONFIG')`
        ).bind(crypto.randomUUID(), JSON.stringify({ startingBalance, riskPerTradePercent })),
      ]);
    } else {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE paper_accounts
           SET starting_balance = ?,
               current_balance = ? + COALESCE(
                 (SELECT SUM(net_pnl) FROM paper_trades WHERE account_id = 'default' AND status IN ('TARGET_HIT', 'STOP_HIT')),
                 0
               ),
               risk_per_trade_percent = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = 'default'`
        ).bind(startingBalance, startingBalance, riskPerTradePercent),
        env.DB.prepare(
          `INSERT INTO audit_events (event_id, event_type, metadata, actor_source) VALUES (?, 'PAPER_ACCOUNT_UPDATED', ?, 'ADMIN_CONFIG')`
        ).bind(crypto.randomUUID(), JSON.stringify({ startingBalance, riskPerTradePercent, resetAccount: false })),
      ]);
    }

    return jsonResponse({ ok: true, startingBalance, riskPerTradePercent, resetAccount }, 200, corsHeaders);
  }

  if (url.pathname === '/api/config/sync' && request.method === 'POST') {
    const result = await actions.runSync();
    await recordAudit(env, 'MANUAL_SYNC_TRIGGERED', { status: result.status, summary: result.summary });

    if (result.status === 'ALREADY_RUNNING') {
      return jsonResponse(
        { ok: false, status: result.status, error: result.error || 'Synchronization is already running.' },
        409,
        corsHeaders
      );
    }
    if (result.status === 'FAILED') {
      return jsonResponse(
        { ok: false, status: result.status, error: result.error || result.summary || 'Synchronization failed.' },
        502,
        corsHeaders
      );
    }
    return jsonResponse(
      {
        ok: true,
        status: result.status,
        summary: result.summary || 'Synchronization complete.',
        syncedAt: new Date().toISOString(),
      },
      200,
      corsHeaders
    );
  }

  return jsonResponse({ error: 'Not Found' }, 404, corsHeaders);
}
