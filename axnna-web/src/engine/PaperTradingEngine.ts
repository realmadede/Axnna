import { InternalCandle } from '../core-engine/MarketData';
import { CandidateSetup } from '../core-engine/Types';
import { getInstrumentCosts } from '../core-engine/BacktestEngine';
import { parseUtcTimestampMs } from '../utils/time';

export interface PaperAccountRow {
  id: string;
  name: string;
  starting_balance: number;
  current_balance: number;
  risk_per_trade_percent: number;
  currency: string;
  updated_at: string;
}

export interface PaperTradeRow {
  id: string;
  account_id: string;
  signal_id: string;
  instrument: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  strategy_id: string;
  strategy_version: string;
  intended_entry: number;
  stop_loss: number;
  target_price: number;
  entry_price: number | null;
  exit_price: number | null;
  risk_amount: number;
  status: 'PENDING_ENTRY' | 'ACTIVE_TRADE' | 'TARGET_HIT' | 'STOP_HIT' | 'EXPIRED' | 'INVALIDATED';
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'CANCELLED' | 'EXPIRED' | null;
  gross_pnl: number | null;
  estimated_costs: number;
  net_pnl: number | null;
  r_multiple: number | null;
  spread_pips: number;
  slippage_pips: number;
  commission_pips: number;
  signal_timestamp: string;
  entry_timestamp: string | null;
  exit_timestamp: string | null;
  last_evaluated_candle_timestamp: string | null;
  unrealized_pnl?: number | null;
  unrealized_r?: number | null;
  duration_ms?: number | null;
}

const PENDING_EXPIRY_MS = 15 * 60 * 1000; // Strictly >15m (3 completed 5M candles)

function buildAuditInsertStmt(
  db: D1Database,
  eventType: string,
  metadata: Record<string, unknown>
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO audit_events (event_id, event_type, metadata, actor_source) VALUES (?, ?, ?, 'PAPER_ENGINE')`)
    .bind(crypto.randomUUID(), eventType, JSON.stringify(metadata));
}

async function recordPaperAudit(
  db: D1Database,
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await buildAuditInsertStmt(db, eventType, metadata).run();
  } catch {
    // Non-fatal if audit insert fails in partial test DBs
  }
}

export async function ensureDefaultPaperAccount(db: D1Database): Promise<PaperAccountRow> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO paper_accounts (id, name, starting_balance, current_balance, risk_per_trade_percent, currency)
       VALUES ('default', 'Axnna Simulation Account', 10000.0, 10000.0, 1.0, 'USD')`
    )
    .run();
  const row = await db
    .prepare(`SELECT * FROM paper_accounts WHERE id = 'default'`)
    .first() as PaperAccountRow | null;
  return (
    row || {
      id: 'default',
      name: 'Axnna Simulation Account',
      starting_balance: 10000,
      current_balance: 10000,
      risk_per_trade_percent: 1.0,
      currency: 'USD',
      updated_at: new Date().toISOString(),
    }
  );
}

/**
 * Registers a deterministic paper trade for a Risk-Gate APPROVED signal.
 * Idempotent on `signal_id`: duplicate calls never create duplicate trades.
 */
