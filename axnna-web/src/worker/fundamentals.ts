import { FundamentalContext, FundamentalEngine } from '../engine/FundamentalEngine';
import { EconomicEvent } from '../providers/FundamentalProvider';
import { parseUtcTimestampMs } from '../utils/time';

/** Evaluates fundamental context for an instrument requiring fresh HEALTHY calendar sync within 2h. */
export async function evaluateInstrumentFundamentalContext(
  db: D1Database,
  instrument: string
): Promise<{ context: FundamentalContext }> {
  const { results: events } = await db
    .prepare(`SELECT * FROM economic_events ORDER BY timestamp DESC LIMIT 100`)
    .all();

  let calHealthStatus: string | undefined;
  let calLastSuccessMs: number | null = null;
  try {
    const calRow = (await db
      .prepare(`SELECT status, last_successful_sync FROM provider_health_state WHERE service_type = 'ECONOMIC_CALENDAR' LIMIT 1`)
      .first()) as { status?: string; last_successful_sync?: string | null } | null;
    calHealthStatus = calRow?.status;
    calLastSuccessMs = parseUtcTimestampMs(calRow?.last_successful_sync);
  } catch {
    calHealthStatus = undefined;
  }

  const eventsArr = (events || []) as unknown as EconomicEvent[];
  const nowMs = Date.now();
  const calFreshWithin2h = calLastSuccessMs !== null && nowMs - calLastSuccessMs <= 2 * 60 * 60 * 1000;
  const calendarDataAvailable = calHealthStatus === 'HEALTHY' && calFreshWithin2h;

  const fundamentalEngine = new FundamentalEngine();
  return {
    context: fundamentalEngine.evaluateContext(instrument, eventsArr, new Date(nowMs), {
      calendarDataAvailable,
    }),
  };
}
