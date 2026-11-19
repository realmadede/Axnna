import { CandidateSetup } from '../core-engine/Types';
import { Confluence, FundamentalContext } from '../engine/FundamentalEngine';
import {
  acquireNamedLease,
  checkD1RateLimit,
  finishJobRun,
  getRequestActorHash,
  hasRealSecret,
  recordSecurityEvent,
  releaseNamedLease,
  startJobRun,
} from '../ops/telemetry';
import { constantTimeSecretMatch } from '../utils/crypto';
import { parseUtcTimestampMs } from '../utils/time';
import { evaluateInstrumentFundamentalContext } from './fundamentals';
import { readJsonBodyWithLimit, sanitizeErrorMessage } from './http';
import { Env, isSupportedInstrument } from './types';

const MAX_DELIVERY_ATTEMPTS = 5;
const MAX_RECAP_ATTEMPTS = 3;

interface TelegramUserIdentity {
  id: number | string;
  username?: unknown;
  first_name?: unknown;
  last_name?: unknown;
}

interface TelegramChatRef {
  id: number | string;
}

function formatSignalMessage(
  sig: Pick<CandidateSetup, 'setupId' | 'direction' | 'technicalScore' | 'entryPrice' | 'stopLossPrice' | 'structuralTargetPrice'>,
  instrument: string,
  rr: number | null,
  macroRegime: string,
  confluence: string
): string {
  return [
    `AXNNA SIGNAL: ${instrument} ${sig.direction}`,
    `Score: ${sig.technicalScore ?? 0}/100 | Macro: ${confluence} (${macroRegime})`,
    `Entry: ${sig.entryPrice ?? 'N/A'}`,
    `Stop: ${sig.stopLossPrice ?? 'N/A'}`,
    `Target: ${sig.structuralTargetPrice ?? 'N/A'}`,
    `R:R: ${rr !== null ? rr.toFixed(2) : 'N/A'}`,
    `Timeframe: 1H -> 5M`,
    `Setup ID: ${sig.setupId}`,
  ].join('\n');
}

function computeNextRetryIso(attemptCount: number, retryAfterSec?: number): string {
  const delayMs =
    typeof retryAfterSec === 'number' && retryAfterSec > 0
      ? retryAfterSec * 1000
      : Math.min(60, 5 * Math.pow(2, Math.max(0, attemptCount - 1))) * 60 * 1000;
  return new Date(Date.now() + delayMs).toISOString();
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<{
  ok: boolean;
  httpStatus: number | null;
  providerMessageId: string | null;
  permanent: boolean;
  retryAfterSec?: number;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: { message_id?: number | string };
      description?: string;
      parameters?: { retry_after?: number };
    } | null;

    if (res.ok && body?.ok !== false) {
      return {
        ok: true,
        httpStatus: res.status,
        providerMessageId: body?.result?.message_id ? String(body.result.message_id) : null,
        permanent: false,
      };
    }

    const permanent = res.status === 400 || res.status === 401 || res.status === 403;
    const retryAfterSec = typeof body?.parameters?.retry_after === 'number' ? body.parameters.retry_after : undefined;
    return {
      ok: false,
      httpStatus: res.status,
      providerMessageId: null,
      permanent,
      retryAfterSec,
      error: sanitizeErrorMessage(body?.description || `HTTP ${res.status}`, botToken),
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      httpStatus: null,
      providerMessageId: null,
      permanent: false,
      error: sanitizeErrorMessage(err, botToken),
    };
  }
}

async function finalizeClaimedDelivery(
  env: Env,
  signalId: string,
  userId: string,
  attemptNumber: number,
  result: {
    ok: boolean;
    httpStatus: number | null;
    providerMessageId: string | null;
    permanent: boolean;
    retryAfterSec?: number;
    error?: string;
  }
): Promise<{ ok: boolean; status: 'SENT' | 'PERMANENT_FAILURE' | 'EXHAUSTED' | 'RETRY_SCHEDULED'; error?: string }> {
  const nowIso = new Date().toISOString();
  let nextStatus: 'SENT' | 'PERMANENT_FAILURE' | 'EXHAUSTED' | 'RETRY_SCHEDULED';
  let nextRetryAt: string | null = null;

  if (result.ok) {
    nextStatus = 'SENT';
  } else if (result.permanent) {
    nextStatus = 'PERMANENT_FAILURE';
    await recordSecurityEvent(env.DB, {
      eventType: 'TELEGRAM_DELIVERY_PERMANENT_FAILURE',
      severity: 'LOW',
      sourceCategory: 'DELIVERY',
      actorId: userId,
      resource: signalId,
      details: { httpStatus: result.httpStatus },
    });
  } else if (attemptNumber >= MAX_DELIVERY_ATTEMPTS) {
    nextStatus = 'EXHAUSTED';
    await recordSecurityEvent(env.DB, {
      eventType: 'TELEGRAM_DELIVERY_EXHAUSTED',
      severity: 'MEDIUM',
      sourceCategory: 'DELIVERY',
      actorId: userId,
      resource: signalId,
      details: { attempts: attemptNumber },
    });
  } else {
    nextStatus = 'RETRY_SCHEDULED';
    nextRetryAt = computeNextRetryIso(attemptNumber, result.retryAfterSec);
  }

  await env.DB.prepare(`
    UPDATE notification_deliveries
    SET status = ?,
        provider_message_id = COALESCE(?, provider_message_id),
        delivered_at = COALESCE(?, delivered_at),
        last_error = ?,
        last_http_status = ?,
        next_retry_at = ?
    WHERE signal_id = ? AND axnna_user_id = ? AND channel = 'TELEGRAM'
  `)
    .bind(
      nextStatus,
      result.providerMessageId,
      result.ok ? nowIso : null,
      result.error || null,
      result.httpStatus,
      nextRetryAt,
      signalId,
      userId
    )
    .run();

  return { ok: result.ok, status: nextStatus, error: result.error };
}

