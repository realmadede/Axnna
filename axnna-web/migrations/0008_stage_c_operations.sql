-- Migration 0008: Stage C Operational Visibility, Analytics, Security Events, Contact & Recap

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'PAGE_VIEW',
      'REGISTRATION_STARTED',
      'REGISTRATION_COMPLETED',
      'TELEGRAM_CONNECT_STARTED',
      'TELEGRAM_CONNECT_COMPLETED',
      'ALERT_PREF_UPDATED',
      'APP_ACTIVITY'
    )
  ),
  path TEXT NOT NULL,
  referrer TEXT,
  utm_source TEXT,
  device_category TEXT CHECK (device_category IN ('mobile', 'tablet', 'desktop', 'unknown')),
  browser_category TEXT,
  country_code TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_visitor ON analytics_events(visitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  source_category TEXT NOT NULL,
  actor_id TEXT,
  resource TEXT,
  details TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  resolved_at DATETIME,
  resolved_by TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_status ON security_events(resolution_status, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'SUCCEEDED', 'DEGRADED', 'FAILED')),
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  duration_ms INTEGER,
  summary TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_name ON scheduled_job_runs(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS contact_submissions (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (
    category IN ('General Inquiry', 'Bug Report', 'Feature Request', 'Account Assistance')
  ),
  message TEXT NOT NULL,
  contact_info TEXT,
  client_hash TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'REVIEWED', 'RESOLVED')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_created ON contact_submissions(created_at DESC);

CREATE TABLE IF NOT EXISTS daily_recap_deliveries (
  id TEXT PRIMARY KEY,
  recap_date TEXT NOT NULL,
  axnna_user_id TEXT NOT NULL REFERENCES axnna_users(id),
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED')),
  provider_message_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recap_date, axnna_user_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);
