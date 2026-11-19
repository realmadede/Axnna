import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FAQS = [
  {
    q: 'What is Axnna?',
    a: 'Axnna is an automated market-analysis engine. It monitors financial markets 24/5, evaluates structural alignment using a purely deterministic pipeline, and delivers formatted setup signals natively through Telegram.',
  },
  {
    q: 'How does Axnna work?',
    a: 'Axnna constantly processes market candles, tracks liquidity pools, computes structural displacement, and normalizes fundamental macroeconomic data. When all geometric and contextual conditions align according to our internal strategy definitions, a notification is generated.',
  },
  {
    q: 'Where do I receive signals?',
    a: 'All eligible signals are delivered strictly through the official Axnna Telegram bot. We do not use email or SMS.',
  },
  {
    q: 'Does Axnna execute trades automatically?',
    a: 'No. Axnna is purely an analytical notification layer. It does not execute trades, manage margin, or connect to your broker. You are entirely responsible for your own execution and risk management.',
  },
  {
    q: 'What does the signal score mean?',
    a: 'The Axnna Score (e.g., 78%) is an internal confidence metric representing how closely a setup aligns with our ideal structural and fundamental geometry.',
  },
  {
    q: 'Why is 65% the minimum score?',
    a: 'Axnna filters out noise. Any setup that scores below our strict 65% threshold is silently discarded to protect you from low-quality structures. You only hear from us when the numbers align.',
  },
  {
    q: 'Does a 65% score mean a trade has a 65% chance of winning?',
    a: 'NO. The Axnna score is an internal geometric alignment measurement, NOT a probability of profit. A 90% score simply means the structure is highly aligned to our model; it can still result in a financial loss.',
  },
  {
    q: 'Which markets does Axnna monitor?',
    a: 'Currently, Axnna focuses on major foreign exchange instruments (EURUSD, GBPUSD, USDJPY) and Gold (XAUUSD).',
  },
  {
    q: 'Can Axnna guarantee profits?',
    a: 'Absolutely not. Trading involves substantial risk of loss. Axnna is a structural analysis tool, not a crystal ball.',
  },
  {
    q: 'What happens during major market events?',
    a: 'Axnna incorporates a Fundamental Engine that actively monitors macroeconomic calendars (e.g., NFP, CPI, Central Bank decisions). If a critical event is imminent, Axnna categorizes it as EXTREME EVENT RISK and may suppress technical signals to prevent exposure to untradable volatility.',
  },
  {
    q: 'How do I connect Telegram?',
    a: 'Click the "Connect to Telegram" button. You will be provided with a unique connection payload. Open the official bot or copy the /start command to link your account instantly.',
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', paddingBottom: '3rem' }}>
      <h1 style={{ fontSize: 'clamp(1.75rem, 3.8vw, 2.35rem)', fontWeight: 700, letterSpacing: '-0.025em', marginBottom: '0.5rem' }}>
        Frequently Asked Questions
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.96rem', marginBottom: '1.5rem' }}>
        Methodology boundaries, scoring thresholds, and Telegram setup.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {FAQS.map((faq, i) => {
          const isOpen = openIndex === i;
          return (
            <div key={faq.q} className="faq-item">
              <button
                type="button"
                className="faq-trigger"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex(isOpen ? null : i)}
              >
                <span>{faq.q}</span>
                <ChevronDown
                  size={18}
                  color="var(--text-muted)"
                  style={{
                    flexShrink: 0,
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.18s ease',
                  }}
                />
              </button>
              {isOpen && <div className="faq-body axnna-fade-in">{faq.a}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