interface DeliverySignalRow {
  id: string;
  signal_id: string;
  axnna_user_id: string;
  destination: string;
  attempt_count: number | null;
  instrument: string;
  direction: 'LONG' | 'SHORT';
  entry: number | null;
  structural_stop: number | null;
  structural_target: number | null;
  structural_rr: number | null;
  technical_score: number | null;
  market_context: string | null;
}

function buildMessageFromSignalRow(row: DeliverySignalRow): string {
  let macroRegime = 'UNCERTAIN';
  let confluence = 'NEUTRAL';
  if (row.market_context) {
    try {
      const parsed = JSON.parse(row.market_context) as { macroRegime?: string; confluence?: string };
      if (parsed.macroRegime) macroRegime = parsed.macroRegime;
      if (parsed.confluence) confluence = parsed.confluence;
    } catch {
      // Keep defaults
    }
  }
  return formatSignalMessage(
    {
      setupId: row.signal_id,
      direction: row.direction,
      technicalScore: row.technical_score ?? 0,
      entryPrice: row.entry ?? undefined,
      stopLossPrice: row.structural_stop ?? undefined,
      structuralTargetPrice: row.structural_target ?? undefined,
    },
    row.instrument,
    row.structural_rr,
    macroRegime,
    confluence
  );
}

export async function deliverTelegramAlerts(
  env: Env,
  sig: CandidateSetup,
  instrument: string,
  rr: number | null,
  context: FundamentalContext,
  confluence: Confluence
): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_DELIVERY_SKIPPED: TELEGRAM_BOT_TOKEN not configured');
    return 0;
  }

  const globalToggle = (await env.DB.prepare(
    `SELECT value FROM system_config WHERE "key" = 'global_notifications_enabled'`
  ).first()) as { value?: string } | null;
  if (globalToggle?.value === 'false') {
    console.log('TELEGRAM_DELIVERY_PAUSED: global_notifications_enabled is false');
    return 0;
  }

  const { results: users } = await env.DB.prepare(
    `SELECT id, telegram_chat_id FROM axnna_users WHERE status = 'CONNECTED' AND signal_notifications_enabled = 1`
  ).all();

  if (!users || users.length === 0) return 0;

  const text = formatSignalMessage(sig, instrument, rr, context.macroRegime, confluence);
  let sentCount = 0;
  const nowIso = new Date().toISOString();

  for (const user of users as Array<{ id: string; telegram_chat_id: string }>) {
    const existing = (await env.DB.prepare(
      `SELECT status, attempt_count, next_retry_at FROM notification_deliveries WHERE signal_id = ? AND axnna_user_id = ? AND channel = 'TELEGRAM'`
    )
      .bind(sig.setupId, user.id)
      .first()) as { status?: string; attempt_count?: number; next_retry_at?: string | null } | null;

    if (
      existing?.status === 'SENT' ||
      existing?.status === 'PERMANENT_FAILURE' ||
      existing?.status === 'EXHAUSTED' ||
      existing?.status === 'SENDING'
    ) {
      continue;
    }

    if (existing?.status === 'RETRY_SCHEDULED' && existing.next_retry_at) {
      const nextRetryMs = parseUtcTimestampMs(existing.next_retry_at);
      if (nextRetryMs !== null && nextRetryMs > Date.now()) {
        continue;
      }
    }

    const priorAttempts = Number(existing?.attempt_count ?? 0);
    if (priorAttempts >= MAX_DELIVERY_ATTEMPTS) continue;

    const claimRes = await env.DB.prepare(`
      INSERT INTO notification_deliveries (
        id, signal_id, axnna_user_id, channel, destination, status, attempt_count, last_attempt_at
      )
      VALUES (?, ?, ?, 'TELEGRAM', ?, 'SENDING', 1, ?)
      ON CONFLICT(signal_id, axnna_user_id, channel) DO UPDATE SET
        status = 'SENDING',
        destination = excluded.destination,
        attempt_count = notification_deliveries.attempt_count + 1,
        last_attempt_at = excluded.last_attempt_at
      WHERE notification_deliveries.status IN ('PENDING', 'FAILED', 'RETRY_SCHEDULED')
        AND notification_deliveries.attempt_count < ?
        AND (notification_deliveries.next_retry_at IS NULL OR notification_deliveries.next_retry_at <= ?)
    `)
      .bind(crypto.randomUUID(), sig.setupId, user.id, user.telegram_chat_id, nowIso, MAX_DELIVERY_ATTEMPTS, nowIso)
      .run();

    if (Number(claimRes?.meta?.changes ?? 0) === 0) continue;

    const result = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_chat_id, text);
    const outcome = await finalizeClaimedDelivery(env, sig.setupId, user.id, priorAttempts + 1, result);
    if (outcome.ok) sentCount++;
  }

  if (sentCount > 0) {
    await env.DB.prepare(`UPDATE signals SET status = 'ALERTED' WHERE signal_id = ?`)
      .bind(sig.setupId)
      .run();
  }

  return sentCount;
}

