-- Migration 0007: Stage B Signal Lifecycle, Delivery Retries, and Admin Hardening

CREATE TABLE signals_new (
  signal_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
  strategy_version TEXT NOT NULL,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  generated_at DATETIME NOT NULL,
  anchor_timeframe TEXT NOT NULL,
  execution_timeframe TEXT NOT NULL,
  entry REAL,
  structural_stop REAL,
  structural_target REAL,
  structural_rr REAL,
  status TEXT NOT NULL CHECK (
    status IN (
      'DETECTED',
      'QUALIFIED',
      'REJECTED',
      'EXPIRED',
      'ALERT_ELIGIBLE',
      'ALERTED',
      'PENDING_ENTRY',
      'ACTIVE_TRADE',
      'TARGET_HIT',
      'STOP_HIT',
      'INVALIDATED'
    )
  ),
  market_context TEXT,
  explanation TEXT,
  technical_score REAL,
  rejection_reason TEXT,
  evidence_payload TEXT
);

INSERT INTO signals_new (
  signal_id, strategy_id, strategy_version, instrument, direction,
  generated_at, anchor_timeframe, execution_timeframe,
  entry, structural_stop, structural_target, structural_rr,
  status, market_context, explanation, technical_score, rejection_reason, evidence_payload
)
SELECT
  signal_id, strategy_id, strategy_version, instrument, direction,
  generated_at, anchor_timeframe, execution_timeframe,
  entry, structural_stop, structural_target, structural_rr,
  status, market_context, explanation, technical_score, rejection_reason, evidence_payload
FROM signals;

CREATE TABLE notification_deliveries_new (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES signals_new(signal_id),
  axnna_user_id TEXT NOT NULL REFERENCES axnna_users(id),
  channel TEXT NOT NULL DEFAULT 'TELEGRAM',
  destination TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'SENT', 'FAILED', 'RETRY_SCHEDULED', 'PERMANENT_FAILURE', 'EXHAUSTED')
  ),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at DATETIME,
  delivered_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  last_http_status INTEGER,
  next_retry_at DATETIME,
  UNIQUE(signal_id, axnna_user_id, channel)
);

INSERT INTO notification_deliveries_new (
  id, signal_id, axnna_user_id, channel, destination, status,
  provider_message_id, attempt_count, last_attempt_at, delivered_at, created_at
)
SELECT
  id, signal_id, axnna_user_id, channel, destination, status,
  provider_message_id, attempt_count, last_attempt_at, delivered_at, created_at
FROM notification_deliveries;

DROP TABLE notification_deliveries;
DROP TABLE signals;
ALTER TABLE signals_new RENAME TO signals;
ALTER TABLE notification_deliveries_new RENAME TO notification_deliveries;

CREATE INDEX IF NOT EXISTS idx_signals_instrument_generated
  ON signals(instrument, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status
  ON signals(status, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_retry
  ON notification_deliveries(status, next_retry_at);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  client_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at DATETIME,
  locked_until DATETIME,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS revoked_admin_sessions (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  revoked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_config ("key", "value")
SELECT 'admin_session_version', '1'
WHERE NOT EXISTS (
  SELECT 1 FROM system_config WHERE "key" = 'admin_session_version'
);
