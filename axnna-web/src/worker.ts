import { StrategyEngine, DEFAULT_STRATEGY_VERSION } from './core-engine/StrategyEngine';
import { CandidateSetup } from './core-engine/Types';
import { MarketDataValidator, InternalCandle } from './core-engine/MarketData';
import { TwelveDataMarketProvider } from './providers/MarketProvider';
import { EconomicEvent, FreeEconomicCalendarProvider } from './providers/FundamentalProvider';
import { Confluence, FundamentalContext, FundamentalEngine } from './engine/FundamentalEngine';
import { evaluateRiskGate } from './engine/RiskGate';
import { evaluateOpenPaperTrades, registerPaperTradeFromApprovedSignal } from './engine/PaperTradingEngine';
import { constantTimeSecretMatch } from './utils/crypto';
import { BacktestEngine, BacktestConfig } from './core-engine/BacktestEngine';
import {
  acquireNamedLease,
  acquireSyncLease,
  checkD1RateLimit,
  classifyUserAgent,
  evaluateSystemHealth,
  finishJobRun,
  getRequestActorHash,
  hasRealSecret,
  pruneOperationalTables,
  recordProviderHealth,
  recordSecurityEvent,
  releaseNamedLease,
  releaseSyncLease,
  startJobRun,
} from './ops/telemetry';
import { getMostRecentFxSessionCloseMs, isFxMarketClosedUtc, parseUtcTimestampMs, toSqliteUtcTimestamp } from './utils/time';

export interface SyncActionResult {
  status: 'SUCCEEDED' | 'DEGRADED' | 'FAILED' | 'ALREADY_RUNNING';
  summary?: string;
  error?: string;
}

export interface Env {
  DB: D1Database;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  ENVIRONMENT?: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TWELVEDATA_API_KEY: string;
  FINNHUB_API_KEY?: string;
  BACKTEST_SECRET?: string;
  ACTOR_HASH_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

const SUPPORTED_INSTRUMENTS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'] as const;
const SUPPORTED_TIMEFRAMES = ['5M', '1H'] as const;
const MAX_DELIVERY_ATTEMPTS = 5;
const MAX_RECAP_ATTEMPTS = 3;
const MIN_BACKTEST_LIMIT = 100;
const MAX_BACKTEST_LIMIT = 400;
const CLIENT_ANALYTICS_EVENTS = new Set(['PAGE_VIEW', 'TELEGRAM_CONNECT_STARTED']);
const STATIC_FILE_EXT_PATTERN = /\.(?:js|mjs|css|png|jpg|jpeg|webp|ico|svg|json|txt|woff|woff2|map)$/i;
const ALLOWED_CONTACT_CATEGORIES = new Set([
  'General Inquiry',
  'Bug Report',
  'Feature Request',
  'Account Assistance',
]);

function isOriginAllowed(origin: string | null, url: URL, env: Env): boolean {
  if (!origin) return false;
  if (origin === url.origin) return true;

  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return true;

  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (isLocal && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }

  return false;
}

export function buildCorsHeaders(request: Request, url: URL, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    Vary: 'Origin',
  };

  if (isOriginAllowed(origin, url, env)) {
    headers['Access-Control-Allow-Origin'] = origin!;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

function sanitizeErrorMessage(err: unknown, botToken?: string): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown error');
  const cleaned = botToken ? raw.split(botToken).join('[REDACTED]') : raw;
  return cleaned.slice(0, 300);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request, url, env);

    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (origin && !isOriginAllowed(origin, url, env)) {
        return new Response('Forbidden Origin', { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/api/status' && request.method === 'GET') {
      return await handlePublicStatus(env, corsHeaders);
    }

    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      return await handleContactSubmission(request, env, corsHeaders);
    }

    if (url.pathname === '/api/analytics/event' && request.method === 'POST') {
      return await handleAnalyticsIngest(request, env, corsHeaders);
    }

    if (url.pathname === '/api/telegram/session' && request.method === 'POST') {
      return await handleCreateSession(env, corsHeaders);
    }
    if (url.pathname.startsWith('/api/telegram/session/') && request.method === 'GET') {
      return await handlePollSession(env, url, corsHeaders);
    }
    if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') {
      return await handleTelegramWebhook(request, env);
    }

    if (url.pathname.startsWith('/api/fundamentals/') && request.method === 'GET') {
      const instrument = (url.pathname.split('/').pop() || '').toUpperCase();
      if (!SUPPORTED_INSTRUMENTS.includes(instrument as any)) {
        return Response.json({ error: 'Unsupported instrument' }, { status: 400, headers: corsHeaders });
      }
      const { context } = await evaluateInstrumentFundamentalContext(env.DB, instrument);
      return Response.json(context, { headers: corsHeaders });
    }