export async function retryScheduledDeliveries(env: Env): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) return 0;

  const globalToggle = (await env.DB.prepare(
    `SELECT value FROM system_config WHERE "key" = 'global_notifications_enabled'`
  ).first()) as { value?: string } | null;
  if (globalToggle?.value === 'false') return 0;

  const nowIso = new Date().toISOString();
  const { results: dueRows } = await env.DB.prepare(`
    SELECT nd.id, nd.signal_id, nd.axnna_user_id, nd.destination, nd.attempt_count,
           s.instrument, s.direction, s.entry, s.structural_stop, s.structural_target, s.structural_rr, s.technical_score, s.market_context
    FROM notification_deliveries nd
    JOIN signals s ON s.signal_id = nd.signal_id
    JOIN axnna_users u ON u.id = nd.axnna_user_id
    WHERE nd.status = 'RETRY_SCHEDULED'
      AND (nd.next_retry_at IS NULL OR nd.next_retry_at <= ?)
      AND nd.attempt_count < ?
      AND u.status = 'CONNECTED'
      AND u.signal_notifications_enabled = 1
    LIMIT 25
  `)
    .bind(nowIso, MAX_DELIVERY_ATTEMPTS)
    .all();

  if (!dueRows || dueRows.length === 0) return 0;

  let retriedSuccess = 0;
  for (const row of dueRows as unknown as DeliverySignalRow[]) {
    const claimRes = await env.DB.prepare(`
      UPDATE notification_deliveries
      SET status = 'SENDING',
          attempt_count = attempt_count + 1,
          last_attempt_at = ?
      WHERE id = ? AND status = 'RETRY_SCHEDULED' AND (next_retry_at IS NULL OR next_retry_at <= ?) AND attempt_count < ?
    `)
      .bind(nowIso, row.id, nowIso, MAX_DELIVERY_ATTEMPTS)
      .run();

    if (Number(claimRes?.meta?.changes ?? 0) === 0) continue;

    const text = buildMessageFromSignalRow(row);
    const result = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, row.destination, text);
    const outcome = await finalizeClaimedDelivery(
      env,
      row.signal_id,
      row.axnna_user_id,
      Number(row.attempt_count ?? 0) + 1,
      result
    );
    if (outcome.ok) {
      retriedSuccess++;
      await env.DB.prepare(`UPDATE signals SET status = 'ALERTED' WHERE signal_id = ?`)
        .bind(row.signal_id)
        .run();
    }
  }

  return retriedSuccess;
}

async function buildDailyRecapText(env: Env, recapDate: string): Promise<string> {
  const startIso = `${recapDate}T00:00:00.000Z`;
  const endIso = `${recapDate}T23:59:59.999Z`;

  const { results: rows } = (await env.DB.prepare(
    `SELECT s.instrument,
            s.status,
            rd.decision as risk_decision,
            EXISTS (
              SELECT 1 FROM notification_deliveries nd
              WHERE nd.signal_id = s.signal_id AND nd.status = 'SENT'
            ) as has_sent_delivery
     FROM signals s
     LEFT JOIN risk_decisions rd ON rd.signal_id = s.signal_id
     WHERE s.generated_at >= ? AND s.generated_at <= ?`
  )
    .bind(startIso, endIso)
    .all()) as {
    results: Array<{ instrument: string; status: string; risk_decision?: string | null; has_sent_delivery?: number }>;
  };

  let total = 0;
  let alerted = 0;
  let suppressedOrPending = 0;
  let rejected = 0;
  const byInstrumentAlerted: Record<string, number> = {};

  for (const r of rows || []) {
    total++;
    const wasAlerted = r.status === 'ALERTED' || Number(r.has_sent_delivery ?? 0) === 1;
    if (wasAlerted) {
      alerted++;
      byInstrumentAlerted[r.instrument] = (byInstrumentAlerted[r.instrument] || 0) + 1;
    } else if (r.status === 'REJECTED' || r.risk_decision === 'REJECTED') {
      rejected++;
    } else if (r.status === 'ALERT_ELIGIBLE' || r.status === 'QUALIFIED') {
      suppressedOrPending++;
    }
  }

  if (total === 0 || (alerted === 0 && suppressedOrPending === 0)) {
    return [
      `AXNNA DAILY RECAP (${recapDate} UTC)`,
      `Alerted setups: 0`,
      `Candidates evaluated: ${total} (rejected: ${rejected})`,
      `Silence is a valid signal.`,
    ].join('\n');
  }

  const breakdown = Object.entries(byInstrumentAlerted)
    .map(([inst, cnt]) => `${inst}: ${cnt}`)
    .join(', ');

  return [
    `AXNNA DAILY RECAP (${recapDate} UTC)`,
    `Alerted setups: ${alerted}`,
    `Event-risk gated / unsent eligible: ${suppressedOrPending}`,
    `Total candidates evaluated: ${total} (rejected: ${rejected})`,
    breakdown ? `Alerted by instrument: ${breakdown}` : `Alerted by instrument: None`,
  ].join('\n');
}

