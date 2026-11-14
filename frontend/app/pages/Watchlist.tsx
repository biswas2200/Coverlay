import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import useSWR from 'swr';
import { addCompany, getWatchlist, getWatchlistLimits, searchCompanies, unwatchCompany, watchCompany } from '@/api/watchlist';
import type { CompanyHit, WatchedCompany } from '@/api/types';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { EmptyCard, LoadError, Skeleton } from '@/components/Status';
import { errorMessage } from '@/lib/errors';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { safeLink } from '@legacy/pages/jobs-rules.js';
import { addCompanyRequest, addedMessage, capLabel, companyStatusBadge, isFull, isSearchable, newJobsLabel, openJobsLabel } from '@legacy/pages/watchlist-rules.js';

// The companies the person watches for new jobs. Search finds a company in our list and Watch adds it; each card shows
// whether we can read its jobs, how many are open and how many are new this week. Stop watching drops it. Every person
// may watch up to `maxCompanies`; the backend also limits how fast the list changes, and its 409/429 messages are
// shown as they are.

interface WatchData {
  list: WatchedCompany[];
  /** From GET /watchlist/limits; null if that call failed (the backend still enforces the cap). */
  max: number | null;
}

async function loadWatchlist(): Promise<WatchData> {
  const [list, limits] = await Promise.all([getWatchlist(), getWatchlistLimits().catch(() => null)]);
  return { list, max: limits?.maxCompanies ?? null };
}

function WatchedCard({ item, onRemoved }: { item: WatchedCompany; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const badge = companyStatusBadge(item.status);
  const open = openJobsLabel(item.openJobs);
  const fresh = newJobsLabel(item.newJobs);
  const careers = safeLink(item.careersUrl);

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await unwatchCompany(item.companyId);
      onRemoved(item.companyId);
    } catch (failure) {
      setBusy(false);
      setError(errorMessage(failure, 'Could not stop watching this company. Please try again.'));
    }
  }

  return (
    <article className="card saved-card">
      <div>
        <h3>{item.name}</h3>
        <p className="job-meta muted">{item.domain}</p>
        <p className="watch-badges">
          <span className={`badge ${badge.tone ? `badge-${badge.tone}` : ''}`.trim()}>{badge.label}</span>
          {open ? <span className="badge">{open}</span> : null}
          {fresh ? <span className="badge badge-blue">{fresh}</span> : null}
        </p>
      </div>
      <div className="saved-actions">
        {careers ? (
          <a className="btn btn-ghost btn-sm" href={careers} target="_blank" rel="noopener noreferrer">
            <Icon name="external" />
            Careers page
          </a>
        ) : null}
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void remove()}>Stop watching</button>
      </div>
      {error ? <p className="alert alert-error" role="alert">{error}</p> : null}
    </article>
  );
}

