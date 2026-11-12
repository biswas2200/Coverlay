import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { login } from '@/api/auth';
import { AuthLayout } from '@/components/AuthLayout';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/errors';
import { usePageTitle } from '@/lib/hooks';
import { adminBase } from '@/lib/admin';
import { ROUTES } from '@/lib/routes';
import { validateEmail, validateLoginPassword } from '@legacy/core/validation.js';

// The sample account of `npm run dev` (the sample API accepts any credentials; these are the ones shown on screen).
const DEMO = { email: 'preview@coverlay.app', password: 'Coverlay#2026' };

// Sign in to an existing account, backed by `POST /auth/login`.
export default function Login() {
  usePageTitle('Sign in');
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email: string | null; password: string | null }>({ email: null, password: null });
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = { email: validateEmail(email.trim()), password: validateLoginPassword(password) };
    setErrors(next);
    if (next.email || next.password) {
      return;
    }
    setBanner('');
    setBusy(true);
    try {
      const { user } = await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      // An administrator lands in the admin console; everyone else in the app.
      navigate(from ?? adminBase(user) ?? ROUTES.dashboard, { replace: true });
    } catch (error) {
      setBusy(false);
      setBanner(errorMessage(error, 'Could not sign in. Please try again.'));
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      sub="Sign in to see your resume analysis."
      switchLine={<>New here? <Link to={ROUTES.register}>Create an account</Link></>}
      form={
        <form noValidate onSubmit={submit}>
          {banner ? <div className="alert alert-error" role="alert">{banner}</div> : null}
          <Field id="login-email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={errors.email} />
          <Field id="login-password" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} error={errors.password} />
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {import.meta.env.DEV ? (
            <div className="demo-box">
              <p><b>Demo account</b> (sample data, development only)<br />Email <code>{DEMO.email}</code><br />Password <code>{DEMO.password}</code></p>
              <button className="btn btn-secondary" type="button" onClick={() => { setEmail(DEMO.email); setPassword(DEMO.password); setErrors({ email: null, password: null }); }}>Fill in the demo account</button>
            </div>
          ) : null}
        </form>
      }
    />
  );
}
