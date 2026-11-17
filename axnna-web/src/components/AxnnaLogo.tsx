import { useId } from 'react';

interface AxnnaLogoProps {
  size?: number;
  showWordmark?: boolean;
  wordmarkStyle?: React.CSSProperties;
}

/**
 * Liquidity & FVG architectural Axnna emblem + optional wordmark.
 * Uses per-instance SVG defs IDs to avoid collisions when mounted multiple times.
 */
export function AxnnaLogo({ size = 28, showWordmark = true, wordmarkStyle }: AxnnaLogoProps) {
  const uid = useId().replace(/:/g, '');
  const bgId = `axnna-sq-${uid}`;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, display: 'block' }}
      >
        <defs>
          <linearGradient id={bgId} x1="12" y1="8" x2="88" y2="94" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#14161a" />
            <stop offset="55%" stopColor="#08090c" />
            <stop offset="100%" stopColor="#000000" />
          </linearGradient>
        </defs>
        <rect
          x="2"
          y="2"
          width="96"
          height="96"
          rx="22"
          fill={`url(#${bgId})`}
          stroke="currentColor"
          strokeOpacity="0.22"
          strokeWidth="2.4"
        />
        <rect x="17" y="51" width="66" height="12" rx="2" fill="#64748b" fillOpacity="0.24" />
        <line x1="17" y1="51" x2="83" y2="51" stroke="#94a3b8" strokeOpacity="0.52" strokeWidth="1.5" />
        <line x1="17" y1="63" x2="83" y2="63" stroke="#94a3b8" strokeOpacity="0.4" strokeWidth="1.5" />
        <polygon points="50,16 78,81 67,81 50,41 33,81 22,81" fill="#f8fafc" />
        <rect x="35" y="54" width="30" height="6.5" rx="1.2" fill="#ffffff" />
        <rect x="16" y="78" width="11" height="3" rx="1" fill="#94a3b8" />
        <rect x="73" y="78" width="11" height="3" rx="1" fill="#94a3b8" />
        <polygon points="50,11 54.5,16 50,14 45.5,16" fill="#cbd5e1" />
      </svg>
      {showWordmark && <span style={wordmarkStyle}>Axnna</span>}
    </span>
  );
}
