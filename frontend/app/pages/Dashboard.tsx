import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import useSWR from 'swr';
import { getFeedbackFor, submitFeedback } from '@/api/feedback';
import { getInDemand } from '@/api/jobs';
import { getDashboard } from '@/api/recommendation';
import { matchJobDescription, reanalyze } from '@/api/resume';
import type { DashboardResponse, InDemandRole, Recommendation } from '@/api/types';
import { Chips } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { EmptyCard, LoadError } from '@/components/Status';
import { VersionMenu } from '@/components/VersionMenu';
import { errorMessage } from '@/lib/errors';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { useUser } from '@/lib/session';
import { readJson, writeJson } from '@/lib/storage';
import {
  JD_MAX_CHARS,
  asPercent,
  canMatchJd,
  canUnlock,
  confidencePercent,
  demandChipLabel,
  demandFor,
  demandHeading,
  isBudgetExhausted,
  isLlmExplanation,
  isLocked,
} from '@legacy/pages/dashboard-rules.js';
import { atsChange, checkSummary, describeChange, describeCheck, findNewMatches, formatScore, jdVerdict, nextSteps, paragraphs, scoreBand, scorePercent } from '@legacy/pages/insights.js';

// The dashboard for the latest resume version, in three tabs driven by the address hash:
// - #overview: ATS score and band, detected field, best match, every ATS check with how to fix it, the suggestions
//   (written by AI) and the next steps.
// - #matches: ranked role matches with the skills the person has and the ones to add, plus helpful/not-helpful feedback.
//   When the AI engine could not run for this analysis, a locked card whose wording follows `lockReason` shows instead.
// - #jd: the job-description match.
// Lock decisions live in dashboard-rules.js, the wording in insights.js.

const TABS = ['overview', 'matches', 'jd'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: 'Dashboard', matches: 'Role matches', jd: 'JD match' };
const BADGE_FOR_TONE: Record<string, string> = { good: 'badge-green', ok: 'badge-blue', warn: 'badge-amber', bad: 'badge-red' };

