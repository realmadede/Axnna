-- Migration 0003: Real Market & Fundamental Data Ingestion

-- Canonical Market Candles
CREATE TABLE market_candles (
    id TEXT PRIMARY KEY,
    instrument TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    timestamp DATETIME NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    source_provider TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Unique constraint for idempotent synchronization
    UNIQUE(instrument, timeframe, timestamp)
);

-- Index for querying recent candles quickly
CREATE INDEX idx_market_candles_lookup ON market_candles(instrument, timeframe, timestamp DESC);

-- Index for Economic Events querying by currency and time
CREATE INDEX idx_economic_events_currency_time ON economic_events(currency, timestamp DESC);
CREATE INDEX idx_economic_events_importance ON economic_events(importance, timestamp DESC);
