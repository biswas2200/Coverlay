import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { saveSession, type User } from '@/lib/session';
import '@/styles/preview-hub.css';

// The clickable preview of the whole app, with no backend: `npm run dev` answers the API with sample data
// (preview/mock-api.mjs) and this page starts a signed-in session and links every screen. A design-review tool:
// nothing is saved anywhere but this browser.

// The sample administrator. The real admin path is a secret the backend makes up; this one is only the sample
// API's (preview/mock-api.mjs has the same value).
const PREVIEW_ADMIN_PATH = '/preview-console-7f3k9q2m8x4w';
const PREVIEW_USER: User = { id: '00000000-0000-4000-8000-000000000001', email: 'preview@coverlay.app', role: 'ADMIN', createdAt: '2026-11-01T09:00:00Z', adminPath: PREVIEW_ADMIN_PATH };

interface Card {
  to: string;
  title: string;
  badge?: { text: string; tone: 'violet' | 'blue' };
  text: string;
}

const NEW_SCREENS: Card[] = [
  { to: ROUTES.letters, title: 'Letters & emails', badge: { text: 'New', tone: 'violet' }, text: 'A page-long cover letter (PDF or Word) and a short cold email you save or send from Gmail with your resume and letter attached. Both are edited right in the draft.' },
  { to: ROUTES.applications, title: 'Applications', badge: { text: 'New', tone: 'violet' }, text: 'Preparing → Applied → Interview → Offer, reminders, "Did you hear back?", and a small + Notes on every card.' },
  { to: ROUTES.community, title: 'Community', badge: { text: 'New', tone: 'violet' }, text: 'Every post just "Anonymous", the identity check before posting, up and down votes, Reddit-style comment branches, points to wallet.' },
  { to: ROUTES.activity, title: 'My activity', badge: { text: 'New', tone: 'violet' }, text: 'Your own numbers: applications sent, postings opened, posts viewed, your votes and your anonymous comments.' },
  { to: ROUTES.wallet, title: 'Wallet', badge: { text: 'New', tone: 'violet' }, text: 'Pay as you go: ₹60 to ₹2,000, the price of every action, what a full journey costs.' },
  { to: ROUTES.settings, title: 'Settings & privacy', badge: { text: 'New', tone: 'violet' }, text: 'Consents (EU/UK opt-in), phone change, export, and the delete-account job step by step.' },
  { to: PREVIEW_ADMIN_PATH, title: 'Admin console: analytics', badge: { text: 'Mock-up', tone: 'violet' }, text: 'The admin console is a separate window with its own sidebar, only for administrators. Its analytics are a mock-up with sample numbers. Not part of the product: what the internal dashboard shows is decided later, from real usage.' },
  { to: '/signup-preview', title: 'Sign-up', badge: { text: 'New', tone: 'violet' }, text: 'Email, a verified phone, 18+, privacy choices, and the "being deleted" case.' },
];

const CHANGED: Card[] = [
  { to: ROUTES.builder, title: 'Builder', badge: { text: 'Changed', tone: 'blue' }, text: 'Toolbar (fonts, bold, links, bullets, writing style), the Lay AI cursor that watches, suggest mode, the privacy chip, the Classic (LaTeX) template.' },
  { to: ROUTES.jobs, title: 'Lay AI on every page', badge: { text: 'Changed', tone: 'blue' }, text: 'Paste a job description anywhere: Lay AI proposes the resume change, opens the Builder to do it once you agree, then offers the match and a cold email to open in Letters.' },
];

const SAME: Card[] = [
  { to: ROUTES.dashboard, title: 'Overview', text: 'Shows its "upload your first resume" state here.' },
  { to: ROUTES.upload, title: 'Resume analyzer', text: 'Uploading needs the real engine, so it explains that.' },
  { to: ROUTES.jobs, title: 'Jobs for you', text: 'Four sample jobs, newest first.' },
  { to: ROUTES.saved, title: 'Saved jobs', text: 'Empty in the preview.' },
  { to: ROUTES.watchlist, title: 'Watchlist', text: 'Empty in the preview.' },
  { to: ROUTES.home, title: 'Home page', text: 'The public landing page.' },
];

function Group({ id, title, cards }: { id: string; title: string; cards: Card[] }) {
  return (
    <section className="hub-group" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className="hub-grid">
        {cards.map((card) => (
          <Link key={card.title} className="card hub-card" to={card.to}>
            <h3>
              {card.title}
              {card.badge ? <span className={`badge badge-${card.badge.tone}`}>{card.badge.text}</span> : null}
            </h3>
            <p>{card.text}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function startSession() {
  saveSession({ token: 'preview-token', tokenType: 'Bearer', expiresAt: '2099-01-01T00:00:00Z', user: PREVIEW_USER });
}

export default function PreviewHub() {
  usePageTitle('Preview');
  const [started, setStarted] = useState(false);

  // Links work right away: starting the session on first load saves a click.
  useEffect(() => {
    startSession();
    setStarted(true);
  }, []);

  function reset() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('coverlay.')) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // Nothing stored.
    }
    startSession();
    setStarted(true);
  }

  return (
    <main className="hub">
      <header className="hub-head">
        <p className="eyebrow">Design review · sample data</p>
        <h1>Coverlay, every screen</h1>
        <p className="lead">
          Click through the whole app before anything is built. Nothing here reaches a backend or an AI, and everything you change stays in this browser. Tell me what you like and what to change.
        </p>
        <div className="hub-actions">
          <button className="btn btn-primary" type="button" onClick={() => { startSession(); setStarted(true); }}>Start the preview</button>
          <button className="btn btn-ghost" type="button" onClick={reset}>Reset all preview data</button>
        </div>
        {started ? (
          <p className="alert alert-success" role="status">
            You&apos;re signed in as preview@coverlay.app (an admin, so the separate admin console opens too; it has no fixed address, only an administrator is given it). Pick a screen.
          </p>
        ) : null}
      </header>
      <Group id="new-title" title="New screens" cards={NEW_SCREENS} />
      <Group id="changed-title" title="Changed" cards={CHANGED} />
      <Group id="same-title" title="Unchanged (sample answers stand in for the backend)" cards={SAME} />
    </main>
  );
}