    if (url.pathname === '/api/dev/backtest' && request.method === 'POST') {
      return await handleBacktestRun(request, env, corsHeaders);
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not Found' }, { status: 404, headers: corsHeaders });
    }

    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      const expectsStaticFile =
        url.pathname.startsWith('/assets/') || STATIC_FILE_EXT_PATTERN.test(url.pathname);
      if (expectsStaticFile && assetRes.status === 200) {
        const ct = assetRes.headers.get('Content-Type') || '';
        if (ct.includes('text/html')) {
          return new Response('Not Found', { status: 404, headers: corsHeaders });
        }
      }
      return assetRes;
    }

    return new Response('Axnna API Active', { headers: corsHeaders });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 21 * * *') {
      ctx.waitUntil(
        (async () => {
          await runDailyRecap(env);
          await pruneOperationalTables(env.DB);
        })()
      );
      return;
    }
    if (event.cron === '2 * * * *') {
      ctx.waitUntil(this.runSynchronization(env, 'CRON_1H_SYNC', { mode: '1H_ONLY' }));
      return;
    }
    ctx.waitUntil(this.runSynchronization(env, 'CRON_SYNC', { mode: '5M_AND_STRATEGY' }));
  },

  async runSynchronization(
    env: Env,
    jobName: string = 'CRON_SYNC',
    options?: { mode?: 'FULL' | '5M_AND_STRATEGY' | '1H_ONLY' }
  ): Promise<SyncActionResult> {
    const mode = options?.mode ?? 'FULL';
    const leaseOwner = crypto.randomUUID();
    const lease = await acquireSyncLease(env.DB, leaseOwner, 5 * 60 * 1000);
    if (!lease.acquired) {
      return {
        status: 'ALREADY_RUNNING',
        error: 'Synchronization is already executing.',
      };
    }

    const job = await startJobRun(env.DB, jobName);
    let hasPartialFailure = false;
    let calendarCount = 0;

    try {
      if (mode !== '1H_ONLY') {
        const calState = await env.DB.prepare(
          `SELECT status, last_successful_sync FROM provider_health_state WHERE service_type = 'ECONOMIC_CALENDAR' LIMIT 1`
        ).first() as { status?: string; last_successful_sync?: string | null } | null;
        const lastCalSuccessMs = parseUtcTimestampMs(calState?.last_successful_sync);
        const calendarFresh =
          calState?.status === 'HEALTHY' &&
          lastCalSuccessMs !== null &&
          Date.now() - lastCalSuccessMs < 25 * 60 * 1000;

        if (!calendarFresh) {
          console.log('ECONOMIC_SYNC_STARTED');
          const fundamentalProvider = new FreeEconomicCalendarProvider();
          try {
            const events = await fundamentalProvider.fetchUpcomingEvents('USD,EUR,GBP,JPY', 'today', 'tomorrow');
            if (events.length > 0) {
              const ids = events.map((ev) => ev.id);
              const existingMap = new Map<string, { actual: string | null; estimate: string | null }>();
              const minTs = events.reduce((m, ev) => (ev.timestamp < m ? ev.timestamp : m), events[0].timestamp);
              const { results: existingRows } = await env.DB.prepare(
                `SELECT id, actual, estimate FROM economic_events WHERE timestamp >= ?`
              ).bind(minTs).all() as { results: Array<{ id: string; actual: string | null; estimate: string | null }> };
              for (const row of existingRows || []) {
                existingMap.set(row.id, { actual: row.actual ?? null, estimate: row.estimate ?? null });
              }

              const changedStmts: D1PreparedStatement[] = [];
              for (const ev of events) {
                if (!ids.includes(ev.id)) continue;
                const prev = existingMap.get(ev.id);
                const nextActual = ev.actual ?? null;
                const nextEstimate = ev.estimate ?? null;
                if (prev && prev.actual === nextActual && prev.estimate === nextEstimate) {
                  continue;
                }
                changedStmts.push(
                  env.DB.prepare(`
                    INSERT INTO economic_events (id, country, currency, event, timestamp, importance, estimate, previous, actual, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      actual = excluded.actual,
                      estimate = excluded.estimate,
                      updated_at = CURRENT_TIMESTAMP
                  `).bind(ev.id, ev.country, ev.currency, ev.event, ev.timestamp, ev.importance, nextEstimate, ev.previous, nextActual, ev.source)
                );
              }
              const CAL_BATCH = 50;
              for (let idx = 0; idx < changedStmts.length; idx += CAL_BATCH) {
                await env.DB.batch(changedStmts.slice(idx, idx + CAL_BATCH));
              }
            }
            calendarCount = events.length;
            await recordProviderHealth(env.DB, fundamentalProvider.name, 'ECONOMIC_CALENDAR', 'HEALTHY');
            console.log('ECONOMIC_SYNC_COMPLETED');
          } catch (error) {
            hasPartialFailure = true;
            await recordProviderHealth(env.DB, fundamentalProvider.name, 'ECONOMIC_CALENDAR', 'DEGRADED');
            console.log('ECONOMIC_SYNC_FAILED', sanitizeErrorMessage(error));
          }
        }
      }

      const apiKey = (env.TWELVEDATA_API_KEY || '').trim();
      if (!hasRealSecret(apiKey)) {
        const cfgErr = 'TWELVEDATA_API_KEY missing or placeholder';
        console.error('MARKET_SYNC_CONFIG_ERROR: TWELVEDATA_API_KEY is missing or placeholder');
        const tfsToMark = mode === '1H_ONLY' ? (['1H'] as const) : mode === '5M_AND_STRATEGY' ? (['5M'] as const) : SUPPORTED_TIMEFRAMES;
        for (const inst of SUPPORTED_INSTRUMENTS) {
          for (const tf of tfsToMark) {
            await markMarketDataFailed(env, inst, tf, 'twelvedata');
          }
        }
        await recordProviderHealth(env.DB, 'twelvedata', 'MARKET_DATA', 'FAILED');
        await finishJobRun(env.DB, job.id, job.startedAtMs, 'FAILED', undefined, cfgErr);
        return { status: 'FAILED', error: cfgErr };
      }

      console.log('MARKET_SYNC_STARTED');
      const marketProvider = new TwelveDataMarketProvider(apiKey);
      let marketFailures = 0;
      const nowMs = Date.now();
      const fxClosed = isFxMarketClosedUtc(nowMs);
      const recentCloseMs = fxClosed ? getMostRecentFxSessionCloseMs(nowMs) : 0;
      const timeframesToCheck: readonly ('5M' | '1H')[] =
        mode === '1H_ONLY' ? ['1H'] : SUPPORTED_TIMEFRAMES;

      try {
        for (const inst of SUPPORTED_INSTRUMENTS) {
          let inst5mOk = false;

          for (const tf of timeframesToCheck) {
            try {
              const stateRow = await env.DB.prepare(
                `SELECT last_completed_candle, status FROM market_data_state WHERE instrument = ? AND timeframe = ?`
              ).bind(inst, tf).first() as { last_completed_candle?: string | null; status?: string } | null;
              const lastCandleMs = parseUtcTimestampMs(stateRow?.last_completed_candle);

              // Skip redundant 1H fetches: under 5M_AND_STRATEGY, rely on cron 2 * * * * unless 1H is missing or >2h stale
              if (tf === '1H' && mode !== '1H_ONLY') {
                const freshnessThresholdMs =
                  mode === '5M_AND_STRATEGY'
                    ? nowMs - 2 * 3_600_000
                    : Math.floor(nowMs / 3_600_000) * 3_600_000 - 3_600_000;
                if (stateRow?.status === 'HEALTHY' && lastCandleMs !== null && lastCandleMs >= freshnessThresholdMs) {
                  const cached1hCount = await env.DB.prepare(
                    `SELECT COUNT(*) as cnt FROM market_candles WHERE instrument = ? AND timeframe = '1H'`
                  ).bind(inst).first() as { cnt?: number } | null;
                  if (Number(cached1hCount?.cnt ?? 0) >= 20) {
                    continue;
                  }
                }
              }

              // Skip TwelveData calls over weekend FX closure once Friday close candle is already stored
              if (fxClosed && stateRow?.status === 'HEALTHY' && lastCandleMs !== null && lastCandleMs >= recentCloseMs - 35 * 60 * 1000) {
                const cachedCountRow = await env.DB.prepare(
                  `SELECT COUNT(*) as cnt FROM market_candles WHERE instrument = ? AND timeframe = ?`
                ).bind(inst, tf).first() as { cnt?: number } | null;
                if (Number(cachedCountRow?.cnt ?? 0) >= 20) {
                  if (tf === '5M') {
                    inst5mOk = true;
                  }
                  continue;
                }
              }

              const candles = await marketProvider.fetchCandles(inst, tf, 100);
              const { valid, candles: validCandles, error } = MarketDataValidator.validateAndNormalize(candles);

              if (!valid) {
                marketFailures++;
                hasPartialFailure = true;
                console.warn(`Data validation failed for ${inst} ${tf}: ${error}`);
                await markMarketDataFailed(env, inst, tf, marketProvider.name);
                continue;
              }

              // Delta-only persistence: read existing timestamps (cheap D1 read) and INSERT OR IGNORE only new bars
              const { results: existingCandleRows } = await env.DB.prepare(
                `SELECT timestamp FROM market_candles WHERE instrument = ? AND timeframe = ? ORDER BY timestamp DESC LIMIT 150`
              ).bind(inst, tf).all() as { results: Array<{ timestamp: string }> };
              const existingTsSet = new Set((existingCandleRows || []).map((r) => String(r.timestamp)));

              const newCandles = validCandles.filter((c) => !existingTsSet.has(new Date(c.timestamp).toISOString()));
              if (newCandles.length > 0) {
                const insertStmts: D1PreparedStatement[] = newCandles.map((c) => {
                  const isoTime = new Date(c.timestamp).toISOString();
                  const id = `${c.symbol}_${c.timeframe}_${c.timestamp}`;
                  return env.DB.prepare(`
                    INSERT OR IGNORE INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `).bind(id, inst, c.timeframe, isoTime, c.open, c.high, c.low, c.close, marketProvider.getProviderName());
                });

                const BATCH_CHUNK = 50;
                for (let idx = 0; idx < insertStmts.length; idx += BATCH_CHUNK) {
                  await env.DB.batch(insertStmts.slice(idx, idx + BATCH_CHUNK));
                }
              }

              await env.DB.prepare(`
                INSERT INTO market_data_state (instrument, timeframe, provider, last_completed_candle, last_successful_fetch, status)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'HEALTHY')
                ON CONFLICT(instrument, timeframe) DO UPDATE SET
                  last_completed_candle = excluded.last_completed_candle,
                  last_successful_fetch = CURRENT_TIMESTAMP,
                  status = 'HEALTHY',
                  error_count = 0,
                  updated_at = CURRENT_TIMESTAMP
              `).bind(inst, tf, marketProvider.name, new Date(validCandles[validCandles.length - 1].timestamp).toISOString()).run();

              if (tf === '5M') {
                inst5mOk = true;
              }
            } catch (e: any) {
              marketFailures++;
              hasPartialFailure = true;
              console.error(`Failed to fetch/store ${inst} ${tf}: ${sanitizeErrorMessage(e, apiKey)}`);
              await markMarketDataFailed(env, inst, tf, marketProvider.name);
            }
          }

          if (mode !== '1H_ONLY' && inst5mOk) {
            await evaluateOpenPaperTrades(env.DB, inst);
            await this.runStrategyEngine(env, inst);
          }
        }

        const totalFeeds = SUPPORTED_INSTRUMENTS.length * timeframesToCheck.length;
        const providerOutcome =
          marketFailures === 0 ? 'HEALTHY' : marketFailures === totalFeeds ? 'FAILED' : 'DEGRADED';
        await recordProviderHealth(env.DB, marketProvider.name, 'MARKET_DATA', providerOutcome);
        await retryScheduledDeliveries(env);
        await retryFailedDailyRecaps(env);

        const finalStatus =
          marketFailures === totalFeeds ? 'FAILED' : hasPartialFailure ? 'DEGRADED' : 'SUCCEEDED';
        const summary = `Calendar events: ${calendarCount}; market feed failures: ${marketFailures}/${totalFeeds}`;
        await finishJobRun(env.DB, job.id, job.startedAtMs, finalStatus, summary);
        console.log('MARKET_SYNC_COMPLETED');
        return {
          status: finalStatus,
          summary,
          error: finalStatus === 'FAILED' ? `All ${totalFeeds} market data feeds failed.` : undefined,
        };
      } catch (error) {
        await recordProviderHealth(env.DB, marketProvider.name, 'MARKET_DATA', 'FAILED');
        const msg = sanitizeErrorMessage(error, apiKey);
        await finishJobRun(env.DB, job.id, job.startedAtMs, 'FAILED', undefined, msg);
        console.log('MARKET_SYNC_FAILED', msg);
        return { status: 'FAILED', error: msg };
      }
    } finally {
      await releaseSyncLease(env.DB, leaseOwner);
    }
  },

  async runStrategyEngine(env: Env, instrument: string) {
    const stratId = 'AXNNA_V1_LIQUIDITY_FVG';
    const stratVer = DEFAULT_STRATEGY_VERSION;

    const strategyRow = await env.DB.prepare(
      `SELECT active_status FROM strategies WHERE strategy_id = ?`
    ).bind(stratId).first();
    if (strategyRow && strategyRow.active_status && strategyRow.active_status !== 'ACTIVE') {
      console.log(`STRATEGY_DISABLED: ${stratId} (${strategyRow.active_status})`);
      return;
    }

    const engine = new StrategyEngine({
      htfTimeframe: '1H',
      ltfTimeframe: '5M',
      swingLengthHTF: 3,
      swingLengthLTF: 2,
      atrLength: 14,
      displacementSizeMultiplier: 1.5,
      displacementBodyRatio: 0.5,
      displacementCloseLocation: 0.5,
      fvgMinAtrRatio: 0.5,
      alertScoreThreshold: 65,
    });

    const stateRow = await env.DB.prepare(
      `SELECT last_processed_5m_timestamp, state_payload FROM strategy_state WHERE instrument = ? AND strategy_id = ? AND strategy_version = ?`
    ).bind(instrument, stratId, stratVer).first() as { last_processed_5m_timestamp?: string | null; state_payload?: string | null } | null;

    let restoredTs = 0;
    if (stateRow?.state_payload) {
      try {
        const parsed = JSON.parse(stateRow.state_payload);
        const restored = engine.restoreState(parsed, stratVer);
        if (restored.restored) {
          restoredTs = engine.getLastProcessedTimestamp();
        } else {
          console.warn(`STRATEGY_STATE_RESET (${instrument}): ${restored.reason}`);
        }
      } catch {
        console.warn(`STRATEGY_STATE_RESET (${instrument}): invalid JSON payload`);
      }
    }

    const { results: c5Raw } = await env.DB.prepare(
      `SELECT * FROM market_candles WHERE instrument = ? AND timeframe = '5M' ORDER BY timestamp DESC LIMIT 300`
    ).bind(instrument).all();

    const { results: c1Raw } = await env.DB.prepare(
      `SELECT * FROM market_candles WHERE instrument = ? AND timeframe = '1H' ORDER BY timestamp DESC LIMIT 200`
    ).bind(instrument).all();

    if (!c5Raw || !c1Raw || c5Raw.length === 0 || c1Raw.length === 0) return;

    const mapCandle = (c: any): InternalCandle => ({
      symbol: c.instrument,
      timeframe: c.timeframe,
      timestamp: new Date(c.timestamp).getTime(),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      isCompleted: true,
      priceBasis: 'provider_ohlc_unspecified',
    });

    const c5Chronological = [...c5Raw].reverse().map(mapCandle);
    const c1Chronological = [...c1Raw].reverse().map(mapCandle);

    const { setups: results, lastProcessed5mTimestamp } = engine.processIncremental(
      c1Chronological,
      c5Chronological,
      restoredTs
    );

    if (lastProcessed5mTimestamp > restoredTs || !stateRow) {
      const nextPayload = JSON.stringify(engine.exportState(stratVer));
      const isoLastTs = lastProcessed5mTimestamp > 0 ? new Date(lastProcessed5mTimestamp).toISOString() : null;
      await env.DB.prepare(`
        INSERT INTO strategy_state (instrument, strategy_id, strategy_version, last_processed_5m_timestamp, state_payload, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(instrument, strategy_id, strategy_version) DO UPDATE SET
          last_processed_5m_timestamp = excluded.last_processed_5m_timestamp,
          state_payload = excluded.state_payload,
          updated_at = CURRENT_TIMESTAMP
      `).bind(instrument, stratId, stratVer, isoLastTs, nextPayload).run();
    }

    if (results.length === 0) return;

    let fundamentalContext: FundamentalContext | null = null;
    const fundamentalEngine = new FundamentalEngine();
    if (results.some((sig) => sig.status === 'ALERT_ELIGIBLE')) {
      const evalRes = await evaluateInstrumentFundamentalContext(env.DB, instrument);
      fundamentalContext = evalRes.context;
    }

    const latestCompletedCandleMs = c5Chronological[c5Chronological.length - 1]?.timestamp ?? null;

    for (const sig of results) {
      const payload = JSON.stringify({
        htfBias: sig.htfBias,
        liquidity: sig.liquidityReference,
        sweep: sig.sweep,
        displacement: sig.displacement,
        fvg: sig.fvg,
        retracement: sig.retracement,
      });

      const entry = sig.entryPrice !== undefined ? sig.entryPrice : null;
      const stop = sig.stopLossPrice !== undefined ? sig.stopLossPrice : null;
      const target = sig.structuralTargetPrice !== undefined ? sig.structuralTargetPrice : null;

      let rr: number | null = null;
      if (entry !== null && stop !== null && target !== null && Math.abs(entry - stop) > 0) {
        rr = Math.abs(target - entry) / Math.abs(entry - stop);
      }

      await env.DB.prepare(`
        INSERT INTO signals (
          signal_id, strategy_id, strategy_version, instrument, direction,
          generated_at, anchor_timeframe, execution_timeframe,
          entry, structural_stop, structural_target, structural_rr,
          status, technical_score, rejection_reason, evidence_payload
        )
        VALUES (?, ?, ?, ?, ?, ?, '1H', '5M', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(signal_id) DO UPDATE SET
          status = CASE
                     WHEN signals.status IN ('QUALIFIED', 'ALERT_ELIGIBLE', 'REJECTED') THEN excluded.status
                     ELSE signals.status
                   END,
          technical_score = excluded.technical_score,
          rejection_reason = excluded.rejection_reason,
          evidence_payload = excluded.evidence_payload
      `).bind(
        sig.setupId, stratId, stratVer, instrument, sig.direction,
        new Date(sig.detectionTimestamp).toISOString(),
        entry, stop, target, rr,
        sig.status, sig.technicalScore || 0, sig.invalidationReason || null, payload
      ).run();

      console.log(`CANDIDATE_PROCESSED: ${instrument} ${sig.direction} (Setup: ${sig.setupId}) - Status: ${sig.status}`);

      if (sig.status === 'ALERT_ELIGIBLE' && fundamentalContext) {
        const confluence = fundamentalEngine.getConfluence(fundamentalContext, sig.direction);
        await env.DB.prepare(`UPDATE signals SET market_context = ? WHERE signal_id = ?`)
          .bind(JSON.stringify({ ...fundamentalContext, confluence }), sig.setupId)
          .run();

        const existingSentRow = await env.DB.prepare(
          `SELECT id FROM notification_deliveries WHERE signal_id = ? AND status = 'SENT' LIMIT 1`
        ).bind(sig.setupId).first();

        const riskDecision = evaluateRiskGate({
          signal: sig,
          instrument,
          expectedStrategyVersion: stratVer,
          alertScoreThreshold: 65,
          fundamentalContext,
          confluence,
          hasCompletedMarketData: c5Chronological.length > 0 && c1Chronological.length > 0,
          latestCompletedCandleMs,
          nowMs: Date.now(),
          maxMarketStalenessMs: 30 * 60 * 1000,
          requireFundamentalAvailability: true,
          alreadyAlerted: Boolean(existingSentRow),
        });

        let decisionPersisted = false;
        try {
          const insertRiskStmt = env.DB.prepare(
            `INSERT INTO risk_decisions (
               id, signal_id, instrument, direction, strategy_version, technical_score,
               decision, reason_code, reason_detail, event_risk, confluence
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(signal_id) DO UPDATE SET
               decision = excluded.decision,
               reason_code = excluded.reason_code,
               reason_detail = excluded.reason_detail,
               event_risk = excluded.event_risk,
               confluence = excluded.confluence`
          ).bind(
            crypto.randomUUID(),
            sig.setupId,
            instrument,
            sig.direction,
            stratVer,
            sig.technicalScore || 0,
            riskDecision.decision,
            riskDecision.reasonCode,
            riskDecision.reasonDetail,
            fundamentalContext.eventRisk,
            confluence
          );

          const insertAuditStmt = env.DB.prepare(
            `INSERT INTO audit_events (event_id, event_type, metadata, actor_source) VALUES (?, ?, ?, 'RISK_GATE')`
          ).bind(
            crypto.randomUUID(),
            riskDecision.decision === 'APPROVED' ? 'RISK_GATE_APPROVED' : 'RISK_GATE_REJECTED',
            JSON.stringify({
              signalId: sig.setupId,
              instrument,
              reasonCode: riskDecision.reasonCode,
              eventRisk: fundamentalContext.eventRisk,
            })
          );

          await env.DB.batch([insertRiskStmt, insertAuditStmt]);
          decisionPersisted = true;
        } catch (persistErr) {
          console.error(
            `RISK_DECISION_PERSIST_FAILED (${sig.setupId}): ${sanitizeErrorMessage(persistErr)}`
          );
          await recordSecurityEvent(env.DB, {
            eventType: 'RISK_DECISION_PERSIST_FAILED',
            severity: 'HIGH',
            sourceCategory: 'RISK_GATE',
            resource: sig.setupId,
            details: { instrument, error: sanitizeErrorMessage(persistErr).slice(0, 120) },
          });
        }

        if (!decisionPersisted) {
          // Fail closed: never deliver Telegram alerts or register paper trades without persisted Risk Gate audit
          continue;
        }

        if (riskDecision.decision === 'REJECTED') {
          if (riskDecision.reasonCode === 'HIGH_EVENT_RISK') {
            console.log(`ALERT_SUPPRESSED_EVENT_RISK: ${instrument} ${sig.direction} (Setup: ${sig.setupId})`);
          } else {
            console.log(
              `ALERT_SUPPRESSED_RISK_GATE: ${instrument} ${sig.direction} (Setup: ${sig.setupId}) - ${riskDecision.reasonCode}`
            );
          }
          await env.DB.prepare(`UPDATE signals SET rejection_reason = ? WHERE signal_id = ?`)
            .bind(riskDecision.reasonDetail, sig.setupId)
            .run();
        } else {
          await deliverTelegramAlerts(
            env,
            sig,
            instrument,
            riskDecision.computedRr ?? rr,
            fundamentalContext,
            confluence
          );
          await registerPaperTradeFromApprovedSignal(env.DB, sig, stratId);
        }
      }
    }
  },
};

