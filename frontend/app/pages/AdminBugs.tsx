import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import useSWR from 'swr';
import { approveBugReport, getBugReports, linkBugReport, rejectBugReport } from '@/api/bugReports';
import type { BugReport } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { EmptyCard, Skeleton } from '@/components/Status';
import { errorMessage } from '@/lib/errors';
import { usePageTitle } from '@/lib/hooks';
import { useUser } from '@/lib/session';
import { STATUSES, safeIssueUrl, suggestTitle } from '@legacy/pages/bug-report-rules.js';

// The admin review queue for bug reports. A report reaches GitHub only from here: approve (new issue), link (existing
// issue), or reject (stays private). The backend checks ADMIN.

const TABS = [
  { status: 'PENDING', label: 'Waiting for review' },
  { status: 'APPROVED', label: 'On GitHub' },
  { status: 'LINKED', label: 'Linked' },
  { status: 'REJECTED', label: 'Rejected' },
];

const EMPTY_TEXT: Record<string, string> = {
  PENDING: 'No reports waiting for review.',
  APPROVED: 'No reports have become GitHub issues yet.',
  LINKED: 'No reports have been linked to existing issues yet.',
  REJECTED: 'No rejected reports.',
};

function ReportCard({ report, onDone }: { report: BugReport; onDone: () => void }) {
  const [title, setTitle] = useState(() => suggestTitle(report.whatHappened));
  const [issue, setIssue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const sent = new Date(report.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const url = safeIssueUrl(report.githubIssueUrl);

  async function act(label: string, call: () => Promise<unknown>) {
    setError('');
    setBusy(label);
    try {
      await call();
      onDone();
    } catch (failure) {
      setError(errorMessage(failure, 'That did not work. Please try again.'));
      setBusy(null);
    }
  }

  function approve(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError('Give the issue a title first.');
      return;
    }
    void act('Opening issue…', () => approveBugReport(report.id, title.trim()));
  }

  function link() {
    if (!issue.trim()) {
      setError('Enter the existing issue: #42 or its link.');
      return;
    }
    void act('Linking…', () => linkBugReport(report.id, issue.trim(), note.trim()));
  }

  return (
    <article className="card bug-card">
      <div className="bug-card-head">
        <span className="mono muted">{sent} · {report.reporterEmail ?? 'unknown reporter'}</span>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer">GitHub #{report.githubIssueNumber}</a> : null}
      </div>
      <h3>What went wrong</h3>
      <p className="bug-text">{report.whatHappened}</p>
      <h3>What was expected</h3>
      <p className="bug-text">{report.expected}</p>
      {report.steps ? (
        <div>
          <h3>How to see it</h3>
          <p className="bug-text">{report.steps}</p>
        </div>
      ) : null}
      <p className="field-hint">Page {report.page || 'unknown'} · {report.userAgent || 'browser unknown'}</p>
      {report.reviewNote ? <p className="field-hint">Note to reporter: {report.reviewNote}</p> : null}
      {report.status === 'PENDING' ? (
        <form className="bug-review" onSubmit={approve}>
          <div className="field">
            <label>GitHub issue title</label>
            <input className="input" name="title" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="bug-review-row">
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy !== null}>{busy === 'Opening issue…' ? busy : 'Approve: open issue'}</button>
          </div>
          <div className="field">
            <label>Or link an existing issue</label>
            <input className="input" name="issue" placeholder="#42 or the issue link" value={issue} onChange={(event) => setIssue(event.target.value)} />
          </div>
          <div className="field">
            <label>Note for the reporter <span className="muted">(optional)</span></label>
            <input className="input" name="note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="bug-review-row">
            <button className="btn btn-secondary btn-sm" type="button" disabled={busy !== null} onClick={link}>{busy === 'Linking…' ? busy : 'Link'}</button>
            <button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => void act('Rejecting…', () => rejectBugReport(report.id, note.trim()))}>{busy === 'Rejecting…' ? busy : 'Reject'}</button>
          </div>
          <p className="field-error" role="alert">{error}</p>
        </form>
      ) : null}
    </article>
  );
}

export default function AdminBugs() {
  usePageTitle('Bug reports');
  const user = useUser();
  const { hash } = useLocation();
  const wanted = hash.slice(1);
  const status = STATUSES.includes(wanted) ? wanted : 'PENDING';
  const isAdmin = user?.role === 'ADMIN';
  const { data, error, isLoading, mutate } = useSWR(isAdmin ? ['bug-reports', status] : null, () => getBugReports(status), { revalidateOnFocus: false });

  return (
    <>
      <PageHeader crumb="Admin console" title="Bug reports" />
      <nav className="tabs" aria-label="Report status">
        {TABS.map((tab) => (
          <Link key={tab.status} className="tab" to={{ hash: tab.status }} aria-current={tab.status === status ? 'page' : undefined}>{tab.label}</Link>
        ))}
      </nav>
      <div className="content">
        <p className="hint">
          Nothing reaches GitHub until you act here. <strong>Approve</strong> opens a new issue with your title; <strong>Link</strong> points the report at an issue that already exists; <strong>Reject</strong> keeps it off GitHub. The reporter sees the outcome and your note, never your name.
        </p>
        {!isAdmin ? <EmptyCard icon="alert" title="Admins only">Only administrators can review bug reports.</EmptyCard> : null}
        {isLoading ? <Skeleton rows={1} label="Loading reports" /> : null}
        {error ? <EmptyCard icon="alert" title="Could not load the reports">{errorMessage(error, 'Please check your connection and try again.')}</EmptyCard> : null}
        {data && data.length === 0 ? <EmptyCard icon="check" title="Nothing here">{EMPTY_TEXT[status]}</EmptyCard> : null}
        {data && data.length > 0 ? (
          <div className="bug-list">
            {data.map((report) => (
              <ReportCard key={report.id} report={report} onDone={() => void mutate((current) => current?.filter((r) => r.id !== report.id), { revalidate: false })} />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