export async function runDailyRecap(env: Env, targetDate?: string): Promise<number> {
  const leaseOwner = crypto.randomUUID();
  const lease = await acquireNamedLease(env.DB, 'DAILY_RECAP', leaseOwner, 5 * 60 * 1000);
  if (!lease.acquired) {
    return 0;
  }

  const job = await startJobRun(env.DB, 'DAILY_RECAP');
  const recapDate = targetDate || new Date().toISOString().slice(0, 10);

  try {
    if (!env.TELEGRAM_BOT_TOKEN) {
      await finishJobRun(env.DB, job.id, job.startedAtMs, 'FAILED', undefined, 'TELEGRAM_BOT_TOKEN not configured');
      return 0;
    }

    const globalToggle = (await env.DB.prepare(
      `SELECT value FROM system_config WHERE "key" = 'global_notifications_enabled'`
    ).first()) as { value?: string } | null;
    if (globalToggle?.value === 'false') {
      await finishJobRun(env.DB, job.id, job.startedAtMs, 'SUCCEEDED', 'Paused by global_notifications_enabled');
      return 0;
    }

    const { results: users } = await env.DB.prepare(
      `SELECT id, telegram_chat_id FROM axnna_users WHERE status = 'CONNECTED' AND signal_notifications_enabled = 1`
    ).all();

    if (!users || users.length === 0) {
      await finishJobRun(env.DB, job.id, job.startedAtMs, 'SUCCEEDED', 'No connected subscribers');
      return 0;
    }

    const text = await buildDailyRecapText(env, recapDate);
    let sentCount = 0;
    let skippedAlreadySent = 0;
    let failedCount = 0;
    let lastError: string | undefined;

    for (const user of users as Array<{ id: string; telegram_chat_id: string }>) {
      const existing = (await env.DB.prepare(
        `SELECT status FROM daily_recap_deliveries WHERE recap_date = ? AND axnna_user_id = ?`
      )
        .bind(recapDate, user.id)
        .first()) as { status?: string } | null;

      if (existing?.status === 'SENT') {
        skippedAlreadySent++;
        continue;
      }

      const claimRes = await env.DB.prepare(`
        INSERT INTO daily_recap_deliveries (
          id, recap_date, axnna_user_id, status, attempt_count
        )
        VALUES (?, ?, ?, 'SENDING', 1)
        ON CONFLICT(recap_date, axnna_user_id) DO UPDATE SET
          status = 'SENDING',
          attempt_count = daily_recap_deliveries.attempt_count + 1
        WHERE daily_recap_deliveries.status = 'FAILED'
      `)
        .bind(crypto.randomUUID(), recapDate, user.id)
        .run();

      if (Number(claimRes?.meta?.changes ?? 0) === 0) {
        continue;
      }

      const res = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_chat_id, text);
      const nextRetryAt = !res.ok ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await env.DB.prepare(`
        UPDATE daily_recap_deliveries
        SET status = ?,
            provider_message_id = COALESCE(?, provider_message_id),
            last_error = ?,
            next_retry_at = ?
        WHERE recap_date = ? AND axnna_user_id = ? AND status = 'SENDING'
      `)
        .bind(
          res.ok ? 'SENT' : 'FAILED',
          res.providerMessageId,
          res.ok ? null : res.error || 'Delivery failed',
          nextRetryAt,
          recapDate,
          user.id
        )
        .run();

      if (res.ok) {
        sentCount++;
      } else {
        failedCount++;
        lastError = res.error || 'Telegram send failed';
      }
    }

    const attemptedCount = sentCount + failedCount;
    let jobStatus: 'SUCCEEDED' | 'DEGRADED' | 'FAILED' = 'SUCCEEDED';
    if (attemptedCount > 0 && sentCount === 0 && skippedAlreadySent === 0) {
      jobStatus = 'FAILED';
    } else if (failedCount > 0) {
      jobStatus = 'DEGRADED';
    }

    await finishJobRun(
      env.DB,
      job.id,
      job.startedAtMs,
      jobStatus,
      `Recap ${recapDate}: sent=${sentCount}, failed=${failedCount}, alreadySent=${skippedAlreadySent}`,
      jobStatus === 'FAILED' ? lastError : undefined
    );
    return sentCount;
  } finally {
    await releaseNamedLease(env.DB, 'DAILY_RECAP', leaseOwner);
  }
}

