-- Migration 0011: Stage D.2 Release Integrity, Atomic Claim States, and Signal Alert Preservation

-- 1. Support 'SENDING' atomic claim state in notification_deliveries
CREATE TABLE notification_deliveries_new (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES signals(signal_id),
  axnna_user_id TEXT NOT NULL REFERENCES axnna_users(id),
  channel TEXT NOT NULL DEFAULT 'TELEGRAM',
  destination TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'RETRY_SCHEDULED', 'PERMANENT_FAILURE', 'EXHAUSTED')
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
  provider_message_id, attempt_count, last_attempt_at, delivered_at, created_at,
  last_error, last_http_status, next_retry_at
)
SELECT
  id, signal_id, axnna_user_id, channel, destination, status,
  provider_message_id, attempt_count, last_attempt_at, delivered_at, created_at,
  last_error, last_http_status, next_retry_at
FROM notification_deliveries;

DROP TABLE notification_deliveries;
ALTER TABLE notification_deliveries_new RENAME TO notification_deliveries;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_retry
  ON notification_deliveries(status, next_retry_at);

-- 2. Support 'SENDING' atomic claim state in daily_recap_deliveries
CREATE TABLE daily_recap_deliveries_new (
  id TEXT PRIMARY KEY,
  recap_date TEXT NOT NULL,
  axnna_user_id TEXT NOT NULL REFERENCES axnna_users(id),
  status TEXT NOT NULL CHECK (status IN ('SENDING', 'SENT', 'FAILED')),
  provider_message_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  next_retry_at DATETIME,
  UNIQUE(recap_date, axnna_user_id)
);

INSERT INTO daily_recap_deliveries_new (
  id, recap_date, axnna_user_id, status, provider_message_id, created_at,
  attempt_count, last_error, next_retry_at
)
SELECT
  id, recap_date, axnna_user_id, status, provider_message_id, created_at,
  attempt_count, last_error, next_retry_at
FROM daily_recap_deliveries;

DROP TABLE daily_recap_deliveries;
ALTER TABLE daily_recap_deliveries_new RENAME TO daily_recap_deliveries;

CREATE INDEX IF NOT EXISTS idx_daily_recap_retry
  ON daily_recap_deliveries(recap_date, status, next_retry_at);

-- 3. Restore original qualification/alert status for signals previously overwritten by paper_trades lifecycle
UPDATE signals
SET status = CASE
  WHEN EXISTS (
    SELECT 1 FROM notification_deliveries nd
    WHERE nd.signal_id = signals.signal_id AND nd.status = 'SENT'
  ) THEN 'ALERTED'
  ELSE 'ALERT_ELIGIBLE'
END
WHERE EXISTS (SELECT 1 FROM paper_trades pt WHERE pt.signal_id = signals.signal_id)
  AND status IN ('ACTIVE_TRADE', 'TARGET_HIT', 'STOP_HIT', 'EXPIRED', 'INVALIDATED');

-- 4. Indexes for chronological exit curve calculation and bounded economic_events retention
CREATE INDEX IF NOT EXISTS idx_paper_trades_exit_chronology
  ON paper_trades(account_id, exit_timestamp ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_economic_events_timestamp
  ON economic_events(timestamp DESC);
