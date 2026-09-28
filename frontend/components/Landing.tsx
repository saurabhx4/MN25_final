'use client';
import { ArrowDown, ArrowRight, Sparkles } from 'lucide-react';
import { Logo, BrandMark } from './Brand';

const HERO_VIDEO = 'https://videos.pexels.com/video-files/36525712/15488176_3840_2160_24fps.mp4';
const HERO_POSTER = 'https://images.pexels.com/photos/31721779/pexels-photo-31721779/free-photo-of-massive-open-pit-mine-with-haul-trucks.jpeg?auto=compress&cs=tinysrgb&w=2400';
const APPLICATION_IMAGE = 'https://images.pexels.com/photos/31721779/pexels-photo-31721779/free-photo-of-massive-open-pit-mine-with-haul-trucks.jpeg?auto=compress&cs=tinysrgb&w=1800';
const MARS_VIDEO = 'https://svs.gsfc.nasa.gov/vis/a030000/a030300/a030338/rotating_mars_1080p.mp4';

const capabilities = [
  { idx: '01', title: 'Prospectivity Intelligence', body: 'Weighted geological, spectral and terrain indicators combine into a single manganese prospectivity score per zone.' },
  { idx: '02', title: 'Production Forecasting', body: 'Forward-looking output modelling against target, with shortfall detection and contributing-factor breakdowns.' },
  { idx: '03', title: 'Operational Risk', body: 'Equipment, weather and blasting risk tracked continuously, with a live matrix and recommended responses.' },
];

export default function Landing({ onExplore, onSignIn, onSignUp }: { onExplore: () => void; onSignIn: () => void; onSignUp: () => void }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <button className="landing-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="MN25 home">
          <Logo size={34} />
          <BrandMark />
        </button>
        <nav className="landing-nav-actions" aria-label="Primary navigation">
          <button className="nav-text-link" onClick={() => scrollTo('introduction')}>About</button>
          <button className="btn small ghost" onClick={onSignUp}>Sign Up</button>
          <button className="btn small" onClick={onSignIn}>Login</button>
        </nav>
      </header>

      <main>
        <section className="landing-hero" aria-label="MN25 mining intelligence">
          <video className="hero-media" autoPlay muted loop playsInline poster={HERO_POSTER} preload="metadata">
            <source src={HERO_VIDEO} type="video/mp4" />
          </video>
          <div className="hero-media-fallback" style={{ backgroundImage: `url(${HERO_POSTER})` }} />
          <div className="hero-vignette" />
          <div className="hero-grid" />
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> MANGANESE · EARTH INTELLIGENCE</div>
            <h1><span className="hero-title-line">Read the mine.</span><br /><em>Move with foresight.</em></h1>
            <p>MN25 connects exploration signals, production intelligence and operational risk into one decision surface for modern mining.</p>
          <button className="hero-explore" onClick={onExplore} aria-label="Explore MN25 and continue to sign in">
            <span>Explore MN25</span><ArrowDown size={17} />
          </button>
          </div>
          <div className="hero-corner-data"><span>LIVE VISUAL FEED</span><b>OPEN-PIT OPERATIONS</b></div>
          <div className="hero-scroll-label">SCROLL TO DISCOVER</div>
        </section>

        <section className="story-section intro-section" id="introduction">
          <div className="story-copy reveal-copy">
            <div className="section-index">01 / INTRODUCTION</div>
            <h2>Intelligence built around the realities of the mine.</h2>
            <p>MN25 is an AI-powered mining intelligence layer designed to turn fragmented earth, production and field signals into a clearer operational picture.</p>
            <p>It brings prospectivity, production forecasting and risk context together so teams can move from isolated observations to coordinated decisions — without losing the human judgement that makes mine planning work.</p>
            <div className="story-metric-row">
              <span><b>01</b> GEOLOGY</span><span><b>02</b> PRODUCTION</span><span><b>03</b> RISK</span>
            </div>
          </div>
          <div className="story-visual mars-visual">
            <video autoPlay muted loop playsInline className="mars-video" aria-label="Rotating Mars visualization">
              <source src={MARS_VIDEO} type="video/mp4" />
            </video>
            <div className="visual-hud hud-top">PLANETARY REFERENCE <span>EARTH → MARS</span></div>
            <div className="visual-hud hud-bottom"><span>ROTATION / CONTINUOUS</span><b>ORBITAL VIEW</b></div>
            <div className="mars-ring ring-one" /><div className="mars-ring ring-two" />
          </div>
        </section>

        <section className="story-section applications-section" id="applications">
          <div className="story-visual application-visual">
            <div className="application-image" style={{ backgroundImage: `url(${APPLICATION_IMAGE})` }} />
            <div className="application-overlay" />
            <div className="application-caption"><span>FIELD SIGNAL / 03</span><b>ORE MOVEMENT · EQUIPMENT · TERRAIN</b></div>
            <div className="scan-line" />
          </div>
          <div className="story-copy applications-copy">
            <div className="section-index">02 / APPLICATIONS</div>
            <h2>From exploration to the shift room.</h2>
            <p>MN25 is designed for practical mining workflows where data arrives from different systems, sensors and teams but decisions still need to happen quickly.</p>
            <div className="application-list">
              <div><span>EXPLORATION</span><p>Prioritise zones using geological, spectral and terrain indicators.</p></div>
              <div><span>PRODUCTION</span><p>Compare expected output with plan, detect shortfalls and expose drivers.</p></div>
              <div><span>OPERATIONS</span><p>Surface equipment, weather and blasting risks with recommended responses.</p></div>
              <div><span>DECISION SUPPORT</span><p>Give planners, engineers and supervisors one shared operational picture.</p></div>
            </div>
          </div>
        </section>

        <section className="benefits-section" id="benefits">
          <div className="benefits-heading">
            <div className="section-index">03 / BENEFITS</div>
            <h2 className="benefits-statement">“Three intelligence layers. One operating picture.”</h2>
            <p>Designed to make complex mining signals easier to interpret, communicate and act on.</p>
          </div>
          <div className="capability-grid">
            {capabilities.map(c => (
              <article className="capability-card" key={c.idx}>
                <div className="idx">{c.idx}</div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                <span className="card-arrow"><ArrowRight size={16} /></span>
              </article>
            ))}
          </div>
        </section>

        <section className="quote-section">
          <Sparkles size={18} strokeWidth={1.5} />
          <blockquote>“Better intelligence does not replace the mine team. It gives the team a clearer moment to decide.”</blockquote>
          <span>MN25 · MINERAL INTELLIGENCE FOR A STRONGER TOMORROW</span>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="footer-brand"><Logo size={24} /><strong>MN25</strong></div>
        <div className="footer-links">
          <a href="mailto:contact@mn25.in">Contact Us</a>
          <a href="mailto:contact@mn25.in">Email</a>
          <a href="https://www.linkedin.com/" target="_blank" rel="noreferrer">LinkedIn</a>
          <a href="http://localhost:3000/#terms-and-conditions">Terms and Conditions</a>
          <a href="http://localhost:3000/#policies">Policies</a>
          <span>Updated 23 Sep 2026</span>
        </div>
      </footer>
      <div id="terms-and-conditions" className="legal-section"><h2>Terms and Conditions</h2><p>MN25 prototype information is provided for demonstration and product exploration.</p></div>
      <div id="policies" className="legal-section"><h2>Policies</h2><p>Use of this prototype is subject to applicable project and deployment policies.</p></div>
    </div>
  );
}