export async function retryFailedDailyRecaps(env: Env, targetDate?: string): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) return 0;

  const globalToggle = (await env.DB.prepare(
    `SELECT value FROM system_config WHERE "key" = 'global_notifications_enabled'`
  ).first()) as { value?: string } | null;
  if (globalToggle?.value === 'false') return 0;

  const recapDate = targetDate || new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  let dueRows: Array<{ id: string; axnna_user_id: string; attempt_count: number; telegram_chat_id: string }> = [];
  try {
    const res = await env.DB.prepare(`
      SELECT d.id, d.axnna_user_id, d.attempt_count, u.telegram_chat_id
      FROM daily_recap_deliveries d
      JOIN axnna_users u ON u.id = d.axnna_user_id
      WHERE d.recap_date = ?
        AND d.status = 'FAILED'
        AND d.attempt_count < ?
        AND (d.next_retry_at IS NULL OR d.next_retry_at <= ?)
        AND u.status = 'CONNECTED'
        AND u.signal_notifications_enabled = 1
      LIMIT 25
    `)
      .bind(recapDate, MAX_RECAP_ATTEMPTS, nowIso)
      .all();
    dueRows = (res.results || []) as typeof dueRows;
  } catch {
    return 0;
  }

  if (dueRows.length === 0) return 0;

  const text = await buildDailyRecapText(env, recapDate);
  let recovered = 0;

  for (const row of dueRows) {
    const claimRes = await env.DB.prepare(`
      UPDATE daily_recap_deliveries
      SET status = 'SENDING', attempt_count = attempt_count + 1
      WHERE id = ? AND status = 'FAILED' AND (next_retry_at IS NULL OR next_retry_at <= ?)
    `)
      .bind(row.id, nowIso)
      .run();

    if (Number(claimRes?.meta?.changes ?? 0) === 0) continue;

    const sendRes = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, row.telegram_chat_id, text);
    const nextRetryAt = !sendRes.ok ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare(`
      UPDATE daily_recap_deliveries
      SET status = ?,
          provider_message_id = COALESCE(?, provider_message_id),
          last_error = ?,
          next_retry_at = ?
      WHERE id = ? AND status = 'SENDING'
    `)
      .bind(
        sendRes.ok ? 'SENT' : 'FAILED',
        sendRes.providerMessageId,
        sendRes.ok ? null : sendRes.error || 'Retry failed',
        nextRetryAt,
        row.id
      )
      .run();

    if (sendRes.ok) recovered++;
  }

  return recovered;
}

export async function handleCreateSession(
  request: Request,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const actorHash = await getRequestActorHash(request, env, 'telegram');
  const limitRes = await checkD1RateLimit(env.DB, `tg_session:${actorHash}`, 15, 3600);
  if (!limitRes.allowed) {
    return Response.json(
      { error: 'Too many connection requests. Please wait before trying again.' },
      { status: 429, headers: { ...headers, 'Retry-After': String(limitRes.retryAfterSec) } }
    );
  }

  const token = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO telegram_connection_sessions (id, connection_token, status, expires_at) VALUES (?, ?, 'PENDING', ?)`
  )
    .bind(sessionId, token, expiresAt)
    .run();

  return Response.json({ token, expiresAt }, { headers });
}

export async function handlePollSession(env: Env, url: URL, headers: Record<string, string>): Promise<Response> {
  const token = url.pathname.split('/').pop();
  if (!token) return new Response('Bad Request', { status: 400, headers });

  const session = (await env.DB.prepare(`
    SELECT s.id, s.status, s.expires_at, s.axnna_user_id, u.status AS user_status
    FROM telegram_connection_sessions s
    LEFT JOIN axnna_users u ON u.id = s.axnna_user_id
    WHERE s.connection_token = ?
  `)
    .bind(token)
    .first()) as {
    id?: string;
    status?: string;
    expires_at?: string;
    axnna_user_id?: string | null;
    user_status?: string | null;
  } | null;

  if (!session) {
    return Response.json({ status: 'NOT_FOUND' }, { status: 404, headers });
  }

  if (session.status === 'PENDING' && session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(
      `UPDATE telegram_connection_sessions SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'`
    )
      .bind(session.id)
      .run();
    return Response.json({ status: 'EXPIRED' }, { headers });
  }

  if (session.status === 'CANCELLED' || (session.status === 'CONNECTED' && session.user_status === 'DISCONNECTED')) {
    return Response.json({ status: 'DISCONNECTED' }, { headers });
  }

  if (session.status === 'CONNECTED' && session.axnna_user_id) {
    const reconnectAudit = await env.DB.prepare(`
      SELECT event_type
      FROM audit_events
      WHERE axnna_user_id = ?
        AND event_type = 'TELEGRAM_RECONNECT_ALREADY_CONNECTED'
        AND metadata LIKE ?
      LIMIT 1
    `)
      .bind(session.axnna_user_id, `%"sessionId":"${session.id}"%`)
      .first();
    if (reconnectAudit) {
      return Response.json({ status: 'CONNECTED', alreadyConnected: true }, { headers });
    }
  }

  return Response.json({ status: session.status }, { headers });
}

