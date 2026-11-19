import { BacktestConfig, BacktestEngine } from '../core-engine/BacktestEngine';
import { InternalCandle, MarketDataValidator } from '../core-engine/MarketData';
import {
  evaluateSystemHealth,
  getRequestActorHash,
  hasRealSecret,
  recordSecurityEvent,
} from '../ops/telemetry';
import { TwelveDataMarketProvider } from '../providers/MarketProvider';
import { constantTimeSecretMatch } from '../utils/crypto';
import { Env, isSupportedInstrument, isSupportedTimeframe, SUPPORTED_INSTRUMENTS, SUPPORTED_TIMEFRAMES } from './types';

const MIN_BACKTEST_LIMIT = 100;
const MAX_BACKTEST_LIMIT = 400;

export function isOriginAllowed(origin: string | null, url: URL, env: Env): boolean {
  if (!origin) return false;
  try {
    if (origin === url.origin) return true;
    const configured = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (configured.includes(origin)) return true;

    const isLocalDev = !env.ENVIRONMENT || env.ENVIRONMENT === 'development';
    if (isLocalDev && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
      return true;
    }
  } catch {
    return false;
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

  if (isOriginAllowed(origin, url, env) && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export function sanitizeErrorMessage(err: unknown, ...secretsToRedact: Array<string | undefined>): string {
  let cleaned = err instanceof Error ? err.message : String(err || 'Unknown error');
  for (const secret of secretsToRedact) {
    if (secret) {
      cleaned = cleaned.split(secret).join('[REDACTED]');
    }
  }
  return cleaned.slice(0, 300);
}

export async function readJsonBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
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
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: 'Invalid JSON payload.' };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON payload.' };
  }
}

export async function handlePublicStatus(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
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

export async function handleBacktestRun(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
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

  const spreadCheck = parsePipOverride(body.spreadPips, 'spreadPips');
  if (!spreadCheck.ok) return Response.json({ error: spreadCheck.error }, { status: 400, headers });
  const commissionCheck = parsePipOverride(body.commissionPercent, 'commissionPercent');
  if (!commissionCheck.ok) return Response.json({ error: commissionCheck.error }, { status: 400, headers });
  const slippageCheck = parsePipOverride(body.slippagePips, 'slippagePips');
  if (!slippageCheck.ok) return Response.json({ error: slippageCheck.error }, { status: 400, headers });

  const instrument = typeof body.instrument === 'string' ? body.instrument.trim().toUpperCase() : '';
  if (!isSupportedInstrument(instrument)) {
    return Response.json({ error: `Unsupported instrument. Allowed: ${SUPPORTED_INSTRUMENTS.join(', ')}` }, { status: 400, headers });
  }

  if (body.timeframe !== undefined) {
    if (typeof body.timeframe !== 'string' || !isSupportedTimeframe(body.timeframe.toUpperCase())) {
      return Response.json({ error: `Unsupported timeframe. Allowed: ${SUPPORTED_TIMEFRAMES.join(', ')}` }, { status: 400, headers });
    }
  }

  const rawLimit = body.limit !== undefined ? body.limit : MAX_BACKTEST_LIMIT;
  if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < MIN_BACKTEST_LIMIT || rawLimit > MAX_BACKTEST_LIMIT) {
    return Response.json(
      { error: `limit must be an integer between ${MIN_BACKTEST_LIMIT} and ${MAX_BACKTEST_LIMIT}.` },
      { status: 400, headers }
    );
  }

  let startDateMs: number | null = null;
  let endDateMs: number | null = null;
  if (body.startDate !== undefined) {
    if (typeof body.startDate !== 'string' || Number.isNaN(Date.parse(body.startDate))) {
      return Response.json({ error: 'Invalid startDate.' }, { status: 400, headers });
    }
    startDateMs = Date.parse(body.startDate);
  }
  if (body.endDate !== undefined) {
    if (typeof body.endDate !== 'string' || Number.isNaN(Date.parse(body.endDate))) {
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
