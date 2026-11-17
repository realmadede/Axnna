-- Migration 0010: Stage D Independent Risk Gate & Persisted Paper Trading Lifecycle

CREATE TABLE IF NOT EXISTS paper_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starting_balance REAL NOT NULL DEFAULT 10000.0 CHECK (starting_balance > 0),
  current_balance REAL NOT NULL DEFAULT 10000.0,
  risk_per_trade_percent REAL NOT NULL DEFAULT 1.0 CHECK (risk_per_trade_percent > 0 AND risk_per_trade_percent <= 10.0),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO paper_accounts (id, name, starting_balance, current_balance, risk_per_trade_percent, currency)
VALUES ('default', 'Axnna Simulation Account', 10000.0, 10000.0, 1.0, 'USD');

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES paper_accounts(id),
  signal_id TEXT UNIQUE NOT NULL REFERENCES signals(signal_id),
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '5M',
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  strategy_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  intended_entry REAL NOT NULL,
  stop_loss REAL NOT NULL,
  target_price REAL NOT NULL,
  entry_price REAL,
  exit_price REAL,
  risk_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('PENDING_ENTRY', 'ACTIVE_TRADE', 'TARGET_HIT', 'STOP_HIT', 'EXPIRED', 'INVALIDATED')),
  outcome TEXT CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'CANCELLED', 'EXPIRED')),
  gross_pnl REAL,
  estimated_costs REAL NOT NULL DEFAULT 0,
  net_pnl REAL,
  r_multiple REAL,
  spread_pips REAL NOT NULL DEFAULT 0,
  slippage_pips REAL NOT NULL DEFAULT 0,
  commission_pips REAL NOT NULL DEFAULT 0,
  signal_timestamp DATETIME NOT NULL,
  entry_timestamp DATETIME,
  exit_timestamp DATETIME,
  last_evaluated_candle_timestamp DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_account_status
  ON paper_trades(account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paper_trades_instrument_version
  ON paper_trades(instrument, strategy_version, created_at DESC);

CREATE TABLE IF NOT EXISTS risk_decisions (
  id TEXT PRIMARY KEY,
  signal_id TEXT UNIQUE NOT NULL REFERENCES signals(signal_id),
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  strategy_version TEXT NOT NULL,
  technical_score REAL NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reason_code TEXT NOT NULL,
  reason_detail TEXT,
  event_risk TEXT,
  confluence TEXT,
  evaluated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_risk_decisions_decision
  ON risk_decisions(decision, evaluated_at DESC);
