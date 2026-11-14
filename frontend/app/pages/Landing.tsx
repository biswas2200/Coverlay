import { Link } from 'react-router';
import { Icon, type IconName } from '@/components/Icon';
import { usePageTitle } from '@/lib/hooks';
import { adminBase } from '@/lib/admin';
import { ROUTES } from '@/lib/routes';
import { useUser } from '@/lib/session';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'check', title: 'ATS check with fixes', text: 'A score out of 100, every check explained, and the points each fix is worth.' },
  { icon: 'target', title: 'Role matches', text: 'The roles your skills fit best, with the skills you have and the ones to add.' },
  { icon: 'briefcase', title: 'Job description match', text: 'Paste any job ad and see your coverage, the gaps and the closest role.' },
  { icon: 'clock', title: 'Version history', text: 'Every upload is kept, so you can compare versions and watch the score move.' },
];

const INCLUDED = [
  'ATS score with every check explained',
  'All 23 fields, analysed as often as you like',
  'Your top 5 role matches and the skills to add',
  'Suggestions written for you by AI',
  'Match your resume to any job description',
  'Every resume version kept',
];

/** The public landing page. A signed-in visitor gets a link straight to the dashboard instead of the sign-in buttons. */
export default function Landing() {
  usePageTitle('Resume analysis and role matching');
  const user = useUser();
  return (
    <>
      <header className="site-nav">
        <Link className="brand" to={ROUTES.home}>
          <img className="brand-mark" src="/logo.png" alt="" />
          Coverlay
        </Link>
        <nav className="site-links" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#included">What you get</a>
        </nav>
        <div className="site-actions">
          {user ? (
            <Link className="btn btn-primary" to={adminBase(user) ?? ROUTES.dashboard}>{adminBase(user) ? 'Open admin console' : 'Open dashboard'}</Link>
          ) : (
            <div className="site-actions">
              <Link className="btn btn-ghost" to={ROUTES.login}>Sign in</Link>
              <Link className="btn btn-primary" to={ROUTES.register}>Get started</Link>
            </div>
          )}
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Resume analysis · Role matching</p>
            <h1>See your resume the way <mark>hiring software</mark> reads it.</h1>
            <p className="lead">
              Upload a PDF or DOCX. Get an ATS score with the exact fixes, the roles you fit best, the skills to add, and how close you are to any job
              description you paste.
            </p>
            <div className="hero-cta">
              <Link className="btn btn-primary" to={ROUTES.register}>Analyse my resume <Icon name="arrow" /></Link>
              <Link className="btn btn-secondary" to={ROUTES.login}>I have an account</Link>
            </div>
            <ul className="hero-points">
              <li><Icon name="check" />Every field, from software to nursing, analysed in full</li>
              <li><Icon name="check" />PDF or DOCX, up to 5 MB</li>
            </ul>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <p className="section-label">ATS score</p>
                <span className="badge badge-green">Good</span>
              </div>
              <p className="mock-score"><b>78</b><span className="muted mono">/100</span></p>
              <div className="bar tone-ok"><span style={{ width: '78%' }} /></div>
              <div style={{ marginTop: 14 }}>
                <p className="mock-row"><span>Email address</span><span className="badge badge-green">Pass</span></p>
                <p className="mock-row"><span>Experience section</span><span className="badge badge-green">Pass</span></p>
                <p className="mock-row"><span>Skills section</span><span className="badge badge-red">Fix</span></p>
              </div>
            </div>
            <div className="card mock-offset">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <p className="section-label">Best role match</p>
                  <p className="stat-title" style={{ marginTop: 4 }}>Data Analyst</p>
                </div>
                <span className="match-pct">86%</span>
              </div>
              <p className="section-label" style={{ margin: '14px 0 8px' }}>Skills to add</p>
              <ul className="chips chips-amber"><li>Power BI</li><li>dbt</li></ul>
            </div>
          </div>
        </section>

        <section className="features" id="features">
          <h2 className="section-title">Everything about your resume, in one dashboard</h2>
          <p className="section-sub">Every result says what it found and what to do about it.</p>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <article className="card feature" key={feature.title}>
                <span className="feature-icon"><Icon name={feature.icon} /></span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pricing" id="included">
          <h2 className="section-title">Everything, for every account</h2>
          <p className="section-sub">One plan, no limits to keep track of: every resume is read by AI, whatever your field.</p>
          <div className="price-grid">
            <article className="card price-card featured">
              <h3>What you get</h3>
              <ul className="tick-list">
                {INCLUDED.map((line) => (
                  <li key={line}><Icon name="check" /><span>{line}</span></li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      </main>

      <footer className="site-footer">Coverlay · your resume stays in your account.</footer>
    </>
  );
}
