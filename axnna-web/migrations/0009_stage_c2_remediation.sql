-- Migration 0009: Stage C.2 Audit Remediation (Leases, Rate Limits, Recap Retries, Retention Indexes)

CREATE TABLE IF NOT EXISTS sync_leases (
  lock_name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket_key TEXT PRIMARY KEY,
  window_start DATETIME NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_updated
  ON rate_limit_counters(updated_at);

ALTER TABLE daily_recap_deliveries ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE daily_recap_deliveries ADD COLUMN last_error TEXT;
ALTER TABLE daily_recap_deliveries ADD COLUMN next_retry_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_daily_recap_retry
  ON daily_recap_deliveries(recap_date, status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_started
  ON scheduled_job_runs(started_at DESC);

-- Remove legacy unhashed IP/local client_key entries from admin_login_attempts
DELETE FROM admin_login_attempts
WHERE length(client_key) < 32 OR instr(client_key, '.') > 0 OR instr(client_key, ':') > 0;