export async function registerPaperTradeFromApprovedSignal(
  db: D1Database,
  signal: CandidateSetup,
  strategyId: string
): Promise<{ created: boolean; tradeId?: string }> {
  if (
    typeof signal.entryPrice !== 'number' ||
    typeof signal.stopLossPrice !== 'number' ||
    typeof signal.structuralTargetPrice !== 'number'
  ) {
    return { created: false };
  }

  const account = await ensureDefaultPaperAccount(db);
  const costs = getInstrumentCosts(signal.symbol);
  const riskAmount = Math.max(0, account.current_balance * (account.risk_per_trade_percent / 100));
  const tradeId = `paper_${signal.setupId}`;
  const signalIso = new Date(signal.detectionTimestamp).toISOString();

  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO paper_trades (
         id, account_id, signal_id, instrument, timeframe, direction, strategy_id, strategy_version,
         intended_entry, stop_loss, target_price, risk_amount, status,
         spread_pips, slippage_pips, commission_pips,
         signal_timestamp, last_evaluated_candle_timestamp
       ) VALUES (?, 'default', ?, ?, '5M', ?, ?, ?, ?, ?, ?, ?, 'PENDING_ENTRY', ?, ?, ?, ?, ?)`
    )
    .bind(
      tradeId,
      signal.setupId,
      signal.symbol,
      signal.direction,
      strategyId,
      signal.strategyVersion,
      signal.entryPrice,
      signal.stopLossPrice,
      signal.structuralTargetPrice,
      riskAmount,
      costs.spreadPips,
      costs.slippagePips,
      costs.commissionPips,
      signalIso,
      signalIso
    )
    .run();

  const changes = Number((res as any)?.meta?.changes ?? 0);
  if (changes > 0) {
    await recordPaperAudit(db, 'PAPER_TRADE_CREATED', {
      tradeId,
      signalId: signal.setupId,
      instrument: signal.symbol,
      direction: signal.direction,
      intendedEntry: signal.entryPrice,
      stopLoss: signal.stopLossPrice,
      targetPrice: signal.structuralTargetPrice,
      riskAmount,
    });
    return { created: true, tradeId };
  }

  return { created: false, tradeId };
}

/**
 * Steps strictly forward through completed 5M candles strictly newer than each open trade's
 * last evaluated timestamp (preventing look-ahead bias and enforcing stop-first ambiguity resolution).
 */
export async function evaluateOpenPaperTrades(
  db: D1Database,
  instrument?: string,
  candlesByInstrument?: Record<string, InternalCandle[]>
): Promise<{ evaluated: number; transitions: number }> {
  let query = `SELECT * FROM paper_trades WHERE status IN ('PENDING_ENTRY', 'ACTIVE_TRADE')`;
  const binds: unknown[] = [];
  if (instrument) {
    query += ` AND instrument = ?`;
    binds.push(instrument);
  }
  query += ` ORDER BY signal_timestamp ASC`;

  const { results: openTrades } = (binds.length > 0
    ? await db.prepare(query).bind(...binds).all()
    : await db.prepare(query).all()) as { results: PaperTradeRow[] };

  if (!openTrades || openTrades.length === 0) {
    return { evaluated: 0, transitions: 0 };
  }

  let transitions = 0;

  for (const trade of openTrades) {
    const lastEvalMs =
      parseUtcTimestampMs(trade.last_evaluated_candle_timestamp) ??
      parseUtcTimestampMs(trade.signal_timestamp) ??
      0;
    const signalMs = parseUtcTimestampMs(trade.signal_timestamp) ?? 0;

    let candles: InternalCandle[];
    if (candlesByInstrument && candlesByInstrument[trade.instrument]) {
      candles = [...candlesByInstrument[trade.instrument]]
        .filter((c) => c.timeframe === '5M' && c.isCompleted !== false && c.timestamp > lastEvalMs)
        .sort((a, b) => a.timestamp - b.timestamp);
    } else {
      const lastEvalIso = new Date(lastEvalMs).toISOString();
      const { results: rows } = await db
        .prepare(
          `SELECT instrument, timeframe, timestamp, open, high, low, close
           FROM market_candles
           WHERE instrument = ? AND timeframe = '5M' AND timestamp > ?
           ORDER BY timestamp ASC
           LIMIT 500`
        )
        .bind(trade.instrument, lastEvalIso)
        .all();
      candles = (rows || []).map((r: any) => ({
        symbol: r.instrument,
        timeframe: r.timeframe,
        timestamp: parseUtcTimestampMs(r.timestamp) ?? 0,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        isCompleted: true,
        priceBasis: 'provider_ohlc_unspecified',
      }));
    }

    if (candles.length === 0) continue;

    const costs = getInstrumentCosts(trade.instrument);
    const pipSize = costs.pipSize;
    const halfSpread = (trade.spread_pips * pipSize) / 2;
    const slippageRaw = trade.slippage_pips * pipSize;

    let status = trade.status;
    let entryPrice = trade.entry_price;
    let entryTs = trade.entry_timestamp;
    let exitPrice = trade.exit_price;
    let exitTs = trade.exit_timestamp;
    let outcome = trade.outcome;
    let grossPnl = trade.gross_pnl;
    let estimatedCosts = trade.estimated_costs;
    let netPnl = trade.net_pnl;
    let rMultiple = trade.r_multiple;
    let latestProcessedIso = trade.last_evaluated_candle_timestamp;

    for (const c of candles) {
      if (c.timestamp <= signalMs) continue;
      const candleIso = new Date(c.timestamp).toISOString();
      latestProcessedIso = candleIso;

      if (status === 'PENDING_ENTRY') {
        // Expiry (>15m) must be checked strictly BEFORE fill or stop-pre-breach evaluation
        if (c.timestamp - signalMs > PENDING_EXPIRY_MS) {
          status = 'EXPIRED';
          outcome = 'EXPIRED';
          exitTs = candleIso;
          grossPnl = 0;
          estimatedCosts = 0;
          netPnl = 0;
          rMultiple = 0;
          transitions++;
          break;
        }

        const stopPreHit =
          trade.direction === 'LONG'
            ? c.low - halfSpread <= trade.stop_loss
            : c.high + halfSpread >= trade.stop_loss;
        const entryHit =
          trade.direction === 'LONG'
            ? c.low + halfSpread <= trade.intended_entry
            : c.high - halfSpread >= trade.intended_entry;

        if (stopPreHit) {
          status = 'INVALIDATED';
          outcome = 'CANCELLED';
          exitTs = candleIso;
          grossPnl = 0;
          estimatedCosts = 0;
          netPnl = 0;
          rMultiple = 0;
          transitions++;
          break;
        }

        if (entryHit) {
          entryPrice =
            trade.direction === 'LONG'
              ? trade.intended_entry + slippageRaw
              : trade.intended_entry - slippageRaw;
          entryTs = candleIso;
          status = 'ACTIVE_TRADE';
          transitions++;
          // Conservative: wait for the next completed 5M bar before checking target/stop exit
          continue;
        }
      } else if (status === 'ACTIVE_TRADE' && entryPrice !== null) {
        let hitTarget = false;
        let hitStop = false;

        if (trade.direction === 'LONG') {
          if (c.high - halfSpread >= trade.target_price) hitTarget = true;
          if (c.low - halfSpread <= trade.stop_loss) hitStop = true;
        } else {
          if (c.low + halfSpread <= trade.target_price) hitTarget = true;
          if (c.high + halfSpread >= trade.stop_loss) hitStop = true;
        }

        // Conservative tie-breaker: stop-first when both hit within same 5M candle
        if (hitTarget && hitStop) {
          hitTarget = false;
        }

        if (hitStop || hitTarget) {
          if (hitStop) {
            status = 'STOP_HIT';
            outcome = 'LOSS';
            exitPrice =
              trade.direction === 'LONG'
                ? trade.stop_loss - slippageRaw
                : trade.stop_loss + slippageRaw;
          } else {
            status = 'TARGET_HIT';
            outcome = 'WIN';
            exitPrice = trade.target_price;
          }
          exitTs = candleIso;

          const initialRiskRaw = Math.abs(entryPrice - trade.stop_loss);
          const grossDist =
            trade.direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
          const grossR = initialRiskRaw > 0 ? grossDist / initialRiskRaw : 0;
          const costRaw = (trade.spread_pips + trade.commission_pips) * pipSize;
          const costR = initialRiskRaw > 0 ? costRaw / initialRiskRaw : 0;
          rMultiple = grossR - costR;
          grossPnl = grossR * trade.risk_amount;
          estimatedCosts = costR * trade.risk_amount;
          netPnl = rMultiple * trade.risk_amount;

          if (Math.abs(rMultiple) < 1e-6) {
            outcome = 'BREAKEVEN';
          }

          transitions++;
          break;
        }
      }
    }

    const updateTradeStmt = db
      .prepare(
        `UPDATE paper_trades
         SET status = ?, entry_price = ?, entry_timestamp = ?, exit_price = ?, exit_timestamp = ?,
             outcome = ?, gross_pnl = ?, estimated_costs = ?, net_pnl = ?, r_multiple = ?,
             last_evaluated_candle_timestamp = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('PENDING_ENTRY', 'ACTIVE_TRADE')`
      )
      .bind(
        status,
        entryPrice,
        entryTs,
        exitPrice,
        exitTs,
        outcome,
        grossPnl,
        estimatedCosts,
        netPnl,
        rMultiple,
        latestProcessedIso,
        trade.id
      );

    const batchStmts: D1PreparedStatement[] = [updateTradeStmt];

    if (status === 'TARGET_HIT' || status === 'STOP_HIT') {
      // Derive current_balance atomically from starting_balance + SUM(closed net_pnl) inside the same D1 batch
      batchStmts.push(
        db
          .prepare(
            `UPDATE paper_accounts
             SET current_balance = starting_balance + COALESCE(
                   (SELECT SUM(net_pnl) FROM paper_trades WHERE account_id = ? AND status IN ('TARGET_HIT', 'STOP_HIT')),
                   0
                 ),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
          .bind(trade.account_id, trade.account_id),
        buildAuditInsertStmt(db, 'PAPER_TRADE_CLOSED', {
          tradeId: trade.id,
          signalId: trade.signal_id,
          status,
          outcome,
          exitPrice,
          netPnl,
          rMultiple,
          timestamp: exitTs,
        })
      );
    } else if (status === 'EXPIRED') {
      batchStmts.push(
        buildAuditInsertStmt(db, 'PAPER_TRADE_EXPIRED', {
          tradeId: trade.id,
          signalId: trade.signal_id,
          timestamp: exitTs,
        })
      );
    } else if (status === 'INVALIDATED') {
      batchStmts.push(
        buildAuditInsertStmt(db, 'PAPER_TRADE_INVALIDATED', {
          tradeId: trade.id,
          signalId: trade.signal_id,
          timestamp: exitTs,
          reason: 'Stop level breached before limit entry fill',
        })
      );
    } else if (trade.status === 'PENDING_ENTRY' && status === 'ACTIVE_TRADE') {
      batchStmts.push(
        buildAuditInsertStmt(db, 'PAPER_TRADE_FILLED', {
          tradeId: trade.id,
          signalId: trade.signal_id,
          entryPrice,
          timestamp: entryTs,
        })
      );
    }

    await db.batch(batchStmts);
    // Note: signals.status is preserved strictly for signal qualification/alert history (not overwritten with trade states).
  }

  return { evaluated: openTrades.length, transitions };
}