async function handlePublicStatus(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const health = await evaluateSystemHealth(env);
    const safeOverall =
      health.overallStatus === 'HEALTHY'
        ? 'OPERATIONAL'
        : health.overallStatus === 'UNKNOWN'
          ? 'INITIALIZING'
          : 'DEGRADED';

    const sanitizeStatus = (s: string) =>
      s === 'HEALTHY' ? 'HEALTHY' : s === 'UNKNOWN' ? 'UNKNOWN' : s === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'DEGRADED';

    return Response.json(
      {
        overallStatus: safeOverall,
        checkedAt: new Date().toISOString(),
        monitoredInstruments: SUPPORTED_INSTRUMENTS,
        subsystems: health.subsystems.map((sub) => ({
          name: sub.name,
          status: sanitizeStatus(sub.status),
          lastUpdated: sub.lastUpdated,
        })),
      },
      {
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=15',
        },
      }
    );
  } catch {
    return Response.json(
      {
        overallStatus: 'DEGRADED',
        checkedAt: new Date().toISOString(),
        monitoredInstruments: SUPPORTED_INSTRUMENTS,
        subsystems: [],
      },
      { status: 503, headers: corsHeaders }
    );
  }
}

export async function readJsonBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> {
  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, status: 413, error: 'Payload too large.' };
    }
  }

  let rawText = '';
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let chunk = await reader.read();
    while (!chunk.done) {
      if (chunk.value) {
        totalBytes += chunk.value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Ignore stream cancel error
          }
          return { ok: false, status: 413, error: 'Payload too large.' };
        }
        rawText += decoder.decode(chunk.value, { stream: true });
      }
      chunk = await reader.read();
    }
    rawText += decoder.decode();
  } else {
    rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > maxBytes) {
      return { ok: false, status: 413, error: 'Payload too large.' };
    }
  }

  try {
    return { ok: true, data: JSON.parse(rawText) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body.' };
  }
}

