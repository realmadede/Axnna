import { InternalCandle, MarketDataValidator } from '../core-engine/MarketData';
import { DEFAULT_STRATEGY_VERSION, StrategyEngine } from '../core-engine/StrategyEngine';
import { FundamentalContext, FundamentalEngine } from '../engine/FundamentalEngine';
import { evaluateOpenPaperTrades, registerPaperTradeFromApprovedSignal } from '../engine/PaperTradingEngine';
import { evaluateRiskGate } from '../engine/RiskGate';
import {
  acquireSyncLease,
  finishJobRun,
  hasRealSecret,
  recordProviderHealth,
  recordSecurityEvent,
  releaseSyncLease,
  startJobRun,
} from '../ops/telemetry';
import { FreeEconomicCalendarProvider } from '../providers/FundamentalProvider';
import { TiingoMarketProvider, TwelveDataMarketProvider } from '../providers/MarketProvider';
import { getMostRecentFxSessionCloseMs, isFxMarketClosedUtc, parseUtcTimestampMs } from '../utils/time';
import { evaluateInstrumentFundamentalContext } from './fundamentals';
import { sanitizeErrorMessage } from './http';
import { deliverTelegramAlerts, retryFailedDailyRecaps, retryScheduledDeliveries } from './telegram';
import { Env, SUPPORTED_INSTRUMENTS, SUPPORTED_TIMEFRAMES, SupportedTimeframe, SyncActionResult } from './types';

async function markMarketDataFailed(env: Env, instrument: string, timeframe: string, provider: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO market_data_state (instrument, timeframe, provider, status, error_count)
    VALUES (?, ?, ?, 'FAILED', 1)
    ON CONFLICT(instrument, timeframe) DO UPDATE SET
      status = 'FAILED',
      error_count = error_count + 1,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(instrument, timeframe, provider)
    .run();
}

interface CandleDbRow {
  instrument: string;
  timeframe: '5M' | '1H';
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export async function runStrategyEngine(env: Env, instrument: string): Promise<void> {
  const stratId = 'AXNNA_V1_LIQUIDITY_FVG';
  const stratVer = DEFAULT_STRATEGY_VERSION;

  const strategyRow = (await env.DB.prepare(
    `SELECT active_status FROM strategies WHERE strategy_id = ?`
  )
    .bind(stratId)
    .first()) as { active_status?: string } | null;
  if (strategyRow?.active_status && strategyRow.active_status !== 'ACTIVE') {
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

  const stateRow = (await env.DB.prepare(
    `SELECT last_processed_5m_timestamp, state_payload FROM strategy_state WHERE instrument = ? AND strategy_id = ? AND strategy_version = ?`
  )
    .bind(instrument, stratId, stratVer)
    .first()) as { last_processed_5m_timestamp?: string | null; state_payload?: string | null } | null;

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
    `SELECT instrument, timeframe, timestamp, open, high, low, close FROM market_candles WHERE instrument = ? AND timeframe = '5M' ORDER BY timestamp DESC LIMIT 300`
  )
    .bind(instrument)
    .all();

  const { results: c1Raw } = await env.DB.prepare(
    `SELECT instrument, timeframe, timestamp, open, high, low, close FROM market_candles WHERE instrument = ? AND timeframe = '1H' ORDER BY timestamp DESC LIMIT 200`
  )
    .bind(instrument)
    .all();

  if (!c5Raw || !c1Raw || c5Raw.length === 0 || c1Raw.length === 0) return;

  const mapCandle = (c: CandleDbRow): InternalCandle => ({
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

  const c5Chronological = [...(c5Raw as unknown as CandleDbRow[])].reverse().map(mapCandle);
  const c1Chronological = [...(c1Raw as unknown as CandleDbRow[])].reverse().map(mapCandle);

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
    `)
      .bind(instrument, stratId, stratVer, isoLastTs, nextPayload)
      .run();
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
    `)
      .bind(
        sig.setupId,
        stratId,
        stratVer,
        instrument,
        sig.direction,
        new Date(sig.detectionTimestamp).toISOString(),
        entry,
        stop,
        target,
        rr,
        sig.status,
        sig.technicalScore || 0,
        sig.invalidationReason || null,
        payload
      )
      .run();

    console.log(`CANDIDATE_PROCESSED: ${instrument} ${sig.direction} (Setup: ${sig.setupId}) - Status: ${sig.status}`);

    if (sig.status === 'ALERT_ELIGIBLE' && fundamentalContext) {
      const confluence = fundamentalEngine.getConfluence(fundamentalContext, sig.direction);
      await env.DB.prepare(`UPDATE signals SET market_context = ? WHERE signal_id = ?`)
        .bind(JSON.stringify({ ...fundamentalContext, confluence }), sig.setupId)
        .run();

      const existingSentRow = await env.DB.prepare(
        `SELECT id FROM notification_deliveries WHERE signal_id = ? AND status = 'SENT' LIMIT 1`
      )
        .bind(sig.setupId)
        .first();

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
          `INSERT INTO audit_events (event_id, event_type, actor_source, metadata) VALUES (?, ?, 'RISK_GATE', ?)`
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
        const message = sanitizeErrorMessage(persistErr);
        console.error(`RISK_DECISION_PERSIST_FAILED (${sig.setupId}): ${message}`);
        await recordSecurityEvent(env.DB, {
          eventType: 'RISK_DECISION_PERSIST_FAILED',
          severity: 'HIGH',
          sourceCategory: 'RISK_GATE',
          resource: sig.setupId,
          details: { instrument, error: message },
        });
      }

      if (!decisionPersisted) {
        continue;
      }

      if (riskDecision.decision === 'REJECTED') {
        if (riskDecision.reasonCode === 'HIGH_EVENT_RISK') {
          console.log(`ALERT_SUPPRESSED_EVENT_RISK: ${instrument} ${sig.direction} (Setup: ${sig.setupId})`);
        } else {
          console.log(`ALERT_SUPPRESSED_RISK_GATE: ${instrument} ${sig.direction} (Setup: ${sig.setupId}) - ${riskDecision.reasonCode}`);
        }
      } else {
        await deliverTelegramAlerts(env, sig, instrument, rr, fundamentalContext, confluence);
        await registerPaperTradeFromApprovedSignal(env.DB, sig, stratId);
      }
    }
  }
}

