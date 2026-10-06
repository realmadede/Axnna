-- Initial D1 Schema for Axnna Platform (Multi-Strategy, Telegram-First)

-- Axnna Users (Central Identity)
CREATE TABLE axnna_users (
    id TEXT PRIMARY KEY,
    telegram_user_id TEXT UNIQUE NOT NULL,
    telegram_chat_id TEXT NOT NULL,
    telegram_username_snapshot TEXT,
    telegram_first_name_snapshot TEXT,
    telegram_last_name_snapshot TEXT,
    status TEXT NOT NULL CHECK (status IN ('CONNECTED', 'DISCONNECTED')),
    signal_notifications_enabled INTEGER NOT NULL DEFAULT 1,
    connected_at DATETIME NOT NULL,
    last_seen_at DATETIME,
    disconnected_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Telegram Connection Sessions
CREATE TABLE telegram_connection_sessions (
    id TEXT PRIMARY KEY,
    connection_token TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONNECTED', 'EXPIRED', 'CANCELLED')),
    axnna_user_id TEXT REFERENCES axnna_users(id),
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Registry
CREATE TABLE strategies (
    id TEXT PRIMARY KEY,
    strategy_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    active_status TEXT NOT NULL CHECK (active_status IN ('DRAFT', 'VALIDATION', 'ACTIVE', 'DISABLED', 'RETIRED')),
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE strategy_versions (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    version TEXT NOT NULL,
    specification_reference TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'VALIDATION', 'ACTIVE', 'RETIRED')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(strategy_id, version)
);

-- Market Data State
CREATE TABLE market_data_state (
    instrument TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    provider TEXT NOT NULL,
    last_completed_candle DATETIME,
    last_successful_fetch DATETIME,
    status TEXT NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'FAILED')),
    error_count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (instrument, timeframe)
);

-- Signals (Tied strictly to Strategy/Version)
CREATE TABLE signals (
    signal_id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    strategy_version TEXT NOT NULL,
    instrument TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    generated_at DATETIME NOT NULL,
    anchor_timeframe TEXT NOT NULL,
    execution_timeframe TEXT NOT NULL,
    entry REAL NOT NULL,
    structural_stop REAL NOT NULL,
    structural_target REAL NOT NULL,
    structural_rr REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING_ENTRY', 'ACTIVE_TRADE', 'TARGET_HIT', 'STOP_HIT', 'EXPIRED', 'INVALIDATED'))
);

-- Notification Deliveries (Idempotent delivery tracking)
CREATE TABLE notification_deliveries (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL REFERENCES signals(signal_id),
    axnna_user_id TEXT NOT NULL REFERENCES axnna_users(id),
    channel TEXT NOT NULL DEFAULT 'TELEGRAM',
    destination TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    provider_message_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at DATETIME,
    delivered_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(signal_id, axnna_user_id, channel)
);

-- Audit Events
CREATE TABLE audit_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    axnna_user_id TEXT REFERENCES axnna_users(id),
    metadata TEXT,
    actor_source TEXT NOT NULL
);

-- System Configuration
CREATE TABLE system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
