import { useId } from 'react';

interface AxnnaLogoProps {
  size?: number;
  showWordmark?: boolean;
  wordmarkStyle?: React.CSSProperties;
}

/**
 * Sweep-to-Signal Pulse emblem: liquidity sweep below threshold bar,
 * displacement impulse breakout, and emerald signal-lock trigger node.
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
          <linearGradient id={bgId} x1="10" y1="6" x2="90" y2="94" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#121824" />
            <stop offset="100%" stopColor="#080b10" />
          </linearGradient>
        </defs>
        <rect
          x="2"
          y="2"
          width="96"
          height="96"
          rx="22"
          fill={`url(#${bgId})`}
          stroke="#263245"
          strokeWidth="2.4"
        />
        {/* Liquidity / Threshold Zone */}
        <rect x="17" y="53" width="66" height="10" rx="5" fill="#2f81f7" fillOpacity="0.28" />
        <rect x="17" y="56.5" width="66" height="3" rx="1.5" fill="#2f81f7" />
        {/* Sweep -> Displacement Impulse Path */}
        <path
          d="M21 44 L35 72 L73 27"
          stroke="#f4f7fb"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Emerald Signal Lock Node */}
        <circle cx="73" cy="27" r="11" fill="#2dd47e" fillOpacity="0.24" />
        <circle cx="73" cy="27" r="6.2" fill="#2dd47e" />
      </svg>
      {showWordmark && <span style={wordmarkStyle}>Axnna</span>}
    </span>
  );
}
