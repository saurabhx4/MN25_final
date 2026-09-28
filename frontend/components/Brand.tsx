export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="mark" aria-hidden="true">
      <path d="M4 24 L11 10 L16 19 L21 8 L28 24" fill="none" stroke="#b6875a" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M4 24 L11 10 L16 19 L21 8 L28 24" fill="none" stroke="#cba36a" strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" opacity=".5" transform="translate(0,1.4)" />
      <circle cx="16" cy="19" r="1.4" fill="#5fa38d" />
    </svg>
  );
}

export function BrandMark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="landing-brand-text">
      <b>Mn 25</b>
      <small>{subtitle || 'MANGANESE MINING INTELLIGENCE'}</small>
    </div>
  );
}

export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.32-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.68 28.18C11.24 26.86 11 25.45 11 24s.24-2.86.68-4.18v-5.7H4.34A21.93 21.93 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.34-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.34 5.7c1.74-5.2 6.59-9.07 12.32-9.07z" />
    </svg>
  );
}

/** Fixed full-viewport atmosphere: charcoal gradient wash + faint contour lines + layered peak silhouettes. Subtle by design — never competes with content. */
export function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="contours" />
      <div className="peaks">
        <svg viewBox="0 0 1440 400" preserveAspectRatio="none">
          <path d="M0,400 L0,230 L140,150 L260,210 L400,110 L560,190 L700,90 L860,200 L1000,130 L1160,220 L1300,150 L1440,240 L1440,400 Z" fill="#0d0f10" opacity=".9" />
          <path d="M0,400 L0,290 L180,230 L340,270 L520,190 L680,260 L860,170 L1040,270 L1220,210 L1440,290 L1440,400 Z" fill="#111314" opacity=".85" />
          <path d="M0,400 L0,340 L220,310 L460,330 L700,290 L960,330 L1200,300 L1440,340 L1440,400 Z" fill="#161819" />
        </svg>
      </div>
    </div>
  );
}