async function handleContactSubmission(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const parsed = await readJsonBodyWithLimit(request, 8192);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.status, headers: corsHeaders });
  }
  const body = parsed.data;

  const category = typeof body?.category === 'string' ? body.category.trim() : '';
  if (!ALLOWED_CONTACT_CATEGORIES.has(category)) {
    return Response.json({ error: 'Invalid feedback category.' }, { status: 400, headers: corsHeaders });
  }

  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (message.length < 10 || message.length > 2000) {
    return Response.json(
      { error: 'Message must be between 10 and 2000 characters.' },
      { status: 400, headers: corsHeaders }
    );
  }

  const rawContact = typeof body?.contact === 'string' ? body.contact.trim() : '';
  let contactInfo: string | null = null;
  if (rawContact.length > 0) {
    if (rawContact.length > 120) {
      return Response.json({ error: 'Contact field is too long.' }, { status: 400, headers: corsHeaders });
    }
    if (rawContact.startsWith('@')) {
      if (!/^@[A-Za-z0-9_]{3,64}$/.test(rawContact)) {
        return Response.json({ error: 'Invalid Telegram username format.' }, { status: 400, headers: corsHeaders });
      }
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawContact)) {
      return Response.json(
        { error: 'Provide a valid email address or @telegram_username.' },
        { status: 400, headers: corsHeaders }
      );
    }
    contactInfo = rawContact;
  }

  // Honeypot anti-spam check
  if (typeof body?.website === 'string' && body.website.trim().length > 0) {
    return Response.json({ ok: true, id: crypto.randomUUID(), message: 'Feedback received.' }, { status: 201, headers: corsHeaders });
  }

  const clientHash = await getRequestActorHash(request, env, 'feedback');
  const oneHourAgoSql = toSqliteUtcTimestamp(Date.now() - 60 * 60 * 1000);
  const recentCountRow = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM contact_submissions WHERE client_hash = ? AND created_at >= ?`
  ).bind(clientHash, oneHourAgoSql).first() as { cnt?: number } | null;

  if (Number(recentCountRow?.cnt ?? 0) >= 3) {
    await recordSecurityEvent(env.DB, {
      eventType: 'CONTACT_RATE_LIMITED',
      severity: 'LOW',
      sourceCategory: 'RATE_LIMIT',
      actorId: await getRequestActorHash(request, env, 'security'),
      resource: '/api/feedback',
    });
    return Response.json(
      { error: 'Too many submissions. Please try again later.' },
      { status: 429, headers: corsHeaders }
    );
  }

  const dupRow = await env.DB.prepare(
    `SELECT id FROM contact_submissions WHERE client_hash = ? AND category = ? AND message = ? AND created_at >= ? LIMIT 1`
  ).bind(clientHash, category, message, oneHourAgoSql).first();
  if (dupRow) {
    return Response.json(
      { error: 'Duplicate submission already received.' },
      { status: 409, headers: corsHeaders }
    );
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO contact_submissions (id, category, message, contact_info, client_hash, status)
     VALUES (?, ?, ?, ?, ?, 'NEW')`
  ).bind(id, category, message, contactInfo, clientHash).run();

  return Response.json(
    {
      ok: true,
      id,
      message: 'Your message has been saved and queued for review.',
    },
    { status: 201, headers: corsHeaders }
  );
}

