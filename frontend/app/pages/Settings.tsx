import { useEffect, useState, type FormEvent } from 'react';
import { Avatar, PresetFigure } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { PageHeader, PreviewBadge } from '@/components/PageHeader';
import { usePageTitle } from '@/lib/hooks';
import { setAvatar, squarePhoto, useAvatar } from '@/lib/avatar';
import { useUser } from '@/lib/session';
import { useStoredState } from '@/lib/storage';
import { AVATARS, validatePhotoFile } from '@legacy/pages/avatar-rules.js';
import { initials } from '@legacy/pages/insights.js';
import {
  CONNECTORS,
  connectionsKey,
  emptyConnections,
  isConnected,
  setConnected,
  statusLabel,
} from '@legacy/pages/connections-rules.js';
import {
  CONSENTS,
  EXPORT_CONTENTS,
  advanceDeletion,
  beginPurge,
  canUndo,
  defaultConsents,
  deletionStatusText,
  regionFromTimeZone,
  startDeletion,
  tombstone,
} from '@legacy/pages/settings-rules.js';

// Settings & privacy preview: account, phone change with a sample OTP, consents (EU/UK opt-in, opt-out elsewhere), the
// connected apps (shared with the Letters page), export, and the delete-account job shown step by step.

const TICK_MS = 900;
const SAMPLE_OTP = '123456';

type Job = ReturnType<typeof startDeletion>;
interface SettingsState {
  region: string;
  consents: Record<string, boolean>;
  job: Job | null;
}
type Connections = ReturnType<typeof emptyConnections>;

const validSettings = (value: unknown) => typeof value === 'object' && value !== null && 'consents' in value;
const validConnections = (value: unknown) => typeof value === 'object' && value !== null && typeof (value as { connected?: unknown }).connected === 'object';

function freshSettings(): SettingsState {
  const region = regionFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  return { region, consents: defaultConsents(region), job: null };
}


/**
 * The profile picture: the person's own photo (cut to the middle square so it fills the circle), one of eight ready-made
 * avatars, or their initials. Shown in the sidebar. A photo from LinkedIn is brought in the same way (save the image there,
 * choose it here); signing in with LinkedIn to bring it automatically is planned (RB-PIC-04).
 */
function ProfilePicture() {
  const user = useUser();
  const choice = useAvatar(user?.id);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>({ tone: 'ok', text: '' });
  const [busy, setBusy] = useState(false);
  const letters = initials(user?.email) as string;

  async function choosePhoto(file: File | null) {
    const problem = validatePhotoFile(file) as string | null;
    if (problem) {
      setMessage({ tone: 'error', text: problem });
      return;
    }
    setBusy(true);
    try {
      const src = await squarePhoto(file as File);
      setMessage(setAvatar(user?.id, { kind: 'photo', src }) ? { tone: 'ok', text: 'Photo saved. It shows in the sidebar now.' } : { tone: 'error', text: 'This browser would not keep the photo. Try a smaller one.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'That photo could not be used.' });
    } finally {
      setBusy(false);
    }
  }

  function pick(id: string, label: string) {
    setAvatar(user?.id, { kind: 'preset', id });
    setMessage({ tone: 'ok', text: `${label} avatar chosen.` });
  }

  return (
    <article className="card" aria-labelledby="picture-title">
      <div className="card-head"><h2 id="picture-title">Profile picture</h2></div>
      <div className="pic-row">
        <Avatar choice={choice} initials={letters} size={96} className="avatar-xl" />
        <div className="pic-actions">
          <p className="muted">Shown in the sidebar. Use your own photo or pick an avatar.</p>
          <div className="row">
            <label className={`btn btn-primary btn-sm${busy ? ' is-disabled' : ''}`} htmlFor="picture-file"><Icon name="plus" />{choice.kind === 'photo' ? 'Change photo' : 'Upload a photo'}</label>
            {choice.kind !== 'none' ? (
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setAvatar(user?.id, { kind: 'none' }); setMessage({ tone: 'ok', text: 'Picture removed. Your initials show instead.' }); }}>Remove</button>
            ) : null}
          </div>
          <input
            id="picture-file"
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => { void choosePhoto(event.target.files?.[0] ?? null); event.target.value = ''; }}
          />
        </div>
      </div>
      <p className="section-label" id="avatar-label" style={{ margin: '18px 0 8px' }}>Or choose an avatar</p>
      <div className="pic-grid" role="radiogroup" aria-labelledby="avatar-label">
        {(AVATARS as { id: string; label: string; bg: string; fg: string }[]).map((preset) => {
          const selected = choice.kind === 'preset' && choice.id === preset.id;
          return (
            <button key={preset.id} className={`pic-option${selected ? ' is-selected' : ''}`} type="button" role="radio" aria-checked={selected} aria-label={preset.label} title={preset.label} onClick={() => pick(preset.id, preset.label)}>
              <PresetFigure preset={preset} />
            </button>
          );
        })}
      </div>
      <p className={message.tone === 'error' ? 'field-error' : 'field-hint'} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>
      <p className="field-hint">Photos are JPEG, PNG or WebP, up to 5 MB, and are cut to a square. Got a LinkedIn photo? Open it on LinkedIn, save the image, and upload it here. Signing in with LinkedIn to bring it in for you is planned.</p>
    </article>
  );
}

