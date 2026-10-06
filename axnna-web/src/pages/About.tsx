
import { Shield, Activity, Zap } from 'lucide-react';

export default function About() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '4rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>About Axnna</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', marginBottom: '4rem', lineHeight: 1.6 }}>
        We built Axnna because monitoring charts manually is emotional, exhausting, and prone to error.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <Activity color="var(--accent-color)" size={28} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>The Problem</h2>
          </div>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem' }}>
            Most retail traders lose money because they lack consistency. They chase price action, ignore macroeconomic context, and fail to filter out low-probability environments. Traditional "signal groups" offer no transparency into their methodology, operating as black boxes that promote gambling over structured execution.
          </p>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <Shield color="var(--accent-color)" size={28} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Our Philosophy</h2>
          </div>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem' }}>
            Axnna is built on a simple premise: <strong>Silence is a valid signal.</strong>
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8 }}>
            We do not believe in generating constant alerts to justify a subscription. Our mathematical state engine requires strict alignment between Higher Timeframe bias, structural sweeps, displacement, and macroeconomic event safety. If a candidate setup scores a 58%, it is silently discarded. Only structures achieving our minimum 65% internal confidence threshold ever reach your Telegram inbox.
          </p>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <Zap color="var(--accent-color)" size={28} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Telegram First</h2>
          </div>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8 }}>
            We bypassed clunky web dashboards for alert delivery. By integrating natively with Telegram, Axnna ensures that when the market aligns, the data arrives instantly in a highly structured, readable format right on your mobile device.
          </p>
        </section>
      </div>
    </div>
  );
}