async function handleAnalyticsIngest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const parsed = await readJsonBodyWithLimit(request, 4096);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.status, headers: corsHeaders });
  }
  const body = parsed.data;

  const eventType = typeof body?.eventType === 'string' ? body.eventType.trim() : '';
  const pathVal = typeof body?.path === 'string' ? body.path.trim() : '';
  const visitorId = typeof body?.visitorId === 'string' ? body.visitorId.trim() : '';
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';

  if (
    !CLIENT_ANALYTICS_EVENTS.has(eventType) ||
    !/^\/[A-Za-z0-9/_-]{0,199}$/.test(pathVal) ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(visitorId) ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)
  ) {
    return Response.json({ error: 'Invalid or unsupported analytics payload.' }, { status: 400, headers: corsHeaders });
  }

  const actorHash = await getRequestActorHash(request, env, 'analytics');
  const rate = await checkD1RateLimit(env.DB, `analytics:${actorHash}`, 60, 3600);
  if (!rate.allowed) {
    await recordSecurityEvent(env.DB, {
      eventType: 'ANALYTICS_RATE_LIMITED',
      severity: 'LOW',
      sourceCategory: 'RATE_LIMIT',
      actorId: await getRequestActorHash(request, env, 'security'),
      resource: '/api/analytics/event',
    });
    return Response.json(
      { error: 'Analytics rate limit exceeded.' },
      { status: 429, headers: { ...corsHeaders, 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  // Prevent unique-visitor metric inflation by bounding distinct visitorIds per IP per hour
  const oneHourAgoSql = toSqliteUtcTimestamp(Date.now() - 60 * 60 * 1000);
  const vidBucketKey = `analytics_vid:${actorHash}:${visitorId}`;
  const existingVidBucket = await env.DB.prepare(
    `SELECT bucket_key FROM rate_limit_counters WHERE bucket_key = ? AND window_start >= ?`
  ).bind(vidBucketKey, oneHourAgoSql).first();
  if (!existingVidBucket) {
    const distinctCount = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM rate_limit_counters WHERE bucket_key LIKE ? AND window_start >= ?`
    ).bind(`analytics_vid:${actorHash}:%`, oneHourAgoSql).first() as { cnt?: number } | null;
    if (Number(distinctCount?.cnt ?? 0) >= 5) {
      await recordSecurityEvent(env.DB, {
        eventType: 'ANALYTICS_VISITOR_INFLATION_BLOCKED',
        severity: 'MEDIUM',
        sourceCategory: 'RATE_LIMIT',
        actorId: await getRequestActorHash(request, env, 'security'),
        resource: '/api/analytics/event',
      });
      return Response.json({ error: 'Too many visitor identities for client.' }, { status: 429, headers: corsHeaders });
    }
    await checkD1RateLimit(env.DB, vidBucketKey, 1000, 3600);
  }

  // Deduplicate rapid double-emits for the same visitor/session/event/path within 10s
  const tenSecAgoSql = toSqliteUtcTimestamp(Date.now() - 10 * 1000);
  const recentDup = await env.DB.prepare(
    `SELECT id FROM analytics_events
     WHERE visitor_id = ? AND session_id = ? AND event_type = ? AND path = ? AND created_at >= ?
     LIMIT 1`
  ).bind(visitorId, sessionId, eventType, pathVal, tenSecAgoSql).first();
  if (recentDup) {
    return Response.json({ ok: true, deduplicated: true }, { status: 202, headers: corsHeaders });
  }

  let referrerHost: string | null = null;
  if (typeof body?.referrer === 'string' && body.referrer.trim().length > 0) {
    const rawRef = body.referrer.trim();
    if (rawRef.length > 512) {
      return Response.json({ error: 'Referrer URL is too long.' }, { status: 400, headers: corsHeaders });
    }
    try {
      const parsedRef = new URL(rawRef);
      if (parsedRef.protocol !== 'http:' && parsedRef.protocol !== 'https:') {
        return Response.json({ error: 'Invalid referrer protocol.' }, { status: 400, headers: corsHeaders });
      }
      referrerHost = parsedRef.hostname.slice(0, 120);
    } catch {
      return Response.json({ error: 'Malformed referrer URL.' }, { status: 400, headers: corsHeaders });
    }
  }

  let utmSource: string | null = null;
  if (typeof body?.utmSource === 'string' && body.utmSource.trim().length > 0) {
    const rawUtm = body.utmSource.trim();
    if (!/^[A-Za-z0-9._-]{1,60}$/.test(rawUtm)) {
      return Response.json({ error: 'Invalid utmSource format.' }, { status: 400, headers: corsHeaders });
    }
    utmSource = rawUtm;
  }

  const { deviceCategory, browserCategory } = classifyUserAgent(request.headers.get('User-Agent'));
  const cfCountry = (request as any)?.cf?.country;
  const countryCode = typeof cfCountry === 'string' && /^[A-Z]{2}$/.test(cfCountry) ? cfCountry : null;

  await env.DB.prepare(
    `INSERT INTO analytics_events (
       id, visitor_id, session_id, event_type, path, referrer, utm_source,
       device_category, browser_category, country_code
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      visitorId,
      sessionId,
      eventType,
      pathVal,
      referrerHost,
      utmSource,
      deviceCategory,
      browserCategory,
      countryCode
    )
    .run();

  return Response.json({ ok: true }, { status: 202, headers: corsHeaders });
}

async function markMarketDataFailed(env: Env, instrument: string, timeframe: string, provider: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO market_data_state (instrument, timeframe, provider, status, error_count)
    VALUES (?, ?, ?, 'FAILED', 1)
    ON CONFLICT(instrument, timeframe) DO UPDATE SET
      status = 'FAILED',
      error_count = error_count + 1,
      updated_at = CURRENT_TIMESTAMP
  `).bind(instrument, timeframe, provider).run();
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

    const body: any = await res.json().catch(() => null);
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
  `).bind(
    nextStatus,
    result.providerMessageId,
    result.ok ? nowIso : null,
    result.error || null,
    result.httpStatus,
    nextRetryAt,
    signalId,
    userId
  ).run();

  return { ok: result.ok, status: nextStatus, error: result.error };
}

function buildMessageFromSignalRow(row: any): string {
  let macroRegime = 'UNCERTAIN';
  let confluence = 'NEUTRAL';
  if (row.market_context) {
    try {
      const parsed = JSON.parse(row.market_context);
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
      technicalScore: row.technical_score,
      entryPrice: row.entry,
      stopLossPrice: row.structural_stop,
      structuralTargetPrice: row.structural_target,
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

  const globalToggle = await env.DB.prepare(
    `SELECT value FROM system_config WHERE "key" = 'global_notifications_enabled'`
  ).first();
  if (globalToggle?.value === 'false') {
    console.log('TELEGRAM_DELIVERY_PAUSED: global_notifications_enabled is false');
    return 0;
  }

  const { results: users } = await env.DB.prepare(
    `SELECT id, telegram_chat_id FROM axnna_users WHERE status = 'CONNECTED' AND signal_notifications_enabled = 1`
  ).all();

  if (!users || users.length === 0) return 0;

  const text = formatSignalMessage(sig, instrument, rr, context.macroRegime, confluence);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let sentCount = 0;

  for (const user of users as Array<{ id: string; telegram_chat_id: string }>) {
    const existing = await env.DB.prepare(
      `SELECT id, status, attempt_count, next_retry_at FROM notification_deliveries WHERE signal_id = ? AND axnna_user_id = ? AND channel = 'TELEGRAM'`
    ).bind(sig.setupId, user.id).first() as {
      id?: string;
      status?: string;
      attempt_count?: number;
      next_retry_at?: string | null;
    } | null;

    if (
      existing?.status === 'SENT' ||
      existing?.status === 'SENDING' ||
      existing?.status === 'PERMANENT_FAILURE' ||
      existing?.status === 'EXHAUSTED'
    ) {
      continue;
    }

    if (existing?.status === 'RETRY_SCHEDULED' && existing.next_retry_at) {
      const retryAtMs = new Date(existing.next_retry_at).getTime();
      if (!isNaN(retryAtMs) && retryAtMs > nowMs) continue;
    }

    const priorAttempts = Number(existing?.attempt_count ?? 0);
    if (priorAttempts >= MAX_DELIVERY_ATTEMPTS) continue;

    let claimed = false;
    if (existing) {
      const claimRes = await env.DB.prepare(`
        UPDATE notification_deliveries
        SET status = 'SENDING',
            attempt_count = attempt_count + 1,
            last_attempt_at = ?
        WHERE id = ? AND status IN ('RETRY_SCHEDULED', 'FAILED', 'PENDING') AND attempt_count < ?
      `).bind(nowIso, existing.id, MAX_DELIVERY_ATTEMPTS).run();
      claimed = Number((claimRes as any)?.meta?.changes ?? 0) > 0;
    } else {
      const claimInsert = await env.DB.prepare(`
        INSERT OR IGNORE INTO notification_deliveries (
          id, signal_id, axnna_user_id, channel, destination, status, attempt_count, last_attempt_at
        ) VALUES (?, ?, ?, 'TELEGRAM', ?, 'SENDING', 1, ?)
      `).bind(crypto.randomUUID(), sig.setupId, user.id, user.telegram_chat_id, nowIso).run();
      claimed = Number((claimInsert as any)?.meta?.changes ?? 0) > 0;
    }

    if (!claimed) continue;

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

  const globalToggle = await env.DB.prepare(
    `SELECT value FROM system_config WHERE "key" = 'global_notifications_enabled'`
  ).first();
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
  `).bind(nowIso, MAX_DELIVERY_ATTEMPTS).all();

  if (!dueRows || dueRows.length === 0) return 0;

  let retriedSuccess = 0;
  for (const row of dueRows as any[]) {
    const claimRes = await env.DB.prepare(`
      UPDATE notification_deliveries
      SET status = 'SENDING',
          attempt_count = attempt_count + 1,
          last_attempt_at = ?
      WHERE id = ? AND status = 'RETRY_SCHEDULED' AND (next_retry_at IS NULL OR next_retry_at <= ?) AND attempt_count < ?
    `).bind(nowIso, row.id, nowIso, MAX_DELIVERY_ATTEMPTS).run();

    if (Number((claimRes as any)?.meta?.changes ?? 0) === 0) continue;

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

  const { results: rows } = await env.DB.prepare(
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
  ).bind(startIso, endIso).all() as {
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

    const globalToggle = await env.DB.prepare(
      `SELECT value FROM system_config WHERE "key" = 'global_notifications_enabled'`
    ).first();
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
      const existing = await env.DB.prepare(
        `SELECT status FROM daily_recap_deliveries WHERE recap_date = ? AND axnna_user_id = ?`
      ).bind(recapDate, user.id).first() as { status?: string } | null;

      if (existing?.status === 'SENT') {
        skippedAlreadySent++;
        continue;
      }

      // Atomically claim 'SENDING' before making outbound Telegram HTTP request
      const claimRes = await env.DB.prepare(`
        INSERT INTO daily_recap_deliveries (
          id, recap_date, axnna_user_id, status, attempt_count
        )
        VALUES (?, ?, ?, 'SENDING', 1)
        ON CONFLICT(recap_date, axnna_user_id) DO UPDATE SET
          status = 'SENDING',
          attempt_count = daily_recap_deliveries.attempt_count + 1
        WHERE daily_recap_deliveries.status = 'FAILED'
      `).bind(crypto.randomUUID(), recapDate, user.id).run();

      if (Number((claimRes as any)?.meta?.changes ?? 0) === 0) {
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
      `).bind(
        res.ok ? 'SENT' : 'FAILED',
        res.providerMessageId,
        res.ok ? null : (res.error || 'Delivery failed'),
        nextRetryAt,
        recapDate,
        user.id
      ).run();

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

  const globalToggle = await env.DB.prepare(
    `SELECT value FROM system_config WHERE "key" = 'global_notifications_enabled'`
  ).first();
  if (globalToggle?.value === 'false') return 0;

  const recapDate = targetDate || new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  let dueRows: any[] = [];
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
    `).bind(recapDate, MAX_RECAP_ATTEMPTS, nowIso).all();
    dueRows = res.results || [];
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
    `).bind(row.id, nowIso).run();

    if (Number((claimRes as any)?.meta?.changes ?? 0) === 0) continue;

    const sendRes = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, row.telegram_chat_id, text);
    const nextRetryAt = !sendRes.ok ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare(`
      UPDATE daily_recap_deliveries
      SET status = ?,
          provider_message_id = COALESCE(?, provider_message_id),
          last_error = ?,
          next_retry_at = ?
      WHERE id = ? AND status = 'SENDING'
    `).bind(
      sendRes.ok ? 'SENT' : 'FAILED',
      sendRes.providerMessageId,
      sendRes.ok ? null : (sendRes.error || 'Retry failed'),
      nextRetryAt,
      row.id
    ).run();

    if (sendRes.ok) recovered++;
  }

  return recovered;
}

async function handleCreateSession(env: Env, headers: any): Promise<Response> {
  const token = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO telegram_connection_sessions (id, connection_token, status, expires_at) VALUES (?, ?, 'PENDING', ?)`
  ).bind(sessionId, token, expiresAt).run();

  return Response.json({ token, expiresAt }, { headers });
}

async function handlePollSession(env: Env, url: URL, headers: any): Promise<Response> {
  const token = url.pathname.split('/').pop();
  if (!token) return new Response('Bad Request', { status: 400, headers });

  const session = await env.DB.prepare(
    `SELECT id, status, expires_at FROM telegram_connection_sessions WHERE connection_token = ?`
  ).bind(token).first() as { id?: string; status?: string; expires_at?: string } | null;

  if (!session) {
    return Response.json({ status: 'NOT_FOUND' }, { status: 404, headers });
  }

  if (session.status === 'PENDING' && session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(
      `UPDATE telegram_connection_sessions SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'`
    ).bind(session.id).run();
    return Response.json({ status: 'EXPIRED' }, { headers });
  }

  return Response.json({ status: session.status }, { headers });
}

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
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
      ).bind(crypto.randomUUID()).run();
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

  if (!update || typeof update !== 'object') {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const message = update.message;
  if (!message || typeof message !== 'object' || typeof message.text !== 'string') {
    return Response.json({ ok: true, ignored: true }, { status: 200 });
  }

  const from = message.from;
  const chat = message.chat;
  const isValidId = (val: unknown): boolean =>
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
    } else if (command === 'status' || command === 'recap') {
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
      if (command === 'status') {
        await handleTelegramStatusCommand(env, argStr, String(from.id), String(chat.id));
      } else {
        await handleTelegramRecapCommand(env, String(from.id), String(chat.id));
      }
    }
  }

  return Response.json({ ok: true }, { status: 200 });
}

