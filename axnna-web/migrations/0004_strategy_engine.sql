-- Migration 0004: Strategy Engine State

-- Seed the initial AXNNA V1 strategy
INSERT OR IGNORE INTO strategies (id, strategy_id, name, active_status, description)
VALUES ('strat_v1_fvg', 'AXNNA_V1_LIQUIDITY_FVG', 'Liquidity Sweep + FVG', 'ACTIVE', 'Primary V1 Engine');

INSERT OR IGNORE INTO strategy_versions (id, strategy_id, version, specification_reference, status)
VALUES ('strat_v1_fvg_v4', 'AXNNA_V1_LIQUIDITY_FVG', '4', 'Draft_v4', 'ACTIVE');

-- Persistent Strategy Engine State
CREATE TABLE strategy_state (
    instrument TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    
    last_processed_5m_timestamp DATETIME,
    
    -- Serialized state machine JSON to persist ATR, Swings, Bias, and Setup status across worker restarts
    state_payload TEXT NOT NULL,
    
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (instrument, strategy_id, strategy_version)
);