async function disconnectAxnnaUser(
  env: Env,
  axnnaUserId: string,
  telegramChatId: string | null,
  actorSource: 'TELEGRAM_WEBHOOK' | 'WEB_DISCONNECT',
  telegramNoticeText: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const updateRes = await env.DB.prepare(`
    UPDATE axnna_users
    SET status = 'DISCONNECTED',
        signal_notifications_enabled = 0,
        disconnected_at = ?,
        updated_at = ?
    WHERE id = ? AND status = 'CONNECTED'
  `)
    .bind(now, now, axnnaUserId)
    .run();

  if (Number(updateRes?.meta?.changes ?? 0) === 0) {
    return false;
  }

  await env.DB.prepare(`
    UPDATE telegram_connection_sessions
    SET status = 'CANCELLED'
    WHERE axnna_user_id = ? AND status = 'CONNECTED'
  `)
    .bind(axnnaUserId)
    .run();

  await env.DB.prepare(`
    INSERT INTO audit_events (event_id, event_type, axnna_user_id, actor_source)
    VALUES (?, 'TELEGRAM_DISCONNECTED', ?, ?)
  `)
    .bind(crypto.randomUUID(), axnnaUserId, actorSource)
    .run();

  if (telegramChatId && hasRealSecret(env.TELEGRAM_BOT_TOKEN)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, telegramChatId, telegramNoticeText);
  }

  return true;
}

export async function handleDisconnectSession(
  request: Request,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const parsed = await readJsonBodyWithLimit(request, 2048);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.status, headers });
  }

  const token = typeof parsed.data.token === 'string' ? parsed.data.token.trim() : '';
  if (!token || token.length > 128) {
    return Response.json({ error: 'Valid connection token is required.' }, { status: 400, headers });
  }

  const session = (await env.DB.prepare(`
    SELECT s.axnna_user_id, u.telegram_chat_id
    FROM telegram_connection_sessions s
    JOIN axnna_users u ON u.id = s.axnna_user_id
    WHERE s.connection_token = ? AND s.status = 'CONNECTED'
  `)
    .bind(token)
    .first()) as { axnna_user_id?: string; telegram_chat_id?: string | null } | null;

  if (session?.axnna_user_id) {
    await disconnectAxnnaUser(
      env,
      session.axnna_user_id,
      session.telegram_chat_id ?? null,
      'WEB_DISCONNECT',
      'Disconnected from Axnna via web. Signal notifications and Daily Recaps have been stopped.'
    );
  }

  return Response.json({ status: 'DISCONNECTED' }, { headers });
}

async function handleTelegramStatusCommand(
  env: Env,
  argStr: string,
  telegramUserId: string,
  chatId: string
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const user = (await env.DB.prepare(
    `SELECT id, status FROM axnna_users WHERE telegram_user_id = ? AND status = 'CONNECTED'`
  )
    .bind(telegramUserId)
    .first()) as { id?: string } | null;

  if (!user) return;

  const arg = argStr.split(/\s+/)[0]?.toUpperCase() || '';
  const instrument = isSupportedInstrument(arg) ? arg : 'EURUSD';

  const { context: ctx } = await evaluateInstrumentFundamentalContext(env.DB, instrument);

  const latestSignal = (await env.DB.prepare(
    `SELECT direction, status, technical_score, generated_at FROM signals WHERE instrument = ? ORDER BY generated_at DESC LIMIT 1`
  )
    .bind(instrument)
    .first()) as { direction?: string; status?: string; technical_score?: number; generated_at?: string } | null;

  const reply = [
    `AXNNA STATUS: ${instrument}`,
    `Macro Regime: ${ctx.macroRegime} | Event Risk: ${ctx.eventRisk}`,
    latestSignal
      ? `Latest Setup: ${latestSignal.direction} (${latestSignal.status}, Score ${latestSignal.technical_score ?? 0}/100)`
      : `Latest Setup: None recorded yet`,
  ].join('\n');

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply);
}

