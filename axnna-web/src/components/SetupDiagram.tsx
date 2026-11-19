export function SetupDiagram() {
  return (
    <div className="glass-card" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1rem' }}>
        <div>
          <span className="admin-kpi-label">Setup Geometry</span>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginTop: '0.15rem' }}>
            Sweep, Displacement, FVG &amp; Risk Gate
          </h3>
        </div>
        <span className="admin-badge admin-badge--ok mono">SCORE &gt;= 65 REQUIRED</span>
      </div>

      <div className="setup-diagram-split">
        <svg
          viewBox="0 0 720 250"
          role="img"
          aria-label="Diagram showing a liquidity sweep above a swing high, displacement candle creating a Fair Value Gap retracement entry, stop loss, target, and macro veto check"
          style={{ width: '100%', maxWidth: '580px', height: 'auto', display: 'block', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
        >
          <line x1="24" y1="52" x2="696" y2="52" stroke="var(--border-color)" strokeDasharray="4 4" />
          <line x1="24" y1="122" x2="696" y2="122" stroke="var(--border-color)" strokeDasharray="4 4" />
          <line x1="24" y1="196" x2="696" y2="196" stroke="var(--border-color)" strokeDasharray="4 4" />

          <line x1="60" y1="76" x2="365" y2="76" stroke="var(--accent-color)" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x="64" y="68" fill="var(--accent-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
            SWING HIGH LIQUIDITY
          </text>

          <rect x="330" y="124" width="235" height="32" fill="rgba(47, 129, 247, 0.14)" stroke="rgba(47, 129, 247, 0.45)" strokeWidth="1" />
          <text x="572" y="144" fill="var(--accent-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
            FVG ENTRY ZONE
          </text>

          <line x1="95" y1="124" x2="95" y2="160" stroke="var(--text-muted)" strokeWidth="2" />
          <rect x="88" y="132" width="14" height="20" rx="2" fill="var(--success-color)" />
          <line x1="135" y1="104" x2="135" y2="144" stroke="var(--text-muted)" strokeWidth="2" />
          <rect x="128" y="112" width="14" height="22" rx="2" fill="var(--success-color)" />
          <line x1="175" y1="76" x2="175" y2="128" stroke="var(--text-muted)" strokeWidth="2" />
          <rect x="168" y="90" width="14" height="24" rx="2" fill="var(--success-color)" />
          <line x1="215" y1="94" x2="215" y2="140" stroke="var(--text-muted)" strokeWidth="2" />
          <rect x="208" y="102" width="14" height="24" rx="2" fill="var(--error-color)" />
          <line x1="255" y1="82" x2="255" y2="124" stroke="var(--text-muted)" strokeWidth="2" />
          <rect x="248" y="92" width="14" height="20" rx="2" fill="var(--success-color)" />

          <line x1="305" y1="40" x2="305" y2="118" stroke="var(--warn-color)" strokeWidth="2.5" />
          <rect x="297" y="82" width="16" height="28" rx="2" fill="var(--error-color)" />
          <circle cx="305" cy="40" r="4" fill="var(--warn-color)" />
          <text x="242" y="32" fill="var(--warn-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
            1. LIQUIDITY SWEEP
          </text>

          <line x1="352" y1="108" x2="352" y2="188" stroke="var(--text-color)" strokeWidth="2.5" />
          <rect x="344" y="112" width="16" height="66" rx="2" fill="var(--error-color)" />
          <text x="372" y="110" fill="var(--text-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
            2. DISPLACEMENT
          </text>

          <line x1="405" y1="134" x2="405" y2="186" stroke="var(--text-muted)" strokeWidth="2" />
          <rect x="398" y="144" width="14" height="30" rx="2" fill="var(--success-color)" />

          <line x1="455" y1="130" x2="455" y2="206" stroke="var(--text-muted)" strokeWidth="2" />
          <rect x="448" y="140" width="14" height="42" rx="2" fill="var(--error-color)" />
          <circle cx="455" cy="140" r="4.5" fill="var(--success-color)" />
          <text x="415" y="226" fill="var(--success-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
            3. RETRACEMENT ENTRY (SL/TP DEFINED)
          </text>

          <line x1="455" y1="60" x2="548" y2="60" stroke="var(--error-color)" strokeWidth="1.5" />
          <text x="462" y="54" fill="var(--error-color)" fontSize="10" fontFamily="var(--mono-font)">
            STOP LOSS
          </text>
          <line x1="455" y1="206" x2="548" y2="206" stroke="var(--success-color)" strokeWidth="1.5" />
          <text x="462" y="200" fill="var(--success-color)" fontSize="10" fontFamily="var(--mono-font)">
            STRUCTURAL TARGET
          </text>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
          <div style={{ padding: '0.65rem 0.8rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
            <strong style={{ color: 'var(--text-color)' }}>1. Sweep:</strong> Price probes above 1H/5M swing liquidity and rejects cleanly.
          </div>
          <div style={{ padding: '0.65rem 0.8rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
            <strong style={{ color: 'var(--text-color)' }}>2. Displacement:</strong> High-body ATR impulse leaves a Fair Value Gap imbalance.
          </div>
          <div style={{ padding: '0.65rem 0.8rem', borderRadius: '8px', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
            <strong style={{ color: 'var(--text-color)' }}>3. Risk Gate:</strong> Evaluates macro event safety + score &gt;= 65 before Telegram delivery.
          </div>
        </div>
      </div>
    </div>
  );
}
