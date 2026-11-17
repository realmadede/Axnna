import type { Env } from '../worker';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  extractSessionCookie,
  verifyPassphrase,
  verifySessionToken,
} from './auth';

function getSigningSecret(env: Env): string | null {
  return env.ADMIN_SESSION_SECRET || env.ADMIN_PASSPHRASE || null;
}

async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const secret = getSigningSecret(env);
  if (!secret || !env.ADMIN_PASSPHRASE) return false;
  const token = extractSessionCookie(request);
  if (!token) return false;
  return verifySessionToken(token, secret);
}

async function recordAudit(env: Env, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_events (event_id, event_type, metadata, actor_source) VALUES (?, ?, ?, 'ADMIN_CONFIG')`
    ).bind(crypto.randomUUID(), eventType, metadata ? JSON.stringify(metadata) : null).run();
  } catch {
    // Do not fail admin mutations if audit table write fails
  }
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>, extra?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { ...headers, ...extra },
  });
}

/** Handles `/api/auth/config*` and `/api/config/*` admin endpoints. Returns null if path does not match. */
export async function handleAdminRoutes(
  request: Request,
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>,
  runSync: () => Promise<void>
): Promise<Response | null> {
  const isHttps = url.protocol === 'https:';

  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const authenticated = await isAuthenticated(request, env);
    return jsonResponse({ authenticated, configured: Boolean(env.ADMIN_PASSPHRASE) }, 200, corsHeaders);
  }

  if (url.pathname === '/api/auth/config' && request.method === 'POST') {
    if (!env.ADMIN_PASSPHRASE) {
      return jsonResponse({ error: 'ADMIN_PASSPHRASE is not configured on the Worker.' }, 503, corsHeaders);
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body.' }, 400, corsHeaders);
    }

    const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : '';
    const valid = await verifyPassphrase(passphrase, env.ADMIN_PASSPHRASE);
    if (!valid) {
      await recordAudit(env, 'ADMIN_LOGIN_FAILED');
      return jsonResponse({ error: 'Invalid passphrase.' }, 401, corsHeaders);
    }

    const secret = getSigningSecret(env)!;
    const token = await createSessionToken(secret);
    await recordAudit(env, 'ADMIN_LOGIN_SUCCESS');

    return jsonResponse(
      { authenticated: true },
      200,
      corsHeaders,
      { 'Set-Cookie': buildSessionCookie(token, isHttps) }
    );
  }

  if (url.pathname === '/api/auth/config/logout' && request.method === 'POST') {
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

  if (!(await isAuthenticated(request, env))) {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  if (url.pathname === '/api/config/overview' && request.method === 'GET') {
    const [sysRes, healthRes, stratRes, usersRes, signalsRes, deliveriesRes, eventsRes, auditRes] = await Promise.all([
      env.DB.prepare(`SELECT key, value, updated_at FROM system_config`).all(),
      env.DB.prepare(`SELECT * FROM market_data_state ORDER BY instrument ASC, timeframe ASC`).all(),
      env.DB.prepare(`SELECT id, strategy_id, name, active_status, description, updated_at FROM strategies ORDER BY name ASC`).all(),
      env.DB.prepare(`
        SELECT id, telegram_user_id, telegram_chat_id, telegram_username_snapshot,
               telegram_first_name_snapshot, telegram_last_name_snapshot,
               status, signal_notifications_enabled, connected_at, last_seen_at
        FROM axnna_users
        ORDER BY connected_at DESC
        LIMIT 100
      `).all(),
      env.DB.prepare(`
        SELECT signal_id, strategy_id, instrument, direction, generated_at,
               entry, structural_stop, structural_target, structural_rr,
               status, technical_score, rejection_reason, market_context
        FROM signals
        ORDER BY generated_at DESC
        LIMIT 30
      `).all(),
      env.DB.prepare(`
        SELECT id, signal_id, axnna_user_id, destination, status,
               provider_message_id, attempt_count, last_attempt_at, delivered_at, created_at
        FROM notification_deliveries
        ORDER BY created_at DESC
        LIMIT 30
      `).all(),
      env.DB.prepare(`SELECT COUNT(*) as total, MAX(updated_at) as last_sync FROM economic_events`).first(),
      env.DB.prepare(`SELECT event_id, event_type, timestamp, axnna_user_id, metadata, actor_source FROM audit_events ORDER BY timestamp DESC LIMIT 25`).all(),
    ]);

    const configMap: Record<string, string> = {};
    for (const row of (sysRes.results || []) as Array<{ key: string; value: string }>) {
      configMap[row.key] = row.value;
    }

    return jsonResponse({
      systemConfig: {
        globalNotificationsEnabled: configMap.global_notifications_enabled !== 'false',
      },
      marketHealth: healthRes.results || [],
      economicCalendar: {
        totalEvents: Number((eventsRes as any)?.total ?? 0),
        lastSync: (eventsRes as any)?.last_sync ?? null,
      },
      strategies: stratRes.results || [],
      users: usersRes.results || [],
      signals: signalsRes.results || [],
      deliveries: deliveriesRes.results || [],
      auditEvents: auditRes.results || [],
    }, 200, corsHeaders);
  }

  if (url.pathname === '/api/config/system/notifications' && request.method === 'POST') {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body.' }, 400, corsHeaders);
    }

    const enabled = Boolean(body?.enabled);
    await env.DB.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('global_notifications_enabled', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(enabled ? 'true' : 'false').run();

    await recordAudit(env, 'GLOBAL_NOTIFICATIONS_UPDATED', { enabled });
    return jsonResponse({ ok: true, globalNotificationsEnabled: enabled }, 200, corsHeaders);
  }

  const stratMatch = url.pathname.match(/^\/api\/config\/strategies\/([^/]+)\/toggle$/);
  if (stratMatch && request.method === 'POST') {
    const strategyId = decodeURIComponent(stratMatch[1]);
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const nextStatus = body?.activeStatus === 'ACTIVE' || body?.activeStatus === 'DISABLED'
      ? body.activeStatus
      : null;

    if (!nextStatus) {
      return jsonResponse({ error: 'activeStatus must be ACTIVE or DISABLED.' }, 400, corsHeaders);
    }

    await env.DB.prepare(
      `UPDATE strategies SET active_status = ?, updated_at = CURRENT_TIMESTAMP WHERE strategy_id = ?`
    ).bind(nextStatus, strategyId).run();

    await recordAudit(env, 'STRATEGY_STATUS_UPDATED', { strategyId, activeStatus: nextStatus });
    return jsonResponse({ ok: true, strategyId, activeStatus: nextStatus }, 200, corsHeaders);
  }

  const userMatch = url.pathname.match(/^\/api\/config\/users\/([^/]+)\/toggle$/);
  if (userMatch && request.method === 'POST') {
    const userId = decodeURIComponent(userMatch[1]);
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body.' }, 400, corsHeaders);
    }

    if (typeof body?.notificationsEnabled === 'boolean') {
      await env.DB.prepare(
        `UPDATE axnna_users SET signal_notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(body.notificationsEnabled ? 1 : 0, userId).run();
      await recordAudit(env, 'USER_NOTIFICATIONS_UPDATED', { userId, enabled: body.notificationsEnabled });
    }

    if (body?.status === 'CONNECTED' || body?.status === 'DISCONNECTED') {
      await env.DB.prepare(
        `UPDATE axnna_users SET status = ?, disconnected_at = CASE WHEN ? = 'DISCONNECTED' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(body.status, body.status, userId).run();
      await recordAudit(env, 'USER_STATUS_UPDATED', { userId, status: body.status });
    }

    return jsonResponse({ ok: true, userId }, 200, corsHeaders);
  }

  if (url.pathname === '/api/config/sync' && request.method === 'POST') {
    await runSync();
    await recordAudit(env, 'MANUAL_SYNC_TRIGGERED');
    return jsonResponse({ ok: true, syncedAt: new Date().toISOString() }, 200, corsHeaders);
  }

  return jsonResponse({ error: 'Not Found' }, 404, corsHeaders);
}