async function evaluateInstrumentFundamentalContext(
  db: D1Database,
  instrument: string
): Promise<{ context: FundamentalContext }> {
  const { results: events } = await db.prepare(
    `SELECT * FROM economic_events ORDER BY timestamp DESC LIMIT 100`
  ).all();
  let calHealthStatus: string | undefined;
  let calLastSuccessMs: number | null = null;
  try {
    const calRow = await db.prepare(
      `SELECT status, last_successful_sync FROM provider_health_state WHERE service_type = 'ECONOMIC_CALENDAR' LIMIT 1`
    ).first() as { status?: string; last_successful_sync?: string | null } | null;
    calHealthStatus = calRow?.status;
    calLastSuccessMs = parseUtcTimestampMs(calRow?.last_successful_sync);
  } catch {
    calHealthStatus = undefined;
  }
  const eventsArr = (events || []) as unknown as EconomicEvent[];
  const nowMs = Date.now();
  const calFreshWithin2h = calLastSuccessMs !== null && nowMs - calLastSuccessMs <= 2 * 60 * 60 * 1000;
  // Historical rows in economic_events never prove current feed health; require HEALTHY recent sync
  const calendarDataAvailable = calHealthStatus === 'HEALTHY' && calFreshWithin2h;
  const fundamentalEngine = new FundamentalEngine();
  return {
    context: fundamentalEngine.evaluateContext(instrument, eventsArr, new Date(nowMs), {
      calendarDataAvailable,
    }),
  };
}