export default function Watchlist() {
  usePageTitle('Watchlist');
  const { data, error, isLoading, mutate } = useSWR('/watchlist', loadWatchlist, { revalidateOnFocus: false });
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CompanyHit[] | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [adding, setAdding] = useState({ name: '', website: '', careers: '' });
  const [addError, setAddError] = useState('');
  const [addNote, setAddNote] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [watching, setWatching] = useState<Set<string>>(new Set());

  const list = data?.list ?? [];
  const max = data?.max ?? null;
  const full = isFull(list.length, max);
  const cap = data ? capLabel(list.length, max) : null;
  const watchedIds = new Set(list.map((entry) => entry.companyId));

  const setList = (next: (current: WatchedCompany[]) => WatchedCompany[]) =>
    void mutate((current) => (current ? { ...current, list: next(current.list) } : current), { revalidate: false });

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!isSearchable(query)) {
      setOptions(null);
      setSearchNote('Type at least two letters of the company name.');
      setShowResults(true);
      return;
    }
    try {
      const found = await searchCompanies(query);
      setOptions(found);
      setSearchNote(found.length === 0 ? `No company in our list matches "${query.trim()}".` : null);
    } catch (failure) {
      setOptions(null);
      setSearchNote(errorMessage(failure, 'Could not search. Please try again.'));
    }
    setShowResults(true);
  }

  async function watch(option: CompanyHit) {
    setWatching((current) => new Set(current).add(option.id));
    try {
      const entry = await watchCompany(option.id);
      setList((current) => [entry, ...current.filter((w) => w.companyId !== entry.companyId)]);
    } catch (failure) {
      setOptions(null);
      setSearchNote(errorMessage(failure, 'Could not add this company. Please try again.'));
    } finally {
      setWatching((current) => {
        const next = new Set(current);
        next.delete(option.id);
        return next;
      });
    }
  }

  /** Adds a company that is not in our list, by its website, and watches it. */
  async function add(event: FormEvent) {
    event.preventDefault();
    setAddError('');
    setAddNote('');
    const { body, error: problem } = addCompanyRequest({ name: adding.name, website: adding.website, careersUrl: adding.careers });
    if (problem || !body) {
      setAddError(problem ?? 'Add the company name and its website.');
      return;
    }
    setAddBusy(true);
    try {
      const entry = await addCompany(body);
      setList((current) => [entry, ...current.filter((w) => w.companyId !== entry.companyId)]);
      setAdding({ name: '', website: '', careers: '' });
      setAddNote(addedMessage(entry));
    } catch (failure) {
      setAddError(errorMessage(failure, 'Could not add this company. Please try again.'));
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        crumb="Jobs"
        title="Watchlist"
        actions={
          <Link className="btn btn-secondary" to={ROUTES.jobs}>
            <Icon name="search" />
            Find jobs
          </Link>
        }
      />
      <div className="content">
        <form className="card job-filters watch-search" role="search" onSubmit={search}>
          <label className="sr-only" htmlFor="company-query">Find a company to watch</label>
          <input className="input" id="company-query" type="search" placeholder="Find a company to watch, e.g. Groww" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="btn btn-primary" type="submit">
            <Icon name="search" />
            Search
          </button>
        </form>
        {cap ? <p className="muted" role="status">{cap}</p> : null}
        {showResults ? (
          <div className="card watch-results">
            <ul className="watch-options">
              {options?.map((option) => {
                const isWatched = option.watched || watchedIds.has(option.id);
                return (
                  <li className="watch-option" key={option.id}>
                    <div>
                      <p className="job-company">{option.name}</p>
                      <p className="job-meta muted">{option.domain}</p>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      disabled={isWatched || full || watching.has(option.id)}
                      title={!isWatched && full ? `You can watch up to ${max} companies` : undefined}
                      onClick={() => void watch(option)}
                    >
                      <Icon name={isWatched ? 'check' : 'plus'} />
                      {isWatched ? 'Watching' : 'Watch'}
                    </button>
                  </li>
                );
              })}
            </ul>
            {searchNote ? <p className="muted">{searchNote}</p> : null}
            <details className="watch-add">
              <summary>Can&apos;t find it? Add it by its website</summary>
              <form className="watch-add-form" noValidate onSubmit={add}>
                <div className="field">
                  <label htmlFor="add-name">Company name</label>
                  <input className="input" id="add-name" maxLength={255} autoComplete="organization" value={adding.name} onChange={(event) => setAdding({ ...adding, name: event.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="add-website">Website</label>
                  <input className="input" id="add-website" maxLength={512} placeholder="acme.com" inputMode="url" value={adding.website} onChange={(event) => setAdding({ ...adding, website: event.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="add-careers">Careers page link <span className="muted">(optional)</span></label>
                  <input className="input" id="add-careers" maxLength={1024} placeholder="https://jobs.lever.co/acme" inputMode="url" value={adding.careers} onChange={(event) => setAdding({ ...adding, careers: event.target.value })} />
                </div>
                <p className="muted">We look for its jobs on Lever, Greenhouse and Ashby. This takes a few seconds.</p>
                <div className="row">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={full || addBusy} title={full ? `You can watch up to ${max} companies` : undefined}>
                    {addBusy ? 'Looking for its jobs…' : 'Add and watch'}
                  </button>
                </div>
                {addError ? <p className="alert alert-error" role="alert">{addError}</p> : null}
                {addNote ? <p className="alert alert-success" role="status">{addNote}</p> : null}
              </form>
            </details>
          </div>
        ) : null}

        {isLoading ? <Skeleton rows={1} label="Loading your watchlist" /> : null}
        {error ? <LoadError title="Could not load your watchlist" message={errorMessage(error, 'Please check your connection and try again.')} onRetry={() => void mutate()} /> : null}
        {data && list.length === 0 ? (
          <EmptyCard icon="eye" title="You're not watching any companies yet">Search for a company above to follow it. Its new jobs show up here with a New badge.</EmptyCard>
        ) : null}
        {list.length > 0 ? (
          <div className="saved-items">
            {list.map((item) => (
              <WatchedCard key={item.companyId} item={item} onRemoved={(id) => setList((current) => current.filter((w) => w.companyId !== id))} />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