export interface PaperPortfolioOverview {
  mode: 'SIMULATION_ONLY';
  summaryScope: 'ALL_ACCOUNT_TRADES';
  filteredTotal: number;
  account: PaperAccountRow;
  summary: {
    startingBalance: number;
    currentBalance: number;
    realizedPnl: number;
    unrealizedPnl: number;
    openPositions: number;
    pendingPositions: number;
    closedPositions: number;
    cancelledOrExpired: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number | null;
    expectancyPnl: number;
    averageR: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
  };
  equityCurve: Array<{ timestamp: string; balance: number; signalId: string }>;
  byInstrument: Array<{ instrument: string; trades: number; wins: number; losses: number; netPnl: number; totalR: number }>;
  byStrategyVersion: Array<{ strategyVersion: string; trades: number; wins: number; losses: number; netPnl: number; totalR: number }>;
  trades: PaperTradeRow[];
}

export async function getPaperPortfolioOverview(
  db: D1Database,
  filters?: { instrument?: string; strategyVersion?: string; limit?: number; offset?: number }
): Promise<PaperPortfolioOverview> {
  const account = await ensureDefaultPaperAccount(db);

  const { results: allTrades } = (await db
    .prepare(`SELECT * FROM paper_trades ORDER BY signal_timestamp ASC, id ASC`)
    .all()) as { results: PaperTradeRow[] };

  const { results: latestCloses } = (await db
    .prepare(
      `SELECT mc.instrument, mc.close
       FROM market_candles mc
       INNER JOIN (
         SELECT instrument, MAX(timestamp) as max_ts
         FROM market_candles
         WHERE timeframe = '5M'
         GROUP BY instrument
       ) latest ON mc.instrument = latest.instrument AND mc.timestamp = latest.max_ts AND mc.timeframe = '5M'`
    )
    .all()) as { results: Array<{ instrument: string; close: number }> };

  const priceByInst = new Map<string, number>();
  for (const row of latestCloses || []) {
    priceByInst.set(row.instrument, Number(row.close));
  }

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let openPositions = 0;
  let pendingPositions = 0;
  let closedPositions = 0;
  let cancelledOrExpired = 0;
  let wins = 0;
  let losses = 0;
  let grossWinPnl = 0;
  let grossLossAbs = 0;
  let totalR = 0;

  let runningBalance = account.starting_balance;
  let peakBalance = account.starting_balance;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;

  const equityCurve: Array<{ timestamp: string; balance: number; signalId: string }> = [];
  const instMap = new Map<string, { trades: number; wins: number; losses: number; netPnl: number; totalR: number }>();
  const verMap = new Map<string, { trades: number; wins: number; losses: number; netPnl: number; totalR: number }>();

  const closedTrades: PaperTradeRow[] = [];
  const enrichedTrades: PaperTradeRow[] = [];

  for (const t of allTrades || []) {
    let curUnrealizedPnl: number | null = null;
    let curUnrealizedR: number | null = null;

    if (t.status === 'PENDING_ENTRY') {
      pendingPositions++;
    } else if (t.status === 'ACTIVE_TRADE' && t.entry_price !== null) {
      openPositions++;
      const mark = priceByInst.get(t.instrument);
      if (mark !== undefined) {
        const costs = getInstrumentCosts(t.instrument);
        const halfSpread = (t.spread_pips * costs.pipSize) / 2;
        const exitMark = t.direction === 'LONG' ? mark - halfSpread : mark + halfSpread;
        const riskDist = Math.abs(t.entry_price - t.stop_loss);
        if (riskDist > 0) {
          const dist = t.direction === 'LONG' ? exitMark - t.entry_price : t.entry_price - exitMark;
          curUnrealizedR = dist / riskDist;
          curUnrealizedPnl = curUnrealizedR * t.risk_amount;
          unrealizedPnl += curUnrealizedPnl;
        }
      }
    } else if (t.status === 'TARGET_HIT' || t.status === 'STOP_HIT') {
      closedPositions++;
      closedTrades.push(t);
      const net = Number(t.net_pnl ?? 0);
      const r = Number(t.r_multiple ?? 0);
      realizedPnl += net;
      totalR += r;

      if (t.outcome === 'WIN') {
        wins++;
        grossWinPnl += net;
      } else if (t.outcome === 'LOSS') {
        losses++;
        grossLossAbs += Math.abs(net);
      }

      const instBucket = instMap.get(t.instrument) || { trades: 0, wins: 0, losses: 0, netPnl: 0, totalR: 0 };
      instBucket.trades++;
      if (t.outcome === 'WIN') instBucket.wins++;
      if (t.outcome === 'LOSS') instBucket.losses++;
      instBucket.netPnl += net;
      instBucket.totalR += r;
      instMap.set(t.instrument, instBucket);

      const verBucket = verMap.get(t.strategy_version) || { trades: 0, wins: 0, losses: 0, netPnl: 0, totalR: 0 };
      verBucket.trades++;
      if (t.outcome === 'WIN') verBucket.wins++;
      if (t.outcome === 'LOSS') verBucket.losses++;
      verBucket.netPnl += net;
      verBucket.totalR += r;
      verMap.set(t.strategy_version, verBucket);
    } else {
      cancelledOrExpired++;
    }

    const entryMs = parseUtcTimestampMs(t.entry_timestamp);
    const exitMs = parseUtcTimestampMs(t.exit_timestamp);
    const durationMs = entryMs !== null && exitMs !== null && exitMs >= entryMs ? exitMs - entryMs : null;

    enrichedTrades.push({
      ...t,
      unrealized_pnl: curUnrealizedPnl,
      unrealized_r: curUnrealizedR,
      duration_ms: durationMs,
    });
  }

  // Chronological realized equity curve & max drawdown strictly ordered by exit_timestamp ASC, id ASC
  closedTrades.sort((a, b) => {
    const aExit = parseUtcTimestampMs(a.exit_timestamp) ?? parseUtcTimestampMs(a.signal_timestamp) ?? 0;
    const bExit = parseUtcTimestampMs(b.exit_timestamp) ?? parseUtcTimestampMs(b.signal_timestamp) ?? 0;
    if (aExit !== bExit) return aExit - bExit;
    return a.id.localeCompare(b.id);
  });

  for (const ct of closedTrades) {
    runningBalance += Number(ct.net_pnl ?? 0);
    if (runningBalance > peakBalance) peakBalance = runningBalance;
    const dd = peakBalance - runningBalance;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPercent = peakBalance > 0 ? (dd / peakBalance) * 100 : 0;
    }
    if (ct.exit_timestamp) {
      equityCurve.push({ timestamp: ct.exit_timestamp, balance: Number(runningBalance.toFixed(2)), signalId: ct.signal_id });
    }
  }

  const filtered = enrichedTrades
    .filter((t) => (!filters?.instrument || filters.instrument === 'ALL' ? true : t.instrument === filters.instrument))
    .filter((t) =>
      !filters?.strategyVersion || filters.strategyVersion === 'ALL'
        ? true
        : t.strategy_version === filters.strategyVersion
    )
    .reverse(); // Newest first

  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? 25;

  return {
    mode: 'SIMULATION_ONLY',
    summaryScope: 'ALL_ACCOUNT_TRADES',
    filteredTotal: filtered.length,
    account,
    summary: {
      startingBalance: account.starting_balance,
      currentBalance: account.current_balance,
      realizedPnl,
      unrealizedPnl,
      openPositions,
      pendingPositions,
      closedPositions,
      cancelledOrExpired,
      wins,
      losses,
      winRate: closedPositions > 0 ? (wins / closedPositions) * 100 : 0,
      profitFactor: grossLossAbs > 0 ? grossWinPnl / grossLossAbs : grossWinPnl > 0 ? null : null,
      expectancyPnl: closedPositions > 0 ? realizedPnl / closedPositions : 0,
      averageR: closedPositions > 0 ? totalR / closedPositions : 0,
      maxDrawdown,
      maxDrawdownPercent,
    },
    equityCurve,
    byInstrument: Array.from(instMap.entries()).map(([instrument, v]) => ({ instrument, ...v })),
    byStrategyVersion: Array.from(verMap.entries()).map(([strategyVersion, v]) => ({ strategyVersion, ...v })),
    trades: filtered.slice(offset, offset + limit),
  };
}
