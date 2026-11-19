import { pruneOperationalTables } from './ops/telemetry';
import { evaluateInstrumentFundamentalContext } from './worker/fundamentals';
import {
  buildCorsHeaders,
  handleBacktestRun,
  handlePublicStatus,
  isOriginAllowed,
  readJsonBodyWithLimit,
} from './worker/http';
import { runStrategyEngine, runSynchronization } from './worker/sync';
import {
  deliverTelegramAlerts,
  handleCreateSession,
  handlePollSession,
  handleTelegramWebhook,
  retryFailedDailyRecaps,
  retryScheduledDeliveries,
  runDailyRecap,
} from './worker/telegram';
import { Env, isSupportedInstrument, STATIC_FILE_EXT_PATTERN, SyncActionResult } from './worker/types';

export type { Env, SyncActionResult };
export {
  buildCorsHeaders,
  deliverTelegramAlerts,
  readJsonBodyWithLimit,
  retryFailedDailyRecaps,
  retryScheduledDeliveries,
  runDailyRecap,
};

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
      if (!isSupportedInstrument(instrument)) {
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
      ctx.waitUntil(runSynchronization(env, 'CRON_1H_SYNC', { mode: '1H_ONLY' }));
      return;
    }
    ctx.waitUntil(runSynchronization(env, 'CRON_SYNC', { mode: '5M_AND_STRATEGY' }));
  },

  runSynchronization,
  runStrategyEngine,
};
