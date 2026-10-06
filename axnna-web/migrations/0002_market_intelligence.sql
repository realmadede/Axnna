-- Migration 0002: Market Intelligence & Fundamental Foundation

-- Economic Events (Finnhub Calendar)
CREATE TABLE economic_events (
    id TEXT PRIMARY KEY,
    country TEXT NOT NULL,
    currency TEXT NOT NULL,
    event TEXT NOT NULL,
    timestamp DATETIME NOT NULL,
    importance TEXT NOT NULL CHECK (importance IN ('LOW', 'MEDIUM', 'HIGH')),
    estimate TEXT,
    previous TEXT,
    actual TEXT,
    source TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Fundamental Observations (Macro Entity State: USD, EUR, GBP, JPY, XAU)
CREATE TABLE fundamental_observations (
    id TEXT PRIMARY KEY,
    macro_entity TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('INFLATION', 'GROWTH', 'EMPLOYMENT', 'MONETARY_POLICY', 'CONSUMPTION', 'TRADE', 'UNCERTAINTY', 'MOMENTUM')),
    metric TEXT NOT NULL,
    latest_value TEXT NOT NULL,
    previous_value TEXT,
    trend TEXT CHECK (trend IN ('IMPROVING', 'DETERIORATING', 'STABLE', 'MIXED')),
    timestamp DATETIME NOT NULL,
    source TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Central Bank Events
CREATE TABLE central_bank_events (
    id TEXT PRIMARY KEY,
    central_bank TEXT NOT NULL CHECK (central_bank IN ('FEDERAL_RESERVE', 'EUROPEAN_CENTRAL_BANK', 'BANK_OF_ENGLAND', 'BANK_OF_JAPAN')),
    event_type TEXT NOT NULL CHECK (event_type IN ('RATE_DECISION', 'MEETING_MINUTES', 'SPEECH', 'PRESS_CONFERENCE')),
    decision_date DATETIME NOT NULL,
    policy_rate TEXT,
    previous_rate TEXT,
    policy_direction TEXT CHECK (policy_direction IN ('HAWKISH', 'DOVISH', 'NEUTRAL')),
    next_scheduled_meeting DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- News Items
CREATE TABLE news_items (
    id TEXT PRIMARY KEY,
    timestamp DATETIME NOT NULL,
    headline TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    related_entities TEXT, -- JSON array of related currencies/countries
    category TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Provider Health for Fundamental/Finnhub
CREATE TABLE provider_health_state (
    provider_name TEXT PRIMARY KEY,
    service_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'FAILED')),
    last_successful_sync DATETIME,
    last_failure DATETIME,
    error_count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attach Market Context to existing signals
-- SQLite ALTER TABLE does not support adding JSON columns easily if we want constraints, but TEXT is fine.
ALTER TABLE signals ADD COLUMN market_context TEXT;
ALTER TABLE signals ADD COLUMN explanation TEXT;
