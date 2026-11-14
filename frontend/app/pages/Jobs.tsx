import { memo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import useSWR from 'swr';
import { getRecommended, saveJob, unsaveJob } from '@/api/jobs';
import type { RankedJob } from '@/api/types';
import { Chips } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { EmptyCard, LoadError, Skeleton } from '@/components/Status';
import { VersionMenu } from '@/components/VersionMenu';
import { errorMessage } from '@/lib/errors';
import { noteJobOpened } from '@/lib/activity';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { useUser } from '@/lib/session';
import { emptyState, employmentLabel, isNewJob, isRanked, locationLabel, matchBand, postedLabel, safeLink, workplaceLabel } from '@legacy/pages/jobs-rules.js';

// Jobs for you: open jobs in our city, ranked for the person's latest resume (or newest first when there is none),
// with search and a workplace filter. Each card says why it ranks where it does, links to the company's own posting,
// and can be saved for tracking. Everything here comes from third-party job feeds, so it is shown as text and every
// link passes through safeLink().

const BAND_BADGE: Record<string, string> = { 'Strong match': 'badge-green', 'Good match': 'badge-blue', 'Partial match': '' };

const JobCard = memo(function JobCard({ item, ranked }: { item: RankedJob; ranked: boolean }) {
  const { job } = item;
  const userId = useUser()?.id;
  const opened = () => noteJobOpened(userId, job);
  const [saved, setSaved] = useState(Boolean(item.savedStatus));
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const band = ranked ? matchBand(item.score) : null;
  const matched = ranked ? item.matchedSkills ?? [] : [];
  const missing = ranked ? item.missingSkills ?? [] : [];
  const meta = [locationLabel(job.location), workplaceLabel(job.workplaceType), employmentLabel(job.employmentType), postedLabel(job)].filter(Boolean).join(' · ');
  const apply = safeLink(job.applyUrl);
  const view = safeLink(job.url);

  async function toggle() {
    setBusy(true);
    try {
      if (saved) {
        await unsaveJob(job.id);
      } else {
        await saveJob(job.id);
      }
      setSaved(!saved);
      setRetry(false);
    } catch (error) {
      setRetry(true);
      console.error('Could not update the saved job', error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card job-card">
      <div className="job-head">
        <div>
          <h3>
            <span>{job.title}</span> {isNewJob(job) ? <span className="badge badge-violet">New</span> : null}
          </h3>
          <p className="job-company">{job.company}</p>
          <p className="job-meta muted" title={job.location ?? ''}>{meta}</p>
        </div>
        {band ? (
          <div className="match-score">
            <span className="match-pct">{band.percent}%</span>
            <span className={`badge ${BAND_BADGE[band.label]}`.trim()}>{band.label}</span>
          </div>
        ) : null}
      </div>
      <p className="job-why">{item.why}</p>
      {matched.length + missing.length > 0 ? (
        <div className="match-skills">
          {matched.length > 0 ? (
            <div>
              <p className="section-label">You have</p>
              <Chips items={matched} tone="green" />
            </div>
          ) : null}
          {missing.length > 0 ? (
            <div>
              <p className="section-label">Skills to add</p>
              <Chips items={missing} tone="amber" />
            </div>
          ) : null}
        </div>
      ) : null}
      {job.excerpt ? <p className="muted job-excerpt">{job.excerpt}</p> : null}
      <div className="match-foot">
        <div className="row">
          {apply ? (
            <a className="btn btn-primary btn-sm" href={apply} target="_blank" rel="noopener noreferrer" onClick={opened}>
              <Icon name="external" />
              Apply
            </a>
          ) : null}
          {view ? (
            <a className="btn btn-ghost btn-sm" href={view} target="_blank" rel="noopener noreferrer" onClick={opened}>View posting</a>
          ) : null}
        </div>
        <button className="btn btn-secondary btn-sm" type="button" aria-pressed={saved} disabled={busy} onClick={toggle}>
          <Icon name="bookmark" />
          <span>{retry ? 'Try again' : saved ? 'Saved' : 'Save'}</span>
        </button>
      </div>
    </article>
  );
});

export default function Jobs() {
  usePageTitle('Jobs for you');
  const [query, setQuery] = useState('');
  const [workplace, setWorkplace] = useState('');
  // The search runs when the form is sent or the workplace changes, not on every key.
  const [filters, setFilters] = useState({ q: '', workplace: '' });
  const { data, error, isLoading, mutate } = useSWR(['jobs', filters.q, filters.workplace], () => getRecommended(filters), { revalidateOnFocus: false });

  function search(event: FormEvent) {
    event.preventDefault();
    setFilters({ q: query, workplace });
  }

  const ranked = data ? isRanked(data) : false;
  const state = data ? emptyState(data) : null;

  return (
    <>
      <PageHeader
        crumb="Jobs"
        title="Jobs for you"
        actions={
          <>
            <VersionMenu label="Ranked with" />
            <Link className="btn btn-secondary" to={ROUTES.saved}>
              <Icon name="bookmark" />
              Saved jobs
            </Link>
          </>
        }
      />
      <div className="content">
        <form className="card job-filters" role="search" onSubmit={search}>
          <label className="sr-only" htmlFor="job-query">Search jobs</label>
          <input className="input" id="job-query" type="search" placeholder="Search by title or company, e.g. data engineer" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
          <label className="sr-only" htmlFor="job-workplace">Workplace</label>
          <select
            className="select"
            id="job-workplace"
            value={workplace}
            onChange={(event) => {
              setWorkplace(event.target.value);
              setFilters({ q: query, workplace: event.target.value });
            }}
          >
            <option value="">Any workplace</option>
            <option value="onsite">On-site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </select>
          <button className="btn btn-primary" type="submit">
            <Icon name="search" />
            Search
          </button>
        </form>

        {data && !ranked ? (
          <p className="alert alert-info" role="status">
            <Icon name="upload" />
            <span>These are the newest open jobs. <Link to={ROUTES.upload}>Upload a resume</Link> to see how well each one fits you.</span>
          </p>
        ) : null}

        {data && data.jobs.length > 0 ? (
          <div className="job-summary">
            <p className="muted">
              {ranked
                ? `${data.jobs.length} of ${data.openJobs} open jobs, ranked for your resume (version ${data.resumeVersion}).${data.roles?.length ? ' Matched roles:' : ''}`
                : `${data.jobs.length} of ${data.openJobs} open jobs, newest first.`}
            </p>
            {ranked ? <Chips items={data.roles} label="Your matched roles" /> : null}
          </div>
        ) : null}

        {isLoading ? <Skeleton label="Loading jobs" /> : null}
        {error ? <LoadError title="Could not load jobs" message={errorMessage(error, 'Please check your connection and try again.')} onRetry={() => void mutate()} /> : null}
        {state === 'no-open-jobs' ? (
          <EmptyCard icon="briefcase" title="No open jobs right now">We read jobs from each company&apos;s own careers feed every morning. Check back tomorrow.</EmptyCard>
        ) : null}
        {state === 'no-results' ? <EmptyCard icon="search" title="No jobs match these filters">Try fewer words, or any workplace.</EmptyCard> : null}

        <div className="job-list" aria-live="polite">
          {data?.jobs.map((item) => <JobCard key={item.job.id} item={item} ranked={ranked} />)}
        </div>

        <p className="muted job-credit">
          Jobs come from each company&apos;s own careers page (Lever, Greenhouse, Ashby). Company list partly from{' '}
          <a href="https://www.bangalorestartupmap.com" target="_blank" rel="noopener noreferrer">Bangalore Startup Map</a>.
        </p>
      </div>
    </>
  );
}
