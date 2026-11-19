export function SetupDiagram() {
  return (
    <div className="glass-card" style={{ padding: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div>
          <span className="admin-kpi-label">Setup Geometry</span>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginTop: '0.2rem' }}>
            Sweep, Displacement, FVG &amp; Risk Gate
          </h3>
        </div>
        <span className="admin-badge admin-badge--ok mono">SCORE &gt;= 65 REQUIRED</span>
      </div>

      <svg
        viewBox="0 0 720 260"
        role="img"
        aria-label="Diagram showing a liquidity sweep above a swing high, displacement candle creating a Fair Value Gap retracement entry, stop loss, target, and macro veto check"
        style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '10px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
      >
        {/* Subtle horizontal reference grid */}
        <line x1="24" y1="54" x2="696" y2="54" stroke="var(--border-color)" strokeDasharray="4 4" />
        <line x1="24" y1="126" x2="696" y2="126" stroke="var(--border-color)" strokeDasharray="4 4" />
        <line x1="24" y1="204" x2="696" y2="204" stroke="var(--border-color)" strokeDasharray="4 4" />

        {/* Liquidity Swing High line */}
        <line x1="60" y1="78" x2="365" y2="78" stroke="var(--accent-color)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="64" y="70" fill="var(--accent-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
          SWING HIGH LIQUIDITY
        </text>

        {/* FVG shaded zone */}
        <rect x="330" y="128" width="235" height="32" fill="rgba(47, 129, 247, 0.14)" stroke="rgba(47, 129, 247, 0.45)" strokeWidth="1" />
        <text x="572" y="148" fill="var(--accent-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
          FVG ENTRY ZONE
        </text>

        {/* Candles leading up */}
        {/* 1 */}
        <line x1="95" y1="128" x2="95" y2="165" stroke="var(--text-muted)" strokeWidth="2" />
        <rect x="88" y="136" width="14" height="20" rx="2" fill="var(--success-color)" />
        {/* 2 */}
        <line x1="135" y1="108" x2="135" y2="148" stroke="var(--text-muted)" strokeWidth="2" />
        <rect x="128" y="116" width="14" height="22" rx="2" fill="var(--success-color)" />
        {/* 3 Swing High bar */}
        <line x1="175" y1="78" x2="175" y2="132" stroke="var(--text-muted)" strokeWidth="2" />
        <rect x="168" y="92" width="14" height="26" rx="2" fill="var(--success-color)" />
        {/* 4 Pullback */}
        <line x1="215" y1="98" x2="215" y2="144" stroke="var(--text-muted)" strokeWidth="2" />
        <rect x="208" y="106" width="14" height="24" rx="2" fill="var(--error-color)" />
        {/* 5 Approach */}
        <line x1="255" y1="84" x2="255" y2="128" stroke="var(--text-muted)" strokeWidth="2" />
        <rect x="248" y="94" width="14" height="22" rx="2" fill="var(--success-color)" />

        {/* 6 LIQUIDITY SWEEP candle */}
        <line x1="305" y1="42" x2="305" y2="122" stroke="var(--warn-color)" strokeWidth="2.5" />
        <rect x="297" y="84" width="16" height="30" rx="2" fill="var(--error-color)" />
        <circle cx="305" cy="42" r="4" fill="var(--warn-color)" />
        <text x="242" y="34" fill="var(--warn-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
          1. LIQUIDITY SWEEP
        </text>

        {/* 7 DISPLACEMENT candle (ATR expansion) */}
        <line x1="352" y1="112" x2="352" y2="194" stroke="var(--text-color)" strokeWidth="2.5" />
        <rect x="344" y="116" width="16" height="68" rx="2" fill="var(--error-color)" />
        <text x="372" y="114" fill="var(--text-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
          2. DISPLACEMENT
        </text>

        {/* 8 FVG Retrace candle */}
        <line x1="405" y1="138" x2="405" y2="192" stroke="var(--text-muted)" strokeWidth="2" />
        <rect x="398" y="148" width="14" height="32" rx="2" fill="var(--success-color)" />

        {/* 9 Rejection / Entry trigger */}
        <line x1="455" y1="134" x2="455" y2="212" stroke="var(--text-muted)" strokeWidth="2" />
        <rect x="448" y="144" width="14" height="44" rx="2" fill="var(--error-color)" />
        <circle cx="455" cy="144" r="4.5" fill="var(--success-color)" />
        <text x="415" y="232" fill="var(--success-color)" fontSize="11" fontFamily="var(--mono-font)" fontWeight="600">
          3. RETRACEMENT ENTRY (SL/TP DEFINED)
        </text>

        {/* Stop Loss & Target Lines */}
        <line x1="455" y1="62" x2="548" y2="62" stroke="var(--error-color)" strokeWidth="1.5" />
        <text x="462" y="56" fill="var(--error-color)" fontSize="10" fontFamily="var(--mono-font)">
          STOP LOSS
        </text>
        <line x1="455" y1="212" x2="548" y2="212" stroke="var(--success-color)" strokeWidth="1.5" />
        <text x="462" y="206" fill="var(--success-color)" fontSize="10" fontFamily="var(--mono-font)">
          STRUCTURAL TARGET
        </text>
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginTop: '1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        <div><strong style={{ color: 'var(--text-color)' }}>1. Sweep:</strong> Price probes above 1H/5M swing liquidity and snaps back.</div>
        <div><strong style={{ color: 'var(--text-color)' }}>2. Displacement:</strong> High-body ATR impulse leaves an imbalance (FVG).</div>
        <div><strong style={{ color: 'var(--text-color)' }}>3. Gate &amp; Alert:</strong> Risk Gate verifies macro safety + score &gt;= 65 before Telegram push.</div>
      </div>
    </div>
  );
}
