import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { refreshCurrentUser } from '@/api/auth';
import { adminBase, adminRoutes } from '@/lib/admin';
import { useBodyClass } from '@/lib/hooks';
import { PREVIEW } from '@/lib/preview';
import { ROUTES } from '@/lib/routes';
import { clearSession, useUser } from '@/lib/session';
import { Icon, type IconName } from './Icon';
import { ShellContext } from './shell-context';

// The admin console: a window of its own for administrators, with its own sidebar, its own pages and its own look
// (a black sidebar), so it never mixes with the end-user app. A person who is not an administrator never sees a link
// to it. It has no fixed address either: it lives under a secret path only an administrator is told (lib/admin.ts),
// so typing /admin finds nothing; the backend checks ADMIN on every call regardless and answers 404 to anyone else.

interface AdminLink {
  to: string;
  label: string;
  icon: IconName;
  tag?: string;
}

const links = (base: string): AdminLink[] => [
  ...(PREVIEW ? [{ to: adminRoutes(base).home, label: 'Admin analytics', icon: 'chart' as IconName, tag: 'Mock-up' }] : []),
  { to: adminRoutes(base).bugs, label: 'Bug reports', icon: 'check' as IconName },
];

/** Keeps the checks in one place: only a signed-in administrator gets the console. */
export function RequireAdmin() {
  const user = useUser();
  const location = useLocation();
  if (!user) {
    return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />;
  }
  const base = adminBase(user);
  return base ? <AdminShell base={base} /> : <Navigate to={ROUTES.dashboard} replace />;
}

function AdminShell({ base }: { base: string }) {
  const user = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  useBodyClass('nav-open', navOpen);

  // The stored role goes stale after a change; refresh it quietly, once.
  useEffect(() => {
    refreshCurrentUser().catch(() => undefined);
  }, []);
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const openNav = useCallback(() => setNavOpen(true), []);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const navLinks = useMemo(() => links(base), [base]);
  const context = useMemo(() => ({ navOpen, openNav, closeNav, openBugReport: () => undefined }), [navOpen, openNav, closeNav]);

  return (
    <ShellContext.Provider value={context}>
      <div className="app app-admin">
        <aside className="sidebar" id="sidebar" aria-label="Admin sidebar">
          <div className="sb-top">
            <Link className="brand" to={base}>
              <img className="brand-mark" src="/logo.png" alt="" />
              Coverlay
            </Link>
            <span className="admin-tag">Admin console</span>
            <button className="icon-btn sb-close" type="button" aria-label="Close navigation" onClick={closeNav}>
              <Icon name="close" />
            </button>
          </div>
          <div className="sb-user">
            <div>
              <p className="sb-email" title={user?.email ?? ''}>{user?.email ?? ''}</p>
              <span className="badge badge-blue">Admin</span>
            </div>
          </div>
          <div className="sb-scroll">
            <nav className="sb-nav" aria-label="Admin" onClick={closeNav}>
              <p className="sb-label">Admin</p>
              {navLinks.map((link) => (
                <Link key={link.to} className="sb-link" to={link.to} aria-current={location.pathname === link.to ? 'page' : undefined}>
                  <Icon name={link.icon} />
                  {link.label}
                  {link.tag ? <span className="sb-tag">{link.tag}</span> : null}
                </Link>
              ))}
            </nav>
          </div>
          <div className="sb-foot">
            <Link className="sb-link" to={ROUTES.dashboard}>
              <Icon name="home" />
              Open the user view
            </Link>
            <button className="sb-link sb-signout" type="button" onClick={() => { clearSession(); navigate(ROUTES.login); }}>
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
    </ShellContext.Provider>
  );
}
