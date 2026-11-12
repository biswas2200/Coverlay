import { useEffect, useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import { getMyBugReports, submitBugReport } from '@/api/bugReports';
import { errorMessage } from '@/lib/errors';
import { MAX_SECTION, counterLabel, reporterStatus, safeIssueUrl, validateReport } from '@legacy/pages/bug-report-rules.js';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
}

type FieldName = 'whatHappened' | 'expected' | 'steps';

interface TextFieldProps {
  id: string;
  label: string;
  hint: string;
  optional?: boolean;
  rows: number;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}

function TextField({ id, label, hint, optional = false, rows, value, error, onChange, inputRef }: TextFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional ? <span className="muted"> (optional)</span> : null}
      </label>
      <p className="field-hint" id={`${id}-hint`}>{hint}</p>
      <textarea
        ref={inputRef}
        className={`input${error ? ' is-invalid' : ''}`}
        id={id}
        rows={rows}
        maxLength={MAX_SECTION}
        value={value}
        aria-describedby={`${id}-hint ${id}-error`}
        aria-invalid={error ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="bug-meta">
        <span className="field-hint bug-counter" aria-hidden="true">{counterLabel(value)}</span>
      </div>
      <p className="field-error" id={`${id}-error`} role="alert">{error ?? ''}</p>
    </div>
  );
}

const EMPTY = { whatHappened: '', expected: '', steps: '' };

/**
 * The "Report a bug" dialog, opened from the sidebar on every signed-in page. Three short sections the person writes
 * themselves (no AI tools); the app adds only the page. A report waits for an administrator's review before
 * anything reaches GitHub.
 */
export function BugReportDialog({ open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(EMPTY);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName | 'writtenByUser', string>>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const { data: mine = [], mutate } = useSWR(open ? '/bug-reports/mine' : null, getMyBugReports, { shouldRetryOnError: false });

  // Opening shows the modal with an empty form; closing (Escape, the backdrop, a button) tells the parent.
  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      setText(EMPTY);
      setConfirmed(false);
      setErrors({});
      setFormError('');
      setSent(false);
      element.showModal();
      first.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const report = { ...text, page: window.location.pathname, writtenByUser: confirmed };
    const found = validateReport(report) as Partial<Record<FieldName | 'writtenByUser', string>>;
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length > 0) {
      const id = found.whatHappened ? 'bug-what' : found.expected ? 'bug-expected' : found.steps ? 'bug-steps' : 'bug-confirm';
      document.getElementById(id)?.focus();
      return;
    }
    setBusy(true);
    try {
      await submitBugReport(report);
      setSent(true);
      void mutate();
    } catch (error) {
      setFormError(errorMessage(error, 'Could not send the report. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="bug-dialog"
      aria-labelledby="bug-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) {
          onClose(); // a click on the backdrop
        }
      }}
    >
      <div className="bug-head">
        <h2 id="bug-title">Report a bug</h2>
        <button className="icon-btn bug-close" type="button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      {sent ? (
        <div className="bug-thanks">
          <h3>Thank you!</h3>
          <p>We will read it soon. If it is a real bug, it goes on our GitHub issue list, and you can follow it below.</p>
          <button className="btn btn-secondary" type="button" onClick={onClose} autoFocus>Close</button>
        </div>
      ) : (
        <form className="bug-form" noValidate onSubmit={submit}>
          <div className="bug-disclaimer" role="note">
            <Icon name="alert" />
            <div>
              <strong>Please write this yourself. Do not use ChatGPT or any other AI tool.</strong>
              <p>Short and plain is perfect: we need what you actually saw, in your words. Reports that read as AI-written are closed without review.</p>
            </div>
          </div>
          <TextField id="bug-what" label="1. What went wrong?" hint="In your own words, what you saw." rows={3} value={text.whatHappened} error={errors.whatHappened} inputRef={first} onChange={(whatHappened) => setText((t) => ({ ...t, whatHappened }))} />
          <TextField id="bug-expected" label="2. What did you expect?" hint="What should have happened instead." rows={2} value={text.expected} error={errors.expected} onChange={(expected) => setText((t) => ({ ...t, expected }))} />
          <TextField id="bug-steps" label="3. How can we see it?" hint="The steps you took, if you remember them." optional rows={3} value={text.steps} error={errors.steps} onChange={(steps) => setText((t) => ({ ...t, steps }))} />
          <label className="bug-confirm" htmlFor="bug-confirm">
            <input type="checkbox" id="bug-confirm" checked={confirmed} aria-describedby="bug-confirm-error" onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I wrote this report myself, without AI tools.</span>
          </label>
          <p className="field-error" id="bug-confirm-error" role="alert">{errors.writtenByUser ?? ''}</p>
          <p className="field-hint">
            We add the page you are on and your browser name. Your report stays private until we review it; if it becomes a public GitHub issue, your email is never included.
          </p>
          {formError ? <div className="alert alert-error" role="alert">{formError}</div> : null}
          <div className="bug-actions">
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
          </div>
        </form>
      )}

      {mine.length > 0 ? (
        <details className="bug-mine-box">
          <summary>Your reports</summary>
          <ul className="bug-mine">
            {mine.slice(0, 10).map((report) => {
              const url = safeIssueUrl(report.githubIssueUrl);
              return (
                <li key={report.id}>
                  <span className="bug-mine-text">{report.whatHappened}</span>
                  <span className={`bug-status bug-status-${String(report.status).toLowerCase()}`}>
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer">{reporterStatus(report)}</a> : <span>{reporterStatus(report)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </dialog>
  );
}
