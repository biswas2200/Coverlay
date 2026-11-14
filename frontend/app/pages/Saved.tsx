import { useState } from 'react';
import { Link } from 'react-router';
import useSWR from 'swr';
import { getSaved, saveJob, unsaveJob } from '@/api/jobs';
import type { SavedJob } from '@/api/types';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { EmptyCard, LoadError, Skeleton } from '@/components/Status';
import { errorMessage } from '@/lib/errors';
import { noteJobOpened } from '@/lib/activity';
import { usePageTitle } from '@/lib/hooks';
import { useUser } from '@/lib/session';
import { ROUTES } from '@/lib/routes';
import { SAVED_STATUSES, groupSaved, locationLabel, postedLabel, safeLink, workplaceLabel } from '@legacy/pages/jobs-rules.js';

// Saved jobs, grouped by where each application stands (Saved → Applied → Interviewing → Offer, or Not selected).
// Changing a job's status moves it to that group; Remove drops it. A job the company has since closed stays, marked.

function SavedCard({ item, onChange }: { item: SavedJob; onChange: (next: SavedJob[] | ((list: SavedJob[]) => SavedJob[])) => void }) {
  const { job } = item;
  const userId = useUser()?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const view = safeLink(job.url);
  const meta = [locationLabel(job.location), workplaceLabel(job.workplaceType), postedLabel(job)].filter(Boolean).join(' · ');

  async function changeStatus(status: string) {
    setBusy(true);
    setError('');
    try {
      const updated = await saveJob(job.id, status);
      onChange((list) => list.map((entry) => (entry.job.id === job.id ? updated : entry)));
    } catch (failure) {
      setError(errorMessage(failure, 'Could not change the status. Please try again.'));
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await unsaveJob(job.id);
      onChange((list) => list.filter((entry) => entry.job.id !== job.id));
    } catch (failure) {
      setError(errorMessage(failure, 'Could not remove this job. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <article className="card saved-card">
      <div>
        <h3>{job.title}</h3>
        <p className="job-company">{job.company}</p>
        <p className="job-meta muted" title={job.location ?? ''}>{meta}</p>
        {job.active === false ? <span className="badge badge-red">Closed by the company</span> : null}
      </div>
      <div className="saved-actions">
        <label className="sr-only" htmlFor={`status-${job.id}`}>Application status</label>
        <select className="select" id={`status-${job.id}`} value={item.status} disabled={busy} onChange={(event) => void changeStatus(event.target.value)}>
          {SAVED_STATUSES.map(({ value, label }: { value: string; label: string }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {view ? (
          <a className="btn btn-ghost btn-sm" href={view} target="_blank" rel="noopener noreferrer" onClick={() => noteJobOpened(userId, job)}>
            <Icon name="external" />
            Posting
          </a>
        ) : null}
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void remove()}>Remove</button>
      </div>
      {error ? <p className="alert alert-error" role="alert">{error}</p> : null}
    </article>
  );
}

export default function Saved() {
  usePageTitle('Saved jobs');
  const { data, error, isLoading, mutate } = useSWR('/jobs/saved', getSaved, { revalidateOnFocus: false });

  // A change made here updates the list on screen at once; the answer from the backend is what is kept.
  const update = (next: SavedJob[] | ((list: SavedJob[]) => SavedJob[])) =>
    void mutate((current) => (typeof next === 'function' ? next(current ?? []) : next), { revalidate: false });

  return (
    <>
      <PageHeader
        crumb="Jobs"
        title="Saved jobs"
        actions={
          <Link className="btn btn-secondary" to={ROUTES.jobs}>
            <Icon name="search" />
            Find jobs
          </Link>
        }
      />
      <div className="content">
        {isLoading ? <Skeleton rows={1} label="Loading saved jobs" /> : null}
        {error ? <LoadError title="Could not load your saved jobs" message={errorMessage(error, 'Please check your connection and try again.')} onRetry={() => void mutate()} /> : null}
        {data && data.length === 0 ? (
          <EmptyCard
            icon="bookmark"
            title="No saved jobs yet"
            action={<Link className="btn btn-primary" to={ROUTES.jobs}>See jobs for you</Link>}
          >
            Save jobs from your recommendations, then track each application here: applied, interviewing, offer.
          </EmptyCard>
        ) : null}
        {data && data.length > 0 ? (
          <div className="saved-board">
            {groupSaved(data).map((group: { label: string; items: SavedJob[] }) => (
              <section className="saved-group" key={group.label}>
                <h2 className="saved-group-title">
                  <span>{group.label}</span> <span className="count">{group.items.length}</span>
                </h2>
                <div className="saved-items">
                  {group.items.map((item) => <SavedCard key={item.job.id} item={item} onChange={update} />)}
                </div>
                {group.items.length === 0 ? <p className="muted saved-none">Nothing here yet.</p> : null}
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
