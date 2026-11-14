import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { register } from '@/api/auth';
import { AuthLayout } from '@/components/AuthLayout';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/errors';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { validateConfirmPassword, validateEmail, validateNewPassword } from '@legacy/core/validation.js';

type Errors = { email: string | null; password: string | null; confirm: string | null };

// Create an account, backed by `POST /auth/register`. A successful registration returns a token, so the new person
// goes straight on to upload a resume.
export default function Register() {
  usePageTitle('Create account');
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({ email: null, password: null, confirm: null });
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {
      email: validateEmail(email.trim()),
      password: validateNewPassword(password),
      confirm: validateConfirmPassword(password, confirm),
    };
    setErrors(next);
    if (next.email || next.password || next.confirm) {
      return;
    }
    setBanner('');
    setBusy(true);
    try {
      await register(email.trim(), password);
      navigate(ROUTES.upload, { replace: true });
    } catch (error) {
      setBusy(false);
      setBanner(errorMessage(error, 'Could not create the account. Please try again.'));
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      sub="Free to start. Upload your resume right after."
      switchLine={<>Already have an account? <Link to={ROUTES.login}>Sign in</Link></>}
      form={
        <form noValidate onSubmit={submit}>
          {banner ? <div className="alert alert-error" role="alert">{banner}</div> : null}
          <Field id="register-email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={errors.email} />
          <Field id="register-password" label="Password" type="password" autoComplete="new-password" value={password} onChange={setPassword} error={errors.password} hint="8 to 72 characters." />
          <Field id="register-confirm-password" label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={errors.confirm} />
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        </form>
      }
    />
  );
}
