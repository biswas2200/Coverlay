import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { refreshCurrentUser } from '@/api/auth';
import { useBodyClass } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { clearSession, useUser } from '@/lib/session';
import { roleLabel } from '@legacy/pages/dashboard-rules.js';
import { initials } from '@legacy/pages/insights.js';
import { Avatar } from '@/components/Avatar';
import { useAvatar } from '@/lib/avatar';
import { BugReportDialog } from './BugReportDialog';
import { Icon, type IconName } from './Icon';
import { ShellContext } from './shell-context';

interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  path: string;
  hash?: string;
  /** Marks a screen that runs on sample data. */
  preview?: boolean;
}

// Grouped so the sidebar stays scannable as features are added. Pages marked `preview` are clickable prototypes
// with sample data (no backend yet); they say so on the page.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'General',
    items: [
      { key: 'overview', label: 'Overview', icon: 'home', path: ROUTES.dashboard, hash: '#overview' },
      { key: 'resume', label: 'Resume analyzer', icon: 'file', path: ROUTES.upload },
      { key: 'builder', label: 'Builder', icon: 'sparkle', path: ROUTES.builder, preview: true },
      { key: 'letters', label: 'Letters & emails', icon: 'mail', path: ROUTES.letters, preview: true },
      { key: 'matches', label: 'Role matches', icon: 'target', path: ROUTES.dashboard, hash: '#matches' },
      { key: 'jd', label: 'JD match', icon: 'briefcase', path: ROUTES.dashboard, hash: '#jd' },
    ],
  },
  {
    label: 'Jobs',
    items: [
      { key: 'jobs', label: 'Jobs for you', icon: 'search', path: ROUTES.jobs },
      { key: 'saved', label: 'Saved jobs', icon: 'bookmark', path: ROUTES.saved },
      { key: 'applications', label: 'Applications', icon: 'kanban', path: ROUTES.applications, preview: true },
      { key: 'watchlist', label: 'Watchlist', icon: 'eye', path: ROUTES.watchlist },
      { key: 'community', label: 'Community', icon: 'users', path: ROUTES.community, preview: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { key: 'activity', label: 'My activity', icon: 'chart', path: ROUTES.activity, preview: true },
      { key: 'wallet', label: 'Wallet', icon: 'wallet', path: ROUTES.wallet, preview: true },
      { key: 'settings', label: 'Settings & privacy', icon: 'sliders', path: ROUTES.settings, preview: true },
    ],
  },
];

// Lay AI is on every page but the page does not wait for it: its code is its own chunk, fetched once the shell is drawn.
const LayChat = lazy(() => import('./LayChat').then((module) => ({ default: module.LayChat })));

/** Keeps the checks in one place: the route is the signed-in app only for a person with a session. */
export function RequireAuth() {
  const user = useUser();
  const location = useLocation();
  return user ? <AppShell /> : <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />;
}

function isActive(item: NavItem, pathname: string, hash: string): boolean {
  if (pathname !== item.path) {
    return false;
  }
  return item.hash ? (hash || '#overview') === item.hash : true;
}

/**
 * The shell shared by the signed-in pages: the sidebar with the account, the main navigation (grouped, the only part
 * that scrolls), the pinned footer (Report a bug, Sign out), the drawer on a phone, and Lay AI.
 */
function AppShell() {
  const user = useUser();
  const picture = useAvatar(user?.id);
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);

  useBodyClass('nav-open', navOpen);

  // The stored role goes stale after an admin changes it; refresh it quietly, once.
  useEffect(() => {
    refreshCurrentUser().catch(() => undefined);
  }, []);

  // A new page closes the drawer.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!navOpen) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavOpen(false);
        document.getElementById('menu-button')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const openNav = useCallback(() => setNavOpen(true), []);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const openBugReport = useCallback(() => {
    setNavOpen(false);
    setBugOpen(true);
  }, []);
  const context = useMemo(() => ({ navOpen, openNav, closeNav, openBugReport }), [navOpen, openNav, closeNav, openBugReport]);

  const label = roleLabel(user?.role);

  function signOut() {
    clearSession();
    navigate(ROUTES.login);
  }

  return (
    <ShellContext.Provider value={context}>
      <div className="app">
        <aside className="sidebar" id="sidebar" aria-label="Sidebar">
          <div className="sb-top">
            <Link className="brand" to={ROUTES.home}>
              <img className="brand-mark" src="/logo.png" alt="" />
              Coverlay
            </Link>
            <button className="icon-btn sb-close" type="button" aria-label="Close navigation" onClick={closeNav}>
              <Icon name="close" />
            </button>
          </div>
          <div className="sb-user">
            <Avatar choice={picture} initials={initials(user?.email)} />
            <div>
              <p className="sb-email" title={user?.email ?? ''}>{user?.email ?? ''}</p>
              {label ? <span className="badge badge-blue">{label}</span> : null}
            </div>
          </div>
          {/* Only this middle part scrolls; the account stays on top and Report a bug / Sign out stay at the bottom. */}
          <div className="sb-scroll">
            <nav className="sb-nav" aria-label="Main" onClick={closeNav}>
              {NAV_GROUPS.map((group) => (
                <NavGroup key={group.label} label={group.label} items={group.items} pathname={location.pathname} hash={location.hash} />
              ))}
            </nav>
          </div>
          <div className="sb-foot">
            <button className="sb-link" type="button" onClick={openBugReport}>
              <Icon name="alert" />
              Report a bug
            </button>
            <button className="sb-link sb-signout" type="button" onClick={signOut}>
              <Icon name="logout" />
              Sign out
            </button>
          </div>
        </aside>
        <div className="scrim" hidden={!navOpen} onClick={closeNav} />

        <div className="main">
          <Suspense fallback={<p className="content muted">Loading…</p>}>
            <Outlet />
          </Suspense>
        </div>
      </div>
      {/* Lay AI is on every signed-in page. The Builder has its own panel, so it does not get a second one. */}
      {location.pathname === ROUTES.builder ? null : (
        <Suspense fallback={null}>
          <LayChat />
        </Suspense>
      )}
      <BugReportDialog open={bugOpen} onClose={() => setBugOpen(false)} />
    </ShellContext.Provider>
  );
}

function NavGroup({ label, items, pathname, hash }: { label: string; items: NavItem[]; pathname: string; hash: string }) {
  return (
    <>
      <p className="sb-label">{label}</p>
      {items.map((item) => (
        <Link key={item.key} className="sb-link" to={`${item.path}${item.hash ?? ''}`} aria-current={isActive(item, pathname, hash) ? 'page' : undefined}>
          <Icon name={item.icon} />
          {item.label}
          {item.preview ? <span className="sb-tag" title="Clickable preview with sample data">Preview</span> : null}
        </Link>
      ))}
    </>
  );
}