export default function Settings() {
  usePageTitle('Settings & privacy');
  const user = useUser();
  const [state, setState] = useStoredState<SettingsState>(`coverlay.preview.settings.${user?.id ?? 'guest'}`, freshSettings, validSettings);
  const [connections, setConnections] = useStoredState<Connections>(connectionsKey(user?.id), emptyConnections, validConnections);
  const [status, setStatus] = useState('');
  const [phone, setPhone] = useState({ shown: '+91 ••••• ••210', value: '', otp: '', otpSent: false, error: '' });
  const [exported, setExported] = useState(false);
  const [mode, setMode] = useState<'grace' | 'now'>('grace');
  const [deletePosts, setDeletePosts] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const job = state.job;
  const now = Date.now();

  // The preview's worker: one step per tick; the search step fails once to show the retry.
  const running = job?.status === 'running';
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const ticker = window.setInterval(() => {
      setState((current) => (current.job ? { ...current, job: advanceDeletion(current.job, { failing: ['search'] }) } : current));
    }, TICK_MS);
    return () => window.clearInterval(ticker);
  }, [running, setState]);

  // The "Connected apps" step of the job: every app is disconnected once it is done.
  const finished = job?.status === 'done';
  useEffect(() => {
    if (finished) {
      setConnections(emptyConnections());
    }
  }, [finished, setConnections]);

  function changeRegion(region: string) {
    setState((current) => ({ ...current, region, consents: { ...current.consents, ...defaultConsents(region) } }));
  }

  function toggleConsent(key: string, on: boolean) {
    setState((current) => ({ ...current, consents: { ...current.consents, [key]: on } }));
    setStatus(`${CONSENTS.find((c: { key: string; label: string }) => c.key === key)?.label} ${on ? 'on' : 'off'}.`);
  }

  function submitPhone(event: FormEvent) {
    event.preventDefault();
    const number = phone.value.replace(/[\s-]/g, '');
    if (!phone.otpSent) {
      if (!/^\+?\d{10,15}$/.test(number)) {
        setPhone({ ...phone, error: 'Enter a mobile number with its country code, like +91 98765 43210.' });
        return;
      }
      setPhone({ ...phone, otpSent: true, error: '' });
      requestAnimationFrame(() => document.getElementById('otp')?.focus());
      return;
    }
    if (phone.otp.trim() !== SAMPLE_OTP) {
      setPhone({ ...phone, error: "That code doesn't match. In the preview it's 123456." });
      return;
    }
    setPhone({ shown: `${number.slice(0, 3)} ••••• ••${number.slice(-3)}`, value: '', otp: '', otpSent: false, error: '' });
    setStatus('Phone number changed.');
  }

  function connect(id: string, label: string, on: boolean) {
    setConnections(setConnected(connections, id, on));
    setStatus(`${label} ${on ? 'connected (a sample: nothing is linked in the preview)' : 'disconnected'}.`);
  }

  function submitDelete(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    setDeleteError('');
    setState((current) => ({ ...current, job: startDeletion({ mode, deletePosts }, Date.now()) }));
  }

  const stone = job ? tombstone(job, '7f3a…c21e') : null;

  return (
    <>
      <PageHeader crumb="Account" title="Settings & privacy" actions={<PreviewBadge />} />
      <div className="content">
        <p className="alert alert-info" role="note">
          Preview with sample data: nothing here changes your real account. Deleting runs a sample job in this browser so you can see each step.
        </p>
        <p className="sr-only" role="status">{status}</p>
        <section className="grid-main settings">
          <div className="settings-col">
            <ProfilePicture />
            <article className="card" aria-labelledby="account-title">
              <div className="card-head"><h2 id="account-title">Account</h2></div>
              <dl className="kv">
                <div><dt>Email</dt><dd>{user?.email ?? ''}</dd></div>
                <div><dt>Phone</dt><dd><span>{phone.shown}</span> <span className="badge badge-green">Verified</span></dd></div>
                <div><dt>Age</dt><dd>Confirmed 18 or older</dd></div>
              </dl>
              <details className="settings-phone">
                <summary>Change phone number</summary>
                <form className="settings-form" noValidate onSubmit={submitPhone}>
                  <div className="field">
                    <label htmlFor="new-phone">New number</label>
                    <input className="input mono" id="new-phone" inputMode="tel" placeholder="+91 98765 43210" value={phone.value} onChange={(event) => setPhone({ ...phone, value: event.target.value })} />
                  </div>
                  {phone.otpSent ? (
                    <div className="field">
                      <label htmlFor="otp">Code sent by SMS (preview code: 123456)</label>
                      <input className="input mono" id="otp" inputMode="numeric" maxLength={6} value={phone.otp} onChange={(event) => setPhone({ ...phone, otp: event.target.value })} />
                    </div>
                  ) : null}
                  <p className="field-error" role="alert">{phone.error}</p>
                  <button className="btn btn-secondary btn-sm" type="submit">{phone.otpSent ? 'Verify' : 'Send code'}</button>
                </form>
                <p className="field-hint">One account per phone number. It&apos;s stored encrypted and deleted with your account.</p>
              </details>
            </article>

            <article className="card" aria-labelledby="apps-title">
              <div className="card-head"><h2 id="apps-title">Connected apps</h2></div>
              <p className="muted settings-lead">The services Lay AI can work with. Nothing is linked until you connect it, and you can disconnect at any time.</p>
              <ul className="settings-apps">
                {CONNECTORS.map((connector) => {
                  const linked = isConnected(connections, connector.id);
                  return (
                    <li className={`settings-app is-${connector.status}`} key={connector.id}>
                      <div className="settings-app-head">
                        <span className="settings-app-name">
                          <strong>{connector.label}</strong>
                          {connector.detail ? <span className="field-hint">{connector.detail}</span> : null}
                        </span>
                        <span className={`badge ${linked ? 'badge-green' : ''}`}>{statusLabel(connector, connections)}</span>
                      </div>
                      <p className="settings-app-text">{connector.does}</p>
                      {connector.asks ? <p className="field-hint">Asks for: {connector.asks}</p> : null}
                      {connector.note ? <p className="field-hint">{connector.note}</p> : null}
                      {connector.status === 'connectable' ? (
                        <button className={`btn btn-sm ${linked ? 'btn-secondary' : 'btn-primary'}`} type="button" onClick={() => connect(connector.id, connector.label, !linked)}>
                          {linked ? `Disconnect ${connector.label}` : `Connect ${connector.label}`}
                        </button>
                      ) : connector.href ? (
                        <a className="btn btn-secondary btn-sm" href={connector.href}>{connector.linkLabel}</a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="field-hint">
                Lay AI uses a connected app only when you ask it to, and only for your own request. It never applies, sends or posts by itself. Deleting your account disconnects every app.
              </p>
            </article>

            <article className="card" aria-labelledby="privacy-title">
              <div className="card-head">
                <h2 id="privacy-title">Privacy</h2>
                <label className="settings-region">
                  <span>Region</span>
                  <select className="select" value={state.region} onChange={(event) => changeRegion(event.target.value)}>
                    <option value="Other">India and others</option>
                    <option value="EU/UK">EU / UK</option>
                  </select>
                </label>
              </div>
              <p className="muted settings-lead">
                {state.region === 'EU/UK' ? 'In the EU and UK these start off: you choose to turn them on.' : 'These start on; you can turn each one off at any time.'}
              </p>
              <ul className="settings-toggles">
                {CONSENTS.map((consent: { key: string; label: string; hint: string }) => (
                  <li key={consent.key}>
                    <label className="settings-toggle">
                      <input type="checkbox" role="switch" checked={Boolean(state.consents[consent.key])} onChange={(event) => toggleConsent(consent.key, event.target.checked)} />
                      <span className="settings-switch" aria-hidden="true" />
                      <span><strong>{consent.label}</strong><span className="field-hint">{consent.hint}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card" aria-labelledby="export-title">
              <div className="card-head"><h2 id="export-title">Your data</h2></div>
              <p className="muted settings-lead">A ZIP with everything we hold about you, as JSON plus your uploaded files:</p>
              <ul className="tick-list">
                {EXPORT_CONTENTS.map((item: string) => (
                  <li key={item}><Icon name="check" /><span>{item}</span></li>
                ))}
              </ul>
              <button className="btn btn-secondary" type="button" onClick={() => setExported(true)}>
                <Icon name="upload" />
                Export my data
              </button>
              {exported ? <p className="field-hint">In the real app the ZIP is ready in a minute and the link is emailed to you.</p> : null}
            </article>
          </div>

          <article className="card settings-danger" aria-labelledby="delete-title">
            <div className="card-head"><h2 id="delete-title">Delete my account</h2><Icon name="trash" /></div>
            {!job ? (
              <div>
                <p className="muted">
                  Deletes your resumes, versions, chats, applications and wallet, and disconnects your apps. What stays is anonymous: usage counts and resume features under a random id that no longer leads to anyone, and community posts unless you delete them too.
                </p>
                <form className="settings-form" noValidate onSubmit={submitDelete}>
                  <fieldset className="rb-question">
                    <legend>When</legend>
                    <label className="settings-radio"><input type="radio" name="mode" value="grace" checked={mode === 'grace'} onChange={() => setMode('grace')} /> <span><strong>In 14 days</strong> (you can undo until then)</span></label>
                    <label className="settings-radio"><input type="radio" name="mode" value="now" checked={mode === 'now'} onChange={() => setMode('now')} /> <span><strong>Now</strong>, no undo</span></label>
                  </fieldset>
                  <label className="bug-confirm"><input type="checkbox" checked={deletePosts} onChange={(event) => setDeletePosts(event.target.checked)} /> Also delete my community posts</label>
                  <div className="field">
                    <label htmlFor="delete-password">Your password</label>
                    <input className="input" id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                  </div>
                  <p className="field-error" role="alert">{deleteError}</p>
                  <button className="btn btn-danger" type="submit">Delete my account</button>
                </form>
              </div>
            ) : (
              <div className="settings-job">
                <p className={`settings-job-status is-${job.status}`} role="status">{deletionStatusText(job, now)}</p>
                <ol className="settings-steps">
                  {job.steps.map((step: { label: string; state: string; attempts: number }) => (
                    <li className={`settings-step is-${step.state}`} key={step.label}>
                      <span className="settings-step-icon" aria-hidden="true">
                        {step.state === 'done' ? <Icon name="check" /> : step.state === 'retrying' ? <Icon name="refresh" /> : <span className="sb-dot" />}
                      </span>
                      <span>{step.label}</span>
                      <span className="field-hint">{step.state === 'retrying' ? `retry ${step.attempts}` : step.state === 'done' ? 'done' : 'waiting'}</span>
                    </li>
                  ))}
                </ol>
                <div className="row">
                  {canUndo(job, now) ? (
                    <button className="btn btn-secondary" type="button" onClick={() => { setState((current) => ({ ...current, job: null })); setStatus('Your account is kept.'); }}>Keep my account</button>
                  ) : null}
                  {job.status === 'scheduled' ? (
                    <button className="btn btn-ghost" type="button" onClick={() => setState((current) => (current.job ? { ...current, job: beginPurge(current.job, Date.now()) } : current))}>Skip the 14 days (preview)</button>
                  ) : null}
                  {job.status === 'done' ? (
                    <button className="btn btn-ghost" type="button" onClick={() => setState((current) => ({ ...current, job: null }))}>Reset preview</button>
                  ) : null}
                </div>
                {stone ? (
                  <details className="apps-stored">
                    <summary>What remains (the tombstone)</summary>
                    <pre className="mono">{JSON.stringify(stone, null, 2)}</pre>
                  </details>
                ) : null}
              </div>
            )}
          </article>
        </section>
      </div>
    </>
  );
}