async function handleTelegramRecapCommand(env: Env, telegramUserId: string, chatId: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const user = (await env.DB.prepare(
    `SELECT id, status FROM axnna_users WHERE telegram_user_id = ? AND status = 'CONNECTED'`
  )
    .bind(telegramUserId)
    .first()) as { id?: string } | null;

  if (!user) return;

  const today = new Date().toISOString().slice(0, 10);
  const text = await buildDailyRecapText(env, today);
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

async function handleTelegramBareStartCommand(env: Env, telegramUserId: string, chatId: string): Promise<void> {
  if (!hasRealSecret(env.TELEGRAM_BOT_TOKEN)) return;

  const user = (await env.DB.prepare(
    `SELECT status FROM axnna_users WHERE telegram_user_id = ?`
  )
    .bind(telegramUserId)
    .first()) as { status?: string } | null;

  const text =
    user?.status === 'CONNECTED'
      ? 'You are already connected to Axnna. Signal notifications are active.\nCommands: /status [PAIR], /recap, /disconnect'
      : 'Welcome to Axnna. Open https://axnna.madede.workers.dev/connect-telegram to link your Telegram account.';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

async function handleTelegramDisconnectCommand(env: Env, telegramUserId: string, chatId: string): Promise<void> {
  const user = (await env.DB.prepare(
    `SELECT id, status FROM axnna_users WHERE telegram_user_id = ?`
  )
    .bind(telegramUserId)
    .first()) as { id?: string; status?: string } | null;

  if (!user?.id || user.status !== 'CONNECTED') {
    if (hasRealSecret(env.TELEGRAM_BOT_TOKEN)) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'Your Telegram account is not currently connected to Axnna.'
      );
    }
    return;
  }

  await disconnectAxnnaUser(
    env,
    user.id,
    chatId,
    'TELEGRAM_WEBHOOK',
    'Disconnected from Axnna. Signal alerts and Daily Recaps have been stopped. Reconnect anytime at /connect-telegram.'
  );
}

async function processTelegramConnection(
  env: Env,
  token: string,
  from: TelegramUserIdentity,
  chat: TelegramChatRef
): Promise<void> {
  const session = (await env.DB.prepare(
    `SELECT id, status, expires_at FROM telegram_connection_sessions WHERE connection_token = ?`
  )
    .bind(token)
    .first()) as { id?: string; status?: string; expires_at?: string } | null;

  if (!session || session.status !== 'PENDING') {
    return;
  }

  if (!session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(
      `UPDATE telegram_connection_sessions SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'`
    )
      .bind(session.id)
      .run();
    return;
  }

  const userId = crypto.randomUUID();
  const telegramUserId = String(from.id);
  const telegramChatId = String(chat.id);
  const username = typeof from.username === 'string' ? from.username : null;
  const firstName = typeof from.first_name === 'string' ? from.first_name : null;
  const lastName = typeof from.last_name === 'string' ? from.last_name : null;
  const now = new Date().toISOString();

  const existing = (await env.DB.prepare(`SELECT id, status FROM axnna_users WHERE telegram_user_id = ?`)
    .bind(telegramUserId)
    .first()) as { id?: string; status?: string } | null;

  const wasAlreadyConnected = existing?.status === 'CONNECTED';
  let axnnaUserId: string = userId;
  if (existing && typeof existing.id === 'string') {
    axnnaUserId = existing.id;
    await env.DB.prepare(`
      UPDATE axnna_users
      SET status = 'CONNECTED',
          signal_notifications_enabled = 1,
          disconnected_at = NULL,
          telegram_chat_id = ?,
          telegram_username_snapshot = ?,
          telegram_first_name_snapshot = ?,
          telegram_last_name_snapshot = ?,
          last_seen_at = ?,
          updated_at = ?
      WHERE telegram_user_id = ?
    `)
      .bind(telegramChatId, username, firstName, lastName, now, now, telegramUserId)
      .run();
  } else {
    await env.DB.prepare(`
      INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, telegram_username_snapshot, telegram_first_name_snapshot, telegram_last_name_snapshot, status, connected_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'CONNECTED', ?, ?, ?)
    `)
      .bind(axnnaUserId, telegramUserId, telegramChatId, username, firstName, lastName, now, now, now)
      .run();
  }

  const claimRes = await env.DB.prepare(`
    UPDATE telegram_connection_sessions
    SET status = 'CONNECTED', axnna_user_id = ?
    WHERE id = ? AND status = 'PENDING'
  `)
    .bind(axnnaUserId, session.id)
    .run();

  if (Number(claimRes?.meta?.changes ?? 0) === 0) {
    return;
  }

  await env.DB.prepare(`
    INSERT INTO audit_events (event_id, event_type, axnna_user_id, actor_source, metadata)
    VALUES (?, ?, ?, 'TELEGRAM_WEBHOOK', ?)
  `)
    .bind(
      crypto.randomUUID(),
      wasAlreadyConnected ? 'TELEGRAM_RECONNECT_ALREADY_CONNECTED' : 'TELEGRAM_CONNECTION_COMPLETED',
      axnnaUserId,
      JSON.stringify({ sessionId: session.id, alreadyConnected: wasAlreadyConnected })
    )
    .run();

  if (hasRealSecret(env.TELEGRAM_BOT_TOKEN)) {
    const welcomeText = wasAlreadyConnected
      ? 'You are already connected to Axnna. Signal notifications are active.\nCommands: /status [PAIR], /recap, /disconnect'
      : 'Connected to Axnna! Signal notifications and Daily Recaps are now active.\nCommands: /status [PAIR], /recap, /disconnect';
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, telegramChatId, welcomeText);
  }
}