async function handleTelegramStatusCommand(
  env: Env,
  argStr: string,
  telegramUserId: string,
  chatId: string
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const user = await env.DB.prepare(
    `SELECT id, status FROM axnna_users WHERE telegram_user_id = ? AND status = 'CONNECTED'`
  ).bind(telegramUserId).first() as { id?: string } | null;

  if (!user) return;

  const arg = argStr.split(/\s+/)[0]?.toUpperCase() || '';
  const instrument = SUPPORTED_INSTRUMENTS.includes(arg as any) ? arg : 'EURUSD';

  const { context: ctx } = await evaluateInstrumentFundamentalContext(env.DB, instrument);

  const latestSignal = await env.DB.prepare(
    `SELECT direction, status, technical_score, generated_at FROM signals WHERE instrument = ? ORDER BY generated_at DESC LIMIT 1`
  ).bind(instrument).first() as { direction?: string; status?: string; technical_score?: number; generated_at?: string } | null;

  const reply = [
    `AXNNA STATUS: ${instrument}`,
    `Macro Regime: ${ctx.macroRegime} | Event Risk: ${ctx.eventRisk}`,
    latestSignal
      ? `Latest Setup: ${latestSignal.direction} (${latestSignal.status}, Score ${latestSignal.technical_score ?? 0}/100)`
      : `Latest Setup: None recorded yet`,
  ].join('\n');

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply);
}