export async function runSynchronization(
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
      const calState = (await env.DB.prepare(
        `SELECT status, last_successful_sync FROM provider_health_state WHERE service_type = 'ECONOMIC_CALENDAR' LIMIT 1`
      ).first()) as { status?: string; last_successful_sync?: string | null } | null;
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
            const existingMap = new Map<string, { actual: string | null; estimate: string | null }>();
            const minTs = events.reduce((m, ev) => (ev.timestamp < m ? ev.timestamp : m), events[0].timestamp);
            const { results: existingRows } = (await env.DB.prepare(
              `SELECT id, actual, estimate FROM economic_events WHERE timestamp >= ?`
            )
              .bind(minTs)
              .all()) as { results: Array<{ id: string; actual: string | null; estimate: string | null }> };
            for (const row of existingRows || []) {
              existingMap.set(row.id, { actual: row.actual ?? null, estimate: row.estimate ?? null });
            }

            const changedStmts: D1PreparedStatement[] = [];
            for (const ev of events) {
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

    const twelvedataKey = (env.TWELVEDATA_API_KEY || '').trim();
    const tiingoKey = (env.TIINGO_API_KEY || '').trim();
    const hasPrimary = hasRealSecret(twelvedataKey);
    const hasFallback = hasRealSecret(tiingoKey);

    if (!hasPrimary && !hasFallback) {
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
    const primaryProvider = hasPrimary ? new TwelveDataMarketProvider(twelvedataKey) : null;
    const fallbackProvider = hasFallback ? new TiingoMarketProvider(tiingoKey) : null;
    let primaryAttempted = 0;
    let primaryFailures = 0;
    let fallbackAttempted = 0;
    let fallbackFailures = 0;
    let fallbackSucceeded = 0;
    let primaryShortCircuited = false;
    let marketFailures = 0;
    const nowMs = Date.now();
    const fxClosed = isFxMarketClosedUtc(nowMs);
    const recentCloseMs = fxClosed ? getMostRecentFxSessionCloseMs(nowMs) : 0;
    const timeframesToCheck: readonly SupportedTimeframe[] =
      mode === '1H_ONLY' ? ['1H'] : SUPPORTED_TIMEFRAMES;

    const fetchValidatedFeed = async (
      inst: string,
      tf: SupportedTimeframe
    ): Promise<{ ok: true; candles: InternalCandle[]; providerName: string } | { ok: false; providerName: string; reason: string }> => {
      let lastProviderName = primaryProvider ? primaryProvider.name : fallbackProvider!.name;
      let lastReason = 'Unknown error';

      if (primaryProvider && !primaryShortCircuited) {
        primaryAttempted++;
        try {
          const candles = await primaryProvider.fetchCandles(inst, tf, 100);
          const { valid, candles: validCandles, error } = MarketDataValidator.validateAndNormalize(candles);
          if (valid) {
            return { ok: true, candles: validCandles, providerName: primaryProvider.name };
          }
          primaryFailures++;
          lastReason = error || 'Data validation failed';
          console.warn(`Data validation failed for ${inst} ${tf}: ${lastReason}`);
        } catch (err) {
          primaryFailures++;
          lastReason = sanitizeErrorMessage(err, twelvedataKey, tiingoKey);
          console.error(`Failed primary fetch ${inst} ${tf}: ${lastReason}`);
          if (lastReason.includes('429') || lastReason.includes('Authentication failure')) {
            primaryShortCircuited = true;
          }
        }
      }

      if (fallbackProvider) {
        fallbackAttempted++;
        lastProviderName = fallbackProvider.name;
        if (primaryProvider) {
          console.warn(`MARKET_FALLBACK_TRIGGERED (${inst} ${tf}): trying ${fallbackProvider.name}`);
        }
        try {
          const candles = await fallbackProvider.fetchCandles(inst, tf, 100);
          const { valid, candles: validCandles, error } = MarketDataValidator.validateAndNormalize(candles);
          if (valid) {
            fallbackSucceeded++;
            return { ok: true, candles: validCandles, providerName: fallbackProvider.name };
          }
          fallbackFailures++;
          lastReason = error || 'Fallback data validation failed';
          console.warn(`Fallback validation failed for ${inst} ${tf}: ${lastReason}`);
        } catch (err) {
          fallbackFailures++;
          lastReason = sanitizeErrorMessage(err, twelvedataKey, tiingoKey);
          console.error(`Failed fallback fetch ${inst} ${tf}: ${lastReason}`);
        }
      }

      return { ok: false, providerName: lastProviderName, reason: lastReason };
    };

    try {
      for (const inst of SUPPORTED_INSTRUMENTS) {
        let inst5mOk = false;

        for (const tf of timeframesToCheck) {
          try {
            const stateRow = (await env.DB.prepare(
              `SELECT last_completed_candle, status FROM market_data_state WHERE instrument = ? AND timeframe = ?`
            )
              .bind(inst, tf)
              .first()) as { last_completed_candle?: string | null; status?: string } | null;
            const lastCandleMs = parseUtcTimestampMs(stateRow?.last_completed_candle);

            if (tf === '1H' && mode !== '1H_ONLY') {
              const freshnessThresholdMs =
                mode === '5M_AND_STRATEGY'
                  ? nowMs - 2 * 3_600_000
                  : Math.floor(nowMs / 3_600_000) * 3_600_000 - 3_600_000;
              if (stateRow?.status === 'HEALTHY' && lastCandleMs !== null && lastCandleMs >= freshnessThresholdMs) {
                const cached1hCount = (await env.DB.prepare(
                  `SELECT COUNT(*) as cnt FROM market_candles WHERE instrument = ? AND timeframe = '1H'`
                )
                  .bind(inst)
                  .first()) as { cnt?: number } | null;
                if (Number(cached1hCount?.cnt ?? 0) >= 20) {
                  continue;
                }
              }
            }

            if (fxClosed && stateRow?.status === 'HEALTHY' && lastCandleMs !== null && lastCandleMs >= recentCloseMs - 35 * 60 * 1000) {
              const cachedCountRow = (await env.DB.prepare(
                `SELECT COUNT(*) as cnt FROM market_candles WHERE instrument = ? AND timeframe = ?`
              )
                .bind(inst, tf)
                .first()) as { cnt?: number } | null;
              if (Number(cachedCountRow?.cnt ?? 0) >= 20) {
                if (tf === '5M') {
                  inst5mOk = true;
                }
                continue;
              }
            }

            const feedResult = await fetchValidatedFeed(inst, tf);
            if (!feedResult.ok) {
              marketFailures++;
              hasPartialFailure = true;
              await markMarketDataFailed(env, inst, tf, feedResult.providerName);
              continue;
            }

            const validCandles = feedResult.candles;
            const sourceProvider = feedResult.providerName;

            const { results: existingCandleRows } = (await env.DB.prepare(
              `SELECT timestamp FROM market_candles WHERE instrument = ? AND timeframe = ? ORDER BY timestamp DESC LIMIT 150`
            )
              .bind(inst, tf)
              .all()) as { results: Array<{ timestamp: string }> };
            const existingTsSet = new Set((existingCandleRows || []).map((r) => String(r.timestamp)));

            const newCandles = validCandles.filter((c) => !existingTsSet.has(new Date(c.timestamp).toISOString()));
            if (newCandles.length > 0) {
              const insertStmts: D1PreparedStatement[] = newCandles.map((c) => {
                const isoTime = new Date(c.timestamp).toISOString();
                const id = `${c.symbol}_${c.timeframe}_${c.timestamp}`;
                return env.DB.prepare(`
                  INSERT OR IGNORE INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(id, inst, c.timeframe, isoTime, c.open, c.high, c.low, c.close, sourceProvider);
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
                provider = excluded.provider,
                last_completed_candle = excluded.last_completed_candle,
                last_successful_fetch = CURRENT_TIMESTAMP,
                status = 'HEALTHY',
                error_count = 0,
                updated_at = CURRENT_TIMESTAMP
            `)
              .bind(inst, tf, sourceProvider, new Date(validCandles[validCandles.length - 1].timestamp).toISOString())
              .run();

            if (tf === '5M') {
              inst5mOk = true;
            }
          } catch (e: unknown) {
            marketFailures++;
            hasPartialFailure = true;
            const errMsg = sanitizeErrorMessage(e, twelvedataKey, tiingoKey);
            console.error(`Failed to store ${inst} ${tf}: ${errMsg}`);
            await markMarketDataFailed(env, inst, tf, primaryProvider ? primaryProvider.name : fallbackProvider!.name);
          }
        }

        if (mode !== '1H_ONLY' && inst5mOk) {
          await evaluateOpenPaperTrades(env.DB, inst);
          await runStrategyEngine(env, inst);
        }
      }

      const totalFeeds = SUPPORTED_INSTRUMENTS.length * timeframesToCheck.length;
      if (primaryAttempted > 0) {
        const primaryOutcome =
          primaryFailures === 0 ? 'HEALTHY' : primaryFailures === primaryAttempted ? 'FAILED' : 'DEGRADED';
        await recordProviderHealth(env.DB, 'twelvedata', 'MARKET_DATA', primaryOutcome);
      } else if (primaryProvider && fallbackSucceeded === 0 && marketFailures === 0) {
        await recordProviderHealth(env.DB, 'twelvedata', 'MARKET_DATA', 'HEALTHY');
      }

      if (fallbackAttempted > 0) {
        const fallbackOutcome =
          fallbackFailures === 0 ? 'HEALTHY' : fallbackFailures === fallbackAttempted ? 'FAILED' : 'DEGRADED';
        await recordProviderHealth(env.DB, 'tiingo', 'MARKET_DATA', fallbackOutcome);
      }

      await retryScheduledDeliveries(env);
      await retryFailedDailyRecaps(env);

      const finalStatus =
        marketFailures === totalFeeds ? 'FAILED' : hasPartialFailure ? 'DEGRADED' : 'SUCCEEDED';
      const fallbackNote = fallbackSucceeded > 0 ? `; tiingo fallback feeds: ${fallbackSucceeded}` : '';
      const summary = `Calendar events: ${calendarCount}; market feed failures: ${marketFailures}/${totalFeeds}${fallbackNote}`;
      await finishJobRun(env.DB, job.id, job.startedAtMs, finalStatus, summary);
      console.log('MARKET_SYNC_COMPLETED');
      return {
        status: finalStatus,
        summary,
        error: finalStatus === 'FAILED' ? `All ${totalFeeds} market data feeds failed.` : undefined,
      };
    } catch (error) {
      const providerName = primaryProvider ? primaryProvider.name : fallbackProvider!.name;
      await recordProviderHealth(env.DB, providerName, 'MARKET_DATA', 'FAILED');
      const msg = sanitizeErrorMessage(error, twelvedataKey, tiingoKey);
      await finishJobRun(env.DB, job.id, job.startedAtMs, 'FAILED', undefined, msg);
      console.log('MARKET_SYNC_FAILED', msg);
      return { status: 'FAILED', error: msg };
    }
  } finally {
    await releaseSyncLease(env.DB, leaseOwner);
  }
}