function Overview({ data, change }: { data: DashboardResponse; change: number | null }) {
  const ats = data.atsScore;
  const band = scoreBand(ats.score, ats.max_score);
  const locked = isLocked(data);
  const best = locked ? null : data.recommendations[0];
  const summary = checkSummary(ats.checks);
  const llm = isLlmExplanation(data);
  const parts: string[] = paragraphs(data.explanation);

  // Failed checks first, the costliest at the top.
  const rows = ats.checks
    .map((check) => ({ check, view: describeCheck(check) }))
    .sort((a, b) => rank(a.view) - rank(b.view));

  return (
    <section className="content" style={{ padding: 0 }} aria-label="Overview">
      <div className="stats">
        <article className="card stat">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="section-label">ATS score</p>
            <span className={`badge ${BADGE_FOR_TONE[band.tone]}`}>{band.label}</span>
          </div>
          <p className="stat-big"><b>{formatScore(ats.score)}</b><span className="muted mono">/{formatScore(ats.max_score)}</span></p>
          <div className={`bar tone-${band.tone}`}><span style={{ width: `${scorePercent(ats.score, ats.max_score)}%` }} /></div>
          {change !== null ? <p className="muted">{describeChange(change)}</p> : null}
        </article>

        {data.domain ? (
          <article className="card stat">
            <p className="section-label">Field</p>
            <p className="stat-title">{data.domain.name}</p>
            <div className="row"><span className="badge badge-blue">{confidencePercent(data.domain)}% sure</span></div>
            <p className="muted">{locked ? 'The AI engine was not available, so only the basics were read.' : 'Read in full by the AI engine.'}</p>
          </article>
        ) : null}

        <article className="card stat">
          <p className="section-label">Best role match</p>
          {best ? (
            <div>
              <p className="stat-title">{best.role.title}</p>
              <p className="stat-big" style={{ marginTop: 8 }}><b>{asPercent(best.matchScore)}</b><span className="muted mono">% match</span></p>
            </div>
          ) : (
            <p className="muted">{locked ? 'Locked for this field. See Role matches.' : 'No matches yet.'}</p>
          )}
          <Link to="#matches" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start', paddingLeft: 0 }}>See all matches <Icon name="arrow" /></Link>
        </article>
      </div>

      <div className="grid-main">
        <article className="card">
          <div className="card-head">
            <h2>ATS checks</h2>
            <span className="muted">
              {summary.toGain > 0 ? `${summary.passed} of ${summary.total} passed · up to ${formatScore(summary.toGain)} points to gain` : `${summary.passed} of ${summary.total} passed`}
            </span>
          </div>
          <ul className="check-list">
            {rows.map(({ check, view }) => (
              <li className={`check ${view.status}`} key={check.name}>
                <span className="check-icon"><Icon name={view.status === 'pass' ? 'check' : view.status === 'partial' ? 'minus' : 'x'} /></span>
                <div className="check-body">
                  <p className="check-title">
                    <span>{view.label}</span>
                    <span className="mono muted">{view.weight === null ? '' : `${formatScore(view.earned)} / ${view.weight} pts`}</span>
                  </p>
                  <p className="muted">{check.detail}</p>
                  {view.fix ? <p className="check-fix">{view.fix}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>Suggestions</h2>
            <span className={`badge ${llm ? 'badge-violet' : ''}`.trim()}>{llm ? 'Written by AI' : 'Standard'}</span>
          </div>
          <div className="prose">
            {(parts.length > 0 ? parts : ['No suggestions for this version.']).map((text, index) => <p className="preserve-lines" key={index}>{text}</p>)}
          </div>
          <div className="next-steps">
            <h3>Next steps</h3>
            <ol>{nextSteps(data).map((step: string) => <li key={step}><span>{step}</span></li>)}</ol>
          </div>
        </article>
      </div>
    </section>
  );
}

function rank(view: { status: string; weight: number | null; earned: number | null }): number {
  const order = { fail: 0, partial: 1, pass: 2 }[view.status as 'fail' | 'partial' | 'pass'];
  return order * 1000 - ((view.weight ?? 0) - (view.earned ?? 0));
}

function MatchCard({ item, isNew, inDemand }: { item: Recommendation; isNew: boolean; inDemand: { roles: InDemandRole[] } | undefined }) {
  const percent = asPercent(item.matchScore);
  // The answer already given, if any (204 -> null -> nothing selected).
  const { data: existing } = useSWR(['feedback', item.recommendationId], () => getFeedbackFor(item.recommendationId), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const chosen = helpful ?? existing?.helpful ?? null;
  const demand = demandFor(inDemand, item.role.title) as InDemandRole | null;

  async function rate(value: boolean) {
    try {
      setHelpful((await submitFeedback(item.recommendationId, value)).helpful);
    } catch (error) {
      console.error('Could not save feedback', error);
    }
  }

  return (
    <article className="card match-card">
      <div className="match-head">
        <div>
          <h3>{item.role.title}</h3>
          <p className="muted">{item.role.description}</p>
        </div>
        <div className="match-score">
          <span className="match-pct">{percent}%</span>
          {isNew ? <span className="badge badge-green">New</span> : null}
        </div>
      </div>
      <div className="bar"><span style={{ width: `${percent}%` }} /></div>
      <div className="match-skills">
        {item.matchedSkills.length > 0 ? <div><p className="section-label">You have</p><Chips items={item.matchedSkills} tone="green" /></div> : null}
        {item.missingSkills.length > 0 ? <div><p className="section-label">Skills to add</p><Chips items={item.missingSkills} tone="amber" /></div> : null}
      </div>
      {demand ? (
        <div className="in-demand">
          <p className="section-label">{demandHeading(demand.jobCount)}</p>
          <ul className="chips chips-demand">
            {demand.skills.map((skill) => <li key={skill.skill} className={skill.have ? 'have' : undefined}>{demandChipLabel(skill)}</li>)}
          </ul>
          <p className="muted demand-note">Green: on your resume. Share of the role&apos;s open jobs that ask for it.</p>
        </div>
      ) : null}
      <div className="match-foot">
        <span className="muted">Is this match useful?</span>
        <div className="vote" role="group" aria-label={`Is the ${item.role.title} match useful?`}>
          <button className="btn btn-ghost btn-sm" type="button" aria-pressed={chosen === true} onClick={() => void rate(true)}><Icon name="up" />Helpful</button>
          <button className="btn btn-ghost btn-sm" type="button" aria-pressed={chosen === false} onClick={() => void rate(false)}><Icon name="down" />Not helpful</button>
        </div>
      </div>
    </article>
  );
}

function Matches({ data, fresh, onReanalysed }: { data: DashboardResponse; fresh: Set<string>; onReanalysed: () => Promise<unknown> }) {
  // What open jobs for each role ask for: an optional extra, so on failure the cards simply stay without it.
  const { data: inDemand } = useSWR(isLocked(data) ? null : 'in-demand', getInDemand, { revalidateOnFocus: false, shouldRetryOnError: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = isLocked(data);
  const budget = isBudgetExhausted(data);
  const domainName = data.domain?.name ?? 'this field';

  async function reanalyse() {
    if (!data.resumeId) {
      return;
    }
    setError('');
    setBusy(true);
    try {
      await reanalyze(data.resumeId);
      await onReanalysed();
    } catch (failure) {
      console.error('Re-analysis failed', failure);
      setError('Could not re-analyse your resume right now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <section aria-label="Role matches">
        <article className="card locked">
          <span className="lock-icon"><Icon name="lock" /></span>
          <h2>Role matches for <span>{domainName}</span> are locked</h2>
          {budget ? (
            <p>AI analyses for <span>{domainName}</span> are paused until tomorrow: the AI engine reached today&apos;s limit.</p>
          ) : (
            <p>Role matches and skill gaps come from the AI engine, which was not available when this resume was analysed. Your ATS score and the basics of your profile are already here.</p>
          )}
          {canUnlock(data) ? (
            <div>
              <p style={{ marginBottom: 10 }}>Re-run the analysis to get your role matches once the AI engine is back.</p>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void reanalyse()}>
                <Icon name="refresh" />
                {busy ? 'Re-analysing…' : 'Re-analyse'}
              </button>
            </div>
          ) : null}
          {error ? <p className="alert alert-error" role="alert">{error}</p> : null}
        </article>
      </section>
    );
  }

  return (
    <section aria-label="Role matches">
      <p className="muted" style={{ marginBottom: 16 }}>Ranked by how well your skills fit each role. Rate a match to improve future suggestions.</p>
      <div className="match-list">
        {data.recommendations.map((item) => <MatchCard key={item.recommendationId} item={item} isNew={fresh.has(item.recommendationId)} inDemand={inDemand} />)}
      </div>
      {data.recommendations.length === 0 ? (
        <EmptyCard icon="target" title="No role matches yet">Add your tools and technologies under a &quot;Skills&quot; heading and upload again.</EmptyCard>
      ) : null}
    </section>
  );
}

function JdMatch({ data }: { data: DashboardResponse }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof matchJobDescription>> | null>(null);

  if (!canMatchJd(data)) {
    return <section aria-label="Job description match" />;
  }

  async function match(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) {
      return;
    }
    setError('');
    setBusy(true);
    try {
      setResult(await matchJobDescription(data.resumeId, body));
    } catch (failure) {
      setError(errorMessage(failure, 'Could not match your resume to that job description right now.'));
    } finally {
      setBusy(false);
    }
  }

  const percent = result ? asPercent(result.score) : 0;
  const verdict = result ? jdVerdict(result.score) : null;

  return (
    <section aria-label="Job description match">
      <div className="grid-jd">
        <form className="card jd-form" onSubmit={match}>
          <div className="card-head" style={{ marginBottom: 0 }}><h2>Match a job description</h2></div>
          <label htmlFor="jd-text" className="muted">Paste the full job ad: title, responsibilities and requirements.</label>
          <textarea id="jd-text" className="input" rows={14} placeholder="Senior Data Analyst…" maxLength={JD_MAX_CHARS} disabled={busy} value={text} onChange={(event) => setText(event.target.value)} />
          <div className="jd-actions">
            <span className="mono muted">{`${text.length.toLocaleString()} / ${JD_MAX_CHARS.toLocaleString()} characters`}</span>
            <button className="btn btn-primary" type="submit" disabled={busy || text.trim() === ''}>{busy ? 'Matching…' : 'Match my resume'}</button>
          </div>
          {error ? <p className="alert alert-error" role="alert">{error}</p> : null}
        </form>

        <article className="card" aria-live="polite">
          {result && verdict ? (
            <div className="jd-result">
              <div className="jd-top">
                <div className={`ring tone-${verdict.tone}`} style={{ '--p': String(percent) } as CSSProperties}><b>{percent}%</b></div>
                <div>
                  <span className={`badge ${BADGE_FOR_TONE[verdict.tone]}`}>{verdict.label}</span>
                  <p className="muted" style={{ marginTop: 8 }}>How well your resume fits this job.</p>
                </div>
              </div>
              <dl className="kv">
                <div><dt># Coverage</dt><dd>{asPercent(result.coverage)}% of the skills it asks for</dd></div>
                <div><dt># Similarity</dt><dd>{asPercent(result.similarity)}%</dd></div>
                {result.closestRole ? <div><dt># Closest role</dt><dd>{result.closestRole.title}</dd></div> : null}
              </dl>
              {result.matchedSkills.length > 0 ? <div><p className="section-label">Skills you have</p><Chips items={result.matchedSkills} tone="green" /></div> : null}
              {result.missingSkills.length > 0 ? <div><p className="section-label">Skills to add</p><Chips items={result.missingSkills} tone="amber" /></div> : null}
              {result.explanation ? <div className="prose"><p className="preserve-lines">{result.explanation}</p></div> : null}
            </div>
          ) : (
            <div className="empty">
              <Icon name="briefcase" />
              <h3>No match yet</h3>
              <p>Your result appears here: coverage, matched and missing skills, and the closest role.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

export default function Dashboard() {
  usePageTitle('Your analysis');
  const user = useUser();
  const { hash } = useLocation();
  const wanted = hash.slice(1) as Tab;
  const tab: Tab = TABS.includes(wanted) ? wanted : 'overview';
  const { data, error, isLoading, mutate } = useSWR('dashboard', getDashboard, { revalidateOnFocus: false });
  const [change, setChange] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seenFor = useRef<string | null>(null);

  // What changed since this browser last looked: the score, and the roles it has not shown before. Each is remembered
  // once per analysis (the effect can run twice in development; the second run must not wipe the first's answer).
  useEffect(() => {
    if (!data || seenFor.current === data.resumeId) {
      return;
    }
    seenFor.current = data.resumeId;
    const scoreKey = `resumeAnalyser.lastAts.${user?.id}`;
    const { delta, record } = atsChange(readJson(scoreKey), data.resumeId, data.atsScore.score);
    writeJson(scoreKey, record);
    setChange(delta);
    if (!isLocked(data)) {
      const seenKey = `resumeAnalyser.seenRoles.${user?.id}`;
      const { fresh: found, remember } = findNewMatches(data.recommendations, readJson(seenKey));
      writeJson(seenKey, remember);
      setFresh(new Set<string>(found.map((r: Recommendation) => r.recommendationId)));
    }
  }, [data, user?.id]);

  const locked = data ? isLocked(data) : false;

  return (
    <>
      <PageHeader
        crumb={TAB_LABELS[tab]}
        title="Your analysis"
        actions={
          <>
            <VersionMenu label="Analysis of" currentId={data?.resumeId ?? null} />
            <Link className="btn btn-secondary" to={ROUTES.upload}>
              <Icon name="upload" />
              Upload new version
            </Link>
          </>
        }
      />
      <nav className="tabs" aria-label="Dashboard sections">
        <Link className="tab" to="#overview" aria-current={tab === 'overview' ? 'page' : undefined}>Overview</Link>
        <Link className="tab" to="#matches" aria-current={tab === 'matches' ? 'page' : undefined}>Role matches <span className="count">{data && !locked ? data.recommendations.length : ''}</span></Link>
        <Link className="tab" to="#jd" aria-current={tab === 'jd' ? 'page' : undefined}>JD match</Link>
      </nav>

      <div className="content">
        {isLoading ? (
          <div className="skeleton" aria-label="Loading your analysis">
            <div className="stats"><div className="card" /><div className="card" /><div className="card" /></div>
            <div className="card tall" />
          </div>
        ) : null}
        {error ? <LoadError title="Could not load your dashboard" message={errorMessage(error, 'Please check your connection and try again.')} onRetry={() => void mutate()} /> : null}
        {data === null ? (
          <EmptyCard icon="upload" title="No resume analysed yet" action={<Link className="btn btn-primary" to={ROUTES.upload}>Upload a resume</Link>}>
            Upload a PDF or DOCX and your score, checks and role matches appear here.
          </EmptyCard>
        ) : null}
        {data && tab === 'overview' ? <Overview data={data} change={change} /> : null}
        {data && tab === 'matches' ? <Matches data={data} fresh={fresh} onReanalysed={() => mutate()} /> : null}
        {data && tab === 'jd' ? <JdMatch data={data} /> : null}
      </div>
    </>
  );
}