async function handleTelegramRecapCommand(
  env: Env,
  telegramUserId: string,
  chatId: string
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const user = await env.DB.prepare(
    `SELECT id, status FROM axnna_users WHERE telegram_user_id = ? AND status = 'CONNECTED'`
  ).bind(telegramUserId).first() as { id?: string } | null;

  if (!user) return;

  const today = new Date().toISOString().slice(0, 10);
  const text = await buildDailyRecapText(env, today);
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

async function processTelegramConnection(env: Env, token: string, from: any, chat: any) {
  const session = await env.DB.prepare(
    `SELECT id, status, expires_at FROM telegram_connection_sessions WHERE connection_token = ?`
  ).bind(token).first() as { id?: string; status?: string; expires_at?: string } | null;

  if (!session || session.status !== 'PENDING') {
    return;
  }

  if (!session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(
      `UPDATE telegram_connection_sessions SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'`
    ).bind(session.id).run();
    return;
  }

  const userId = crypto.randomUUID();
  const telegramUserId = String(from.id);
  const telegramChatId = String(chat.id);
  const username = typeof from.username === 'string' ? from.username : null;
  const firstName = typeof from.first_name === 'string' ? from.first_name : null;
  const lastName = typeof from.last_name === 'string' ? from.last_name : null;
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    `SELECT id FROM axnna_users WHERE telegram_user_id = ?`
  ).bind(telegramUserId).first();

  let axnnaUserId: string = userId;
  if (existing && typeof existing.id === 'string') {
    axnnaUserId = existing.id;
    await env.DB.prepare(`
      UPDATE axnna_users
      SET status = 'CONNECTED', telegram_chat_id = ?, telegram_username_snapshot = ?, telegram_first_name_snapshot = ?, telegram_last_name_snapshot = ?, last_seen_at = ?, updated_at = ?
      WHERE telegram_user_id = ?
    `).bind(telegramChatId, username, firstName, lastName, now, now, telegramUserId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO axnna_users (id, telegram_user_id, telegram_chat_id, telegram_username_snapshot, telegram_first_name_snapshot, telegram_last_name_snapshot, status, connected_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'CONNECTED', ?, ?, ?)
    `).bind(axnnaUserId, telegramUserId, telegramChatId, username, firstName, lastName, now, now, now).run();
  }

  const claimRes = await env.DB.prepare(`
    UPDATE telegram_connection_sessions
    SET status = 'CONNECTED', axnna_user_id = ?
    WHERE id = ? AND status = 'PENDING'
  `).bind(axnnaUserId, session.id).run();

  if (Number((claimRes as any)?.meta?.changes ?? 0) === 0) {
    return;
  }

  await env.DB.prepare(`
    INSERT INTO audit_events (event_id, event_type, axnna_user_id, actor_source)
    VALUES (?, 'TELEGRAM_CONNECTION_COMPLETED', ?, 'TELEGRAM_WEBHOOK')
  `).bind(crypto.randomUUID(), axnnaUserId).run();

  try {
    await env.DB.prepare(
      `INSERT INTO analytics_events (id, visitor_id, session_id, event_type, path, device_category, browser_category)
       VALUES (?, ?, ?, 'TELEGRAM_CONNECT_COMPLETED', '/connect-telegram', 'unknown', 'Telegram')`
    ).bind(crypto.randomUUID(), axnnaUserId, String(session.id)).run();
  } catch {
    // Do not fail pairing if analytics insert fails
  }
}

async function handleBacktestRun(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const auth = request.headers.get('Authorization');
  if (!hasRealSecret(env.BACKTEST_SECRET) || !auth || !auth.startsWith('Bearer ')) {
    await recordSecurityEvent(env.DB, {
      eventType: 'BACKTEST_UNAUTHORIZED',
      severity: 'MEDIUM',
      sourceCategory: 'API_AUTH',
      actorId: await getRequestActorHash(request, env, 'security'),
      resource: '/api/dev/backtest',
    });
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  const providedToken = auth.slice('Bearer '.length).trim();
  const validBacktestSecret = await constantTimeSecretMatch(providedToken, env.BACKTEST_SECRET);
  if (!validBacktestSecret) {
    await recordSecurityEvent(env.DB, {
      eventType: 'BACKTEST_UNAUTHORIZED',
      severity: 'HIGH',
      sourceCategory: 'API_AUTH',
      actorId: await getRequestActorHash(request, env, 'security'),
      resource: '/api/dev/backtest',
    });
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const apiKey = (env.TWELVEDATA_API_KEY || '').trim();
  if (!hasRealSecret(apiKey)) {
    return Response.json({ error: 'Market data provider key is not configured.' }, { status: 503, headers });
  }

  const parsedBt = await readJsonBodyWithLimit(request, 16384);
  if (!parsedBt.ok) {
    return Response.json({ error: parsedBt.error }, { status: parsedBt.status, headers });
  }
  const body = parsedBt.data;

  const parsePipOverride = (rawVal: unknown, fieldName: string): { ok: true; value?: number } | { ok: false; error: string } => {
    if (rawVal === undefined) return { ok: true, value: undefined };
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || rawVal < 0 || rawVal > 50) {
      return { ok: false, error: `${fieldName} must be a finite number between 0 and 50 pips.` };
    }
    return { ok: true, value: rawVal };
  };

  const spreadCheck = parsePipOverride(body?.spreadPips, 'spreadPips');
  if (!spreadCheck.ok) return Response.json({ error: spreadCheck.error }, { status: 400, headers });
  const commissionCheck = parsePipOverride(body?.commissionPercent, 'commissionPercent');
  if (!commissionCheck.ok) return Response.json({ error: commissionCheck.error }, { status: 400, headers });
  const slippageCheck = parsePipOverride(body?.slippagePips, 'slippagePips');
  if (!slippageCheck.ok) return Response.json({ error: slippageCheck.error }, { status: 400, headers });

  const instrument = typeof body?.instrument === 'string' ? body.instrument.trim().toUpperCase() : '';
  if (!SUPPORTED_INSTRUMENTS.includes(instrument as any)) {
    return Response.json({ error: `Unsupported instrument. Allowed: ${SUPPORTED_INSTRUMENTS.join(', ')}` }, { status: 400, headers });
  }

  if (body?.timeframe !== undefined) {
    if (typeof body.timeframe !== 'string' || !SUPPORTED_TIMEFRAMES.includes(body.timeframe.toUpperCase() as any)) {
      return Response.json({ error: `Unsupported timeframe. Allowed: ${SUPPORTED_TIMEFRAMES.join(', ')}` }, { status: 400, headers });
    }
  }

  const rawLimit = body?.limit !== undefined ? body.limit : MAX_BACKTEST_LIMIT;
  if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < MIN_BACKTEST_LIMIT || rawLimit > MAX_BACKTEST_LIMIT) {
    return Response.json(
      { error: `limit must be an integer between ${MIN_BACKTEST_LIMIT} and ${MAX_BACKTEST_LIMIT}.` },
      { status: 400, headers }
    );
  }

  let startDateMs: number | null = null;
  let endDateMs: number | null = null;
  if (body?.startDate !== undefined) {
    if (typeof body.startDate !== 'string' || isNaN(Date.parse(body.startDate))) {
      return Response.json({ error: 'Invalid startDate.' }, { status: 400, headers });
    }
    startDateMs = Date.parse(body.startDate);
  }
  if (body?.endDate !== undefined) {
    if (typeof body.endDate !== 'string' || isNaN(Date.parse(body.endDate))) {
      return Response.json({ error: 'Invalid endDate.' }, { status: 400, headers });
    }
    endDateMs = Date.parse(body.endDate);
  }
  if (startDateMs !== null && endDateMs !== null && startDateMs >= endDateMs) {
    return Response.json({ error: 'startDate must be strictly before endDate.' }, { status: 400, headers });
  }

  const marketProvider = new TwelveDataMarketProvider(apiKey);

  try {
    const raw1H = await marketProvider.fetchCandles(instrument, '1H', rawLimit);
    const raw5M = await marketProvider.fetchCandles(instrument, '5M', rawLimit * 12);

    const val1H = MarketDataValidator.validateAndNormalize(raw1H);
    const val5M = MarketDataValidator.validateAndNormalize(raw5M);

    if (!val1H.valid || !val5M.valid) {
      return Response.json({ error: 'Data Validation Failed' }, { status: 500, headers });
    }

    const filterRange = (candles: InternalCandle[]) =>
      candles.filter((c) => {
        if (startDateMs !== null && c.timestamp < startDateMs) return false;
        if (endDateMs !== null && c.timestamp > endDateMs) return false;
        return true;
      });

    const config: BacktestConfig = {
      initialCapital: 10000,
      riskPerTradePercent: 1.0,
      ...(spreadCheck.value !== undefined ? { spreadPips: spreadCheck.value } : {}),
      ...(commissionCheck.value !== undefined ? { commissionPercent: commissionCheck.value } : {}),
      ...(slippageCheck.value !== undefined ? { slippagePips: slippageCheck.value } : {}),
      symbol: instrument,
      strategyConfig: {
        htfTimeframe: '1H',
        ltfTimeframe: '5M',
        swingLengthHTF: 3,
        swingLengthLTF: 2,
        atrLength: 14,
        displacementSizeMultiplier: 1.5,
        displacementBodyRatio: 0.5,
        displacementCloseLocation: 0.5,
        fvgMinAtrRatio: 0.5,
        alertScoreThreshold: 65,
      },
    };

    const engine = new BacktestEngine(config);
    const report = engine.run(filterRange(val1H.candles), filterRange(val5M.candles));

    return Response.json(report, { headers });
  } catch (error) {
    console.error('BACKTEST_ERROR:', sanitizeErrorMessage(error, apiKey));
    return Response.json({ error: 'Backtest execution failed.' }, { status: 500, headers });
  }
}