export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  const expectedSecret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!expectedSecret) {
    return Response.json({ error: 'Telegram webhook secret is not configured.' }, { status: 503 });
  }

  const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  const validSecret = await constantTimeSecretMatch(providedSecret, expectedSecret);
  if (!validSecret) {
    try {
      await env.DB.prepare(
        `INSERT INTO audit_events (event_id, event_type, actor_source) VALUES (?, 'TELEGRAM_WEBHOOK_UNAUTHORIZED', 'TELEGRAM_WEBHOOK')`
      )
        .bind(crypto.randomUUID())
        .run();
    } catch {
      // Ignore audit failure
    }
    await recordSecurityEvent(env.DB, {
      eventType: 'TELEGRAM_WEBHOOK_UNAUTHORIZED',
      severity: 'HIGH',
      sourceCategory: 'TELEGRAM_WEBHOOK',
      actorId: await getRequestActorHash(request, env, 'security'),
      resource: '/api/telegram/webhook',
    });
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedWebhook = await readJsonBodyWithLimit(request, 65536);
  if (!parsedWebhook.ok) {
    if (parsedWebhook.status === 400) {
      await recordSecurityEvent(env.DB, {
        eventType: 'TELEGRAM_WEBHOOK_MALFORMED_JSON',
        severity: 'LOW',
        sourceCategory: 'TELEGRAM_WEBHOOK',
        resource: '/api/telegram/webhook',
      });
    }
    return Response.json({ error: parsedWebhook.error }, { status: parsedWebhook.status });
  }
  const update = parsedWebhook.data;
  const message = update.message as { text?: unknown; from?: TelegramUserIdentity; chat?: TelegramChatRef } | undefined;

  if (!message || typeof message !== 'object' || typeof message.text !== 'string') {
    return Response.json({ ok: true, ignored: true }, { status: 200 });
  }

  const from = message.from;
  const chat = message.chat;
  const isValidId = (val: unknown): val is number | string =>
    (typeof val === 'number' && Number.isSafeInteger(val) && val !== 0) ||
    (typeof val === 'string' && /^-?\d+$/.test(val));

  if (!from || !chat || !isValidId(from.id) || !isValidId(chat.id)) {
    await recordSecurityEvent(env.DB, {
      eventType: 'TELEGRAM_WEBHOOK_INVALID_SENDER',
      severity: 'MEDIUM',
      sourceCategory: 'TELEGRAM_WEBHOOK',
      resource: '/api/telegram/webhook',
    });
    return Response.json({ error: 'Invalid Telegram sender or chat identifier' }, { status: 400 });
  }

  const text = message.text.trim();
  const cmdMatch = text.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+(.*))?$/i);
  if (cmdMatch) {
    const command = cmdMatch[1].toLowerCase();
    const argStr = (cmdMatch[2] || '').trim();
    if (command === 'start' && argStr) {
      const token = argStr.split(/\s+/)[0];
      if (token && token.length <= 128) {
        await processTelegramConnection(env, token, from, chat);
      }
    } else if (
      command === 'start' ||
      command === 'status' ||
      command === 'recap' ||
      command === 'disconnect' ||
      command === 'stop'
    ) {
      const cmdRate = await checkD1RateLimit(env.DB, `tg_cmd:${String(from.id)}`, 10, 300);
      if (!cmdRate.allowed) {
        await recordSecurityEvent(env.DB, {
          eventType: 'TELEGRAM_COMMAND_RATE_LIMITED',
          severity: 'LOW',
          sourceCategory: 'RATE_LIMIT',
          actorId: await getRequestActorHash(request, env, 'telegram'),
          resource: `/${command}`,
        });
        return Response.json({ ok: true, rateLimited: true }, { status: 200 });
      }
      if (command === 'start') {
        await handleTelegramBareStartCommand(env, String(from.id), String(chat.id));
      } else if (command === 'status') {
        await handleTelegramStatusCommand(env, argStr, String(from.id), String(chat.id));
      } else if (command === 'recap') {
        await handleTelegramRecapCommand(env, String(from.id), String(chat.id));
      } else {
        await handleTelegramDisconnectCommand(env, String(from.id), String(chat.id));
      }
    }
  }

  return Response.json({ ok: true }, { status: 200 });
}
