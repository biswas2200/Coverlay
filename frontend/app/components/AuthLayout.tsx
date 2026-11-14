import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ROUTES } from '@/lib/routes';
import { clearSession, useUser } from '@/lib/session';

/** The sign-in and create-account frame: the brand, one card, and a line to the other page. */
export function AuthLayout({ title, sub, form, switchLine }: { title: string; sub: string; form: ReactNode; switchLine: ReactNode }) {
  const user = useUser();
  return (
    <main className="auth-wrap">
      <Link className="brand" to={ROUTES.home}>
        <img className="brand-mark" src="/logo.png" alt="" />
        Coverlay
      </Link>
      <div className="card auth-card">
        <h1>{title}</h1>
        <p className="sub">{sub}</p>
        {user ? (
          // Someone already signed in who opens this page is offered the dashboard or another account, not the form.
          <div className="notice">
            <p>You&apos;re already signed in as <b>{user.email}</b>.</p>
            <div className="row">
              <Link className="btn btn-primary" to={ROUTES.dashboard}>Go to dashboard</Link>
              <button className="btn btn-ghost" type="button" onClick={clearSession}>Use another account</button>
            </div>
          </div>
        ) : (
          form
        )}
      </div>
      <p className="auth-switch">{switchLine}</p>
    </main>
  );
}
