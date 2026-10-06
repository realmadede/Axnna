import { TwelveDataMarketProvider } from "./providers/MarketProvider";
import { FinnhubFundamentalProvider } from "./providers/FundamentalProvider";
import { AxnnaV1Engine } from "./engine/AxnnaV1Strategy";
import { FundamentalEngine } from "./engine/FundamentalEngine";

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TWELVEDATA_API_KEY: string;
  FINNHUB_API_KEY: string;
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
          const candles = await marketProvider.fetchRecentCandles(inst, tf, 5);
          for (const c of candles) {
            await env.DB.prepare(`
              INSERT INTO market_candles (id, instrument, timeframe, timestamp, open, high, low, close, source_provider)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(instrument, timeframe, timestamp) DO UPDATE SET
                open = excluded.open,
                high = excluded.high,
                low = excluded.low,
                close = excluded.close,
                updated_at = CURRENT_TIMESTAMP
            `).bind(c.id, c.instrument, c.timeframe, c.timestamp, c.open, c.high, c.low, c.close, c.source_provider).run();
          }
          
          await env.DB.prepare(`
            INSERT INTO market_data_state (instrument, timeframe, provider, last_completed_candle, last_successful_fetch, status)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'HEALTHY')
            ON CONFLICT(instrument, timeframe) DO UPDATE SET
              last_completed_candle = excluded.last_completed_candle,
              last_successful_fetch = CURRENT_TIMESTAMP,
              status = 'HEALTHY',
              error_count = 0
          `).bind(inst, tf, marketProvider.name, candles[0]?.timestamp || null).run();
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
    const stratVer = '4';

    // 1. Load state
    const stateRow = await env.DB.prepare(
      `SELECT state_payload FROM strategy_state WHERE instrument = ? AND strategy_id = ? AND strategy_version = ?`
    ).bind(instrument, stratId, stratVer).first();

    let initialState = undefined;
    if (stateRow && typeof stateRow.state_payload === 'string') {
      initialState = JSON.parse(stateRow.state_payload);
    }

    // 2. Initialize engine
    const engine = new AxnnaV1Engine({
      swingN: 10,
      atrN: 14,
      maxSweepDuration: 3,
      maxDisplacementDelay: 3,
      dispSizeMultiplier: 1.5,
      dispBodyRatio: 0.5,
      dispCloseLocation: 0.5,
      fvgMinAtrRatio: 0.5,
      minimumRR: 2.0
    }, initialState);

    // 3. Fetch canonical candles to process
    const { results: c5Raw } = await env.DB.prepare(
      `SELECT * FROM market_candles WHERE instrument = ? AND timeframe = '5M' ORDER BY timestamp ASC`
    ).bind(instrument).all();

    const { results: c1Raw } = await env.DB.prepare(
      `SELECT * FROM market_candles WHERE instrument = ? AND timeframe = '1H' ORDER BY timestamp ASC`
    ).bind(instrument).all();

    // 4. Run Process
    engine.processCandles(c5Raw as any, c1Raw as any);

    // 5. Persist State
    const payload = JSON.stringify(engine.state);
    await env.DB.prepare(`
      INSERT INTO strategy_state (instrument, strategy_id, strategy_version, state_payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(instrument, strategy_id, strategy_version) DO UPDATE SET
        state_payload = excluded.state_payload,
        updated_at = CURRENT_TIMESTAMP
    `).bind(instrument, stratId, stratVer, payload).run();

    // 6. Persist Signals
    for (const sig of engine.generatedSignals) {
      await env.DB.prepare(`
        INSERT INTO signals (signal_id, strategy_id, strategy_version, instrument, direction, generated_at, anchor_timeframe, execution_timeframe, entry, structural_stop, structural_target, structural_rr, status)
        VALUES (?, ?, ?, ?, ?, ?, '1H', '5M', ?, ?, ?, ?, ?)
        ON CONFLICT(signal_id) DO NOTHING
      `).bind(sig.signal_id, stratId, stratVer, instrument, sig.direction, sig.generated_at, sig.entry, sig.stop, sig.target, sig.rr, sig.status).run();
      
      console.log(`SIGNAL_CREATED: ${instrument} ${sig.direction} (Setup: ${sig.signal_id})`);
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
