import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { regionFromTimeZone } from '@legacy/pages/settings-rules.js';
import { analyticsDefault, emailState, finalStepError, normalizePhone, otpValid, validPassword } from '@legacy/pages/signup-rules.js';

// The planned sign-up, clickable: account -> phone with a code -> privacy choices. Nothing is sent anywhere; the code is
// always 123456.

const STEPS = ['Account', 'Phone', 'Privacy'];

export default function SignupPreview() {
  usePageTitle('Create your account (preview)');
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error1, setError1] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error2, setError2] = useState('');
  const [region, setRegion] = useState(() => regionFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [analytics, setAnalytics] = useState(() => analyticsDefault(regionFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)));
  const [error3, setError3] = useState('');
  const [done, setDone] = useState('');

  function submitAccount(event: FormEvent) {
    event.preventDefault();
    const state = emailState(email);
    if (state === 'invalid') {
      setError1('Enter a valid email address.');
      return;
    }
    if (state === 'deleting') {
      setDeleting(new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
      setError1('');
      return;
    }
    if (!validPassword(password)) {
      setError1('Use 8 to 72 characters for the password.');
      return;
    }
    setError1('');
    setStep(2);
  }

  function submitPhone(event: FormEvent) {
    event.preventDefault();
    if (!codeSent) {
      if (!normalizePhone(phone)) {
        setError2('Enter a mobile number like +91 98765 43210.');
        return;
      }
      setCodeSent(true);
      setError2('');
      requestAnimationFrame(() => document.getElementById('su-otp')?.focus());
      return;
    }
    if (!otpValid(otp)) {
      setError2("That code doesn't match. In the preview it's 123456.");
      return;
    }
    setError2('');
    setStep(3);
  }

  function submitPrivacy(event: FormEvent) {
    event.preventDefault();
    const problem = finalStepError({ adult: age, terms });
    setError3(problem ?? '');
    if (problem) {
      return;
    }
    setDone(`Account created (preview). Analytics ${analytics ? 'on' : 'off'}; you can change it in Settings & privacy.`);
    setStep(4);
  }

  function chooseRegion(next: string) {
    setRegion(next);
    setAnalytics(analyticsDefault(next));
  }

  return (
    <main className="auth-wrap">
      <Link className="brand" to={ROUTES.home}>
        <img className="brand-mark" src="/logo.png" alt="" />
        Coverlay
      </Link>

      <div className="card auth-card signup-card">
        <div className="row signup-head"><h1>Create your account</h1><span className="badge badge-violet">Preview</span></div>
        <p className="sub">The planned sign-up: email, a verified phone (one account per number), 18+ and your privacy choices. Nothing is sent anywhere.</p>
        <ol className="signup-steps" aria-label="Steps">
          {STEPS.map((label, index) => (
            <li key={label} className={index + 1 < step ? 'is-done' : undefined} aria-current={index + 1 === step ? 'true' : undefined}>{label}</li>
          ))}
        </ol>

        {step === 1 ? (
          <form className="signup-form" noValidate onSubmit={submitAccount}>
            <div className="field">
              <label htmlFor="su-email">Email</label>
              <input id="su-email" className="input" type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setDeleting(null); }} />
              <p className="field-hint">Try deleting@example.com to see an account that is being deleted.</p>
            </div>
            <div className="field">
              <label htmlFor="su-password">Password</label>
              <input id="su-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <p className="field-hint">8 to 72 characters.</p>
            </div>
            {deleting ? (
              <div className="notice signup-deleting">
                <p><strong>This account is being deleted</strong> (on <span>{deleting}</span>). Restore it, or delete it now and start fresh with the same email.</p>
                <div className="row">
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => { setDeleting(null); setError1(''); setDone('Restored (preview): the old account is back and the deletion is cancelled. Sign in as usual.'); }}>Restore my account</button>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setDeleting(null); setError1('The old account is deleted now (preview). Choose a password to start fresh with the same email.'); setEmail('fresh-start@example.com'); }}>Delete it now, start fresh</button>
                </div>
              </div>
            ) : null}
            <p className="field-error" role="alert">{error1}</p>
            <button className="btn btn-primary btn-block" type="submit">Continue</button>
          </form>
        ) : null}

        {step === 2 ? (
          <form className="signup-form" noValidate onSubmit={submitPhone}>
            <div className="field">
              <label htmlFor="su-phone">Mobile number</label>
              <input id="su-phone" className="input mono" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(event) => setPhone(event.target.value)} />
              <p className="field-hint">One account per number. We keep it encrypted and delete it with your account.</p>
            </div>
            {codeSent ? (
              <div className="field">
                <label htmlFor="su-otp">6-digit code (preview code: 123456)</label>
                <input id="su-otp" className="input mono" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value)} />
              </div>
            ) : null}
            <p className="field-error" role="alert">{error2}</p>
            <button className="btn btn-primary btn-block" type="submit">{codeSent ? 'Verify' : 'Send code'}</button>
          </form>
        ) : null}

        {step === 3 ? (
          <form className="signup-form" noValidate onSubmit={submitPrivacy}>
            <label className="settings-region">
              <span>Region</span>
              <select className="select" value={region} onChange={(event) => chooseRegion(event.target.value)}>
                <option value="Other">India and others</option>
                <option value="EU/UK">EU / UK</option>
              </select>
            </label>
            <label className="bug-confirm"><input type="checkbox" checked={age} onChange={(event) => setAge(event.target.checked)} /> I&apos;m 18 or older</label>
            <label className="bug-confirm"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} /> I agree to the Terms and the Privacy notice</label>
            <label className="bug-confirm">
              <input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} />{' '}
              <span>
                Usage analytics and AI learning, under a random id (never my name or contacts)
                <span className="field-hint signup-default">{region === 'EU/UK' ? ' Off until you tick it (EU/UK).' : ' On by default; you can switch it off any time.'}</span>
              </span>
            </label>
            <p className="field-error" role="alert">{error3}</p>
            <button className="btn btn-primary btn-block" type="submit">Create account (preview)</button>
          </form>
        ) : null}

        {done ? <div className="alert alert-success" role="status">{done}</div> : null}
      </div>

      <p className="auth-switch"><Link to={ROUTES.register}>Today&apos;s sign-up</Link> · <Link to={ROUTES.login}>Sign in</Link></p>
    </main>
  );
}
