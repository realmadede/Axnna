import { StrategyEngine } from './core-engine/StrategyEngine';
import { MarketDataValidator, InternalCandle } from './core-engine/MarketData';
import { TwelveDataMarketProvider } from "./providers/MarketProvider";
import { FinnhubFundamentalProvider } from "./providers/FundamentalProvider";
import { FundamentalEngine } from "./engine/FundamentalEngine";

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TWELVEDATA_API_KEY: string;
  FINNHUB_API_KEY: string;
  BACKTEST_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
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
    
    if (url.pathname === '/api/markets' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT instrument, timeframe, timestamp, open, high, low, close 
        FROM market_candles 
        ORDER BY timestamp DESC LIMIT 50
      `).all();
      return Response.json(results, { headers: corsHeaders });
    }
    if (url.pathname === '/api/calendar' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT * FROM economic_events ORDER BY timestamp DESC LIMIT 20
      `).all();
      return Response.json(results, { headers: corsHeaders });
    }
    if (url.pathname === '/api/signals' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT * FROM signals ORDER BY generated_at DESC LIMIT 50
      `).all();
      return Response.json(results, { headers: corsHeaders });
    }
    if (url.pathname.startsWith('/api/fundamentals/') && request.method === 'GET') {
      const instrument = url.pathname.split('/').pop() || '';
      const { results } = await env.DB.prepare(`
        SELECT * FROM economic_events ORDER BY timestamp DESC LIMIT 100
      `).all();
      const engine = new FundamentalEngine();
      const context = engine.evaluateContext(instrument, results as any);
      return Response.json(context, { headers: corsHeaders });
    }

    if (url.pathname === '/api/dev/backtest' && request.method === 'POST') {
      return await handleBacktestRun(request, env, corsHeaders);
    }

    if (url.pathname.startsWith('/api')) {
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }

    return new Response('Axnna API Active', { headers: corsHeaders });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(this.runSynchronization(env));
  },

  async runSynchronization(env: Env) {
    console.log("MARKET_SYNC_STARTED");
    const marketProvider = new TwelveDataMarketProvider(env.TWELVEDATA_API_KEY || 'mock_key');
    const fundamentalProvider = new FinnhubFundamentalProvider(env.FINNHUB_API_KEY || 'mock_key');
    
    const instruments = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
    const timeframes = ['5M', '1H'];

    try {
      for (const inst of instruments) {
        for (const tf of timeframes) {
          try {
            // Need ~100 candles for reliable structure history
            const candles = await marketProvider.fetchCandles(inst, tf, 100);
            const { valid, candles: validCandles, error } = MarketDataValidator.validateAndNormalize(candles);
            
            if (!valid) {
              console.warn(`Data validation failed for ${inst} ${tf}: ${error}`);
              continue;
            }

            for (const c of validCandles) {
              // Convert JS timestamp back to ISO string or keep as ms? DB has DATETIME. 
              // The old table uses `timestamp DATETIME`, so ISO string.
              const isoTime = new Date(c.timestamp).toISOString();
              const id = `${c.symbol}_${c.timeframe}_${c.timestamp}`;

              await env.DB.prepare(`
                INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(instrument, timeframe, timestamp) DO UPDATE SET
                  open = excluded.open,
                  high = excluded.high,
                  low = excluded.low,
                  close = excluded.close,
                  updated_at = CURRENT_TIMESTAMP
              `).bind(id, inst, c.timeframe, isoTime, c.open, c.high, c.low, c.close, marketProvider.getProviderName()).run();
            }
            
            await env.DB.prepare(`
              INSERT INTO market_data_state (instrument, timeframe, provider, last_completed_candle, last_successful_fetch, status)
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'HEALTHY')
              ON CONFLICT(instrument, timeframe) DO UPDATE SET
                last_completed_candle = excluded.last_completed_candle,
                last_successful_fetch = CURRENT_TIMESTAMP,
                status = 'HEALTHY',
                error_count = 0
            `).bind(inst, tf, marketProvider.name, new Date(validCandles[validCandles.length - 1].timestamp).toISOString()).run();
          } catch (e: any) {
            console.error(`Failed to fetch/store ${inst} ${tf}: ${e.message}`);
             await env.DB.prepare(`
              INSERT INTO market_data_state (instrument, timeframe, provider, status, error_count)
              VALUES (?, ?, ?, 'FAILED', 1)
              ON CONFLICT(instrument, timeframe) DO UPDATE SET
                status = 'FAILED',
                error_count = error_count + 1,
                updated_at = CURRENT_TIMESTAMP
            `).bind(inst, tf, marketProvider.name).run();
          }
        }

        // Run Strategy Engine for this instrument
        await this.runStrategyEngine(env, inst);
      }
      console.log("MARKET_SYNC_COMPLETED");
    } catch (error) {
      console.log("MARKET_SYNC_FAILED", error);
    }

    console.log("ECONOMIC_SYNC_STARTED");
    try {
      const events = await fundamentalProvider.fetchUpcomingEvents('USD', 'today', 'tomorrow');
      for (const ev of events) {
        await env.DB.prepare(`
          INSERT INTO economic_events (id, country, currency, event, timestamp, importance, estimate, previous, actual, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            actual = excluded.actual,
            estimate = excluded.estimate,
            updated_at = CURRENT_TIMESTAMP
        `).bind(ev.id, ev.country, ev.currency, ev.event, ev.timestamp, ev.importance, ev.estimate, ev.previous, ev.actual, ev.source).run();
      }
      console.log("ECONOMIC_SYNC_COMPLETED");
    } catch (error) {
      console.log("ECONOMIC_SYNC_FAILED", error);
    }
  },

  async runStrategyEngine(env: Env, instrument: string) {
    const stratId = 'AXNNA_V1_LIQUIDITY_FVG';
    const stratVer = 'technical-v1'; // Matched with new core engine strategy version

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
      alertScoreThreshold: 65
    });

    // Fetch canonical candles to process (Last 100 for proper ATR and structure)
    const { results: c5Raw } = await env.DB.prepare(
      `SELECT * FROM market_candles WHERE instrument = ? AND timeframe = '5M' ORDER BY timestamp DESC LIMIT 100`
    ).bind(instrument).all();

    const { results: c1Raw } = await env.DB.prepare(
      `SELECT * FROM market_candles WHERE instrument = ? AND timeframe = '1H' ORDER BY timestamp DESC LIMIT 100`
    ).bind(instrument).all();

    if (!c5Raw || !c1Raw || c5Raw.length === 0 || c1Raw.length === 0) return;

    // Sort ASC for chronological processing
    const c5Chronological = c5Raw.reverse().map((c: any) => ({
      symbol: c.instrument,
      timeframe: c.timeframe,
      timestamp: new Date(c.timestamp).getTime(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      isCompleted: true // They are completed by definition in our persistence
    })) as InternalCandle[];

    const c1Chronological = c1Raw.reverse().map((c: any) => ({
      symbol: c.instrument,
      timeframe: c.timeframe,
      timestamp: new Date(c.timestamp).getTime(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      isCompleted: true
    })) as InternalCandle[];

    // Process
    const results = engine.processCandles(c1Chronological, c5Chronological);
    
    // Also include the currently active pending setup if any, so we can track rejections
    const active = engine.getActiveCandidate();
    if (active && active.status === 'REJECTED') {
       results.push(active as any);
    }

    // Persist Results
    for (const sig of results) {
      // Safely serialize evidence payload
      const payload = JSON.stringify({
        htfBias: sig.htfBias,
        liquidity: sig.liquidityReference,
        sweep: sig.sweep,
        displacement: sig.displacement,
        fvg: sig.fvg,
        retracement: sig.retracement
      });

      // Avoid SQL syntax errors if entry/stop/target are undefined (use null)
      const entry = sig.entryPrice !== undefined ? sig.entryPrice : null;
      const stop = sig.stopLossPrice !== undefined ? sig.stopLossPrice : null;
      const target = sig.structuralTargetPrice !== undefined ? sig.structuralTargetPrice : null;
      
      let rr = null;
      if (entry && stop && target && Math.abs(entry - stop) > 0) {
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
          -- Only update status if it's currently QUALIFIED or ALERT_ELIGIBLE. Don't downgrade from ALERTED or ACTIVE_TRADE.
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
    }
  }
};

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
    `SELECT status FROM telegram_connection_sessions WHERE connection_token = ?`
  ).bind(token).first();

  if (!session) {
    return Response.json({ status: 'NOT_FOUND' }, { status: 404, headers });
  }

  return Response.json({ status: session.status }, { headers });
}

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  let update: any;
  try {
    update = await request.json();
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (update?.message?.text) {
    const text = update.message.text;
    const chat = update.message.chat;
    const from = update.message.from;

    if (text.startsWith('/start ')) {
      const token = text.split(' ')[1];
      if (token) {
        await processTelegramConnection(env, token, from, chat);
      }
    }
  }

  return new Response('OK');
}

async function processTelegramConnection(env: Env, token: string, from: any, chat: any) {
  const session = await env.DB.prepare(
    `SELECT id, status, expires_at FROM telegram_connection_sessions WHERE connection_token = ?`
  ).bind(token).first();

  if (!session || session.status !== 'PENDING' || new Date(session.expires_at as string) < new Date()) {
    if (session && session.status === 'PENDING') {
      await env.DB.prepare(`UPDATE telegram_connection_sessions SET status = 'EXPIRED' WHERE id = ?`).bind(session.id).run();
    }
    return;
  }

  const userId = crypto.randomUUID();
  const telegramUserId = from.id.toString();
  const telegramChatId = chat.id.toString();
  const username = from.username || null;
  const firstName = from.first_name || null;
  const lastName = from.last_name || null;
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(`SELECT id FROM axnna_users WHERE telegram_user_id = ?`).bind(telegramUserId).first();
  
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

  await env.DB.prepare(`
    UPDATE telegram_connection_sessions 
    SET status = 'CONNECTED', axnna_user_id = ?
    WHERE id = ?
  `).bind(axnnaUserId, session.id).run();

  await env.DB.prepare(`
    INSERT INTO audit_events (event_id, event_type, axnna_user_id, actor_source)
    VALUES (?, 'TELEGRAM_CONNECTION_COMPLETED', ?, 'TELEGRAM_WEBHOOK')
  `).bind(crypto.randomUUID(), axnnaUserId).run();
}

import { BacktestEngine, BacktestConfig } from './core-engine/BacktestEngine';

async function handleBacktestRun(request: Request, env: Env, headers: any): Promise<Response> {
  const auth = request.headers.get('Authorization');
  // Use dedicated backtest secret or disable if not configured
  if (!env.BACKTEST_SECRET || !auth || auth !== `Bearer ${env.BACKTEST_SECRET}`) {
     return new Response('Unauthorized', { status: 401, headers });
  }

  let body: any;
  try {
    body = await request.json();
  } catch (e) {
    return new Response('Invalid JSON', { status: 400, headers });
  }

  const { instrument, limit = 5000 } = body;
  if (!instrument) return new Response('Missing instrument', { status: 400, headers });

  const marketProvider = new TwelveDataMarketProvider(env.TWELVEDATA_API_KEY || 'mock_key');
  
  try {
    // 1. Fetch large historical payload safely bounded by provider limits
    const raw1H = await marketProvider.fetchCandles(instrument, '1H', limit);
    const raw5M = await marketProvider.fetchCandles(instrument, '5M', limit * 12); // Need more 5M candles for alignment

    const val1H = MarketDataValidator.validateAndNormalize(raw1H);
    const val5M = MarketDataValidator.validateAndNormalize(raw5M);

    if (!val1H.valid || !val5M.valid) {
       return new Response('Data Validation Failed', { status: 500, headers });
    }

    // 2. Define Execution Assumptions Explicitly
    const config: BacktestConfig = {
      initialCapital: 10000,
      riskPerTradePercent: 1.0,
      spreadPips: body.spreadPips !== undefined ? body.spreadPips : 0.00015,
      commissionPercent: body.commissionPercent !== undefined ? body.commissionPercent : 0.00005,
      slippagePips: body.slippagePips !== undefined ? body.slippagePips : 0.00005,
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
        alertScoreThreshold: 65
      }
    };

    const engine = new BacktestEngine(config);
    const report = engine.run(val1H.candles, val5M.candles);

    return Response.json(report, { headers });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
