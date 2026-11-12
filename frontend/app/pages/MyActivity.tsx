import { useMemo } from 'react';
import { Link } from 'react-router';
import useSWR from 'swr';
import { getSaved } from '@/api/jobs';
import { getDashboard } from '@/api/recommendation';
import { getParsedProfile } from '@/api/resume';
import { Chips } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { PageHeader, PreviewBadge } from '@/components/PageHeader';
import { builderResume } from '@/lib/builderStore';
import { useVersions } from '@/lib/data';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { useUser } from '@/lib/session';
import { readJson } from '@/lib/storage';
import { activityKey, activitySummary, isJobActivity, profileSummary, skillGaps } from '@legacy/pages/activity-rules.js';
import { dayLabel, isApplicationList } from '@legacy/pages/applications-rules.js';
import { TOPICS, migrateSaved, postAge } from '@legacy/pages/community-rules.js';

// "My activity": the signed-in person's own numbers (RB-ACT). Their skills and education (the latest uploaded resume, or
// the Builder resume when there is none) with the skills their role matches ask for, applications from their board, job postings they opened,
// their saved jobs, and their community activity (posts, posts viewed, up and down votes, anonymous comments). The
// community part is read from this device's private tally, because the server cannot know it (RB-COM-04). Nobody else
// sees this page, and none of it reaches the admin console (RB-ADM-04).

type Tile = { label: string; value: string; note: string };

const topicLabel = (id: string) => TOPICS.find((t: { id: string }) => t.id === id)?.label ?? '';

function Tiles({ label, tiles }: { label: string; tiles: Tile[] }) {
  return (
    <section className="insights-kpis" aria-label={label}>
      {tiles.map((tile) => (
        <article className="card insights-tile" key={tile.label}>
          <p className="insights-tile-label">{tile.label}</p>
          <p className="insights-tile-value">{tile.value}</p>
          <p className="field-hint">{tile.note}</p>
        </article>
      ))}
    </section>
  );
}

export default function MyActivity() {
  usePageTitle('My activity');
  const user = useUser();
  const userId = user?.id ?? 'guest';
  const { data: saved } = useSWR('/jobs/saved', getSaved, { revalidateOnFocus: false });
  // Skills and education: the latest upload as the system read it (versions are oldest first), and the role matches
  // (the same cached request as the dashboard) for the skills those roles ask for.
  const { data: versions } = useVersions();
  const latest = versions?.length ? versions[versions.length - 1] : null;
  const { data: parsed, isLoading: parsedLoading } = useSWR(latest ? ['profile', latest.id] : null, () => getParsedProfile(latest!.id), { revalidateOnFocus: false, shouldRetryOnError: false });
  const { data: dashboard } = useSWR('dashboard', getDashboard, { revalidateOnFocus: false, shouldRetryOnError: false });

  // Read once per visit: the board, the opened postings and the community tally are this browser's own records.
  const local = useMemo(() => {
    const apps = readJson(`coverlay.preview.applications.${userId}`);
    const jobs = readJson(activityKey(userId));
    return {
      apps: isApplicationList(apps) ? (apps as unknown[]) : [],
      jobActivity: isJobActivity(jobs) ? jobs : null,
      community: migrateSaved(readJson(`coverlay.preview.community.${userId}`)),
    };
  }, [userId]);

  const now = Date.now();
  const summary = activitySummary({ ...local, saved: saved ?? null }, now);
  const { applications, jobs, community } = summary;
  const profile = profileSummary({ parsed: parsed ?? null, version: latest?.version ?? null, builder: latest && parsedLoading ? null : builderResume(user?.id) });
  const gaps: { skill: string; roles: number }[] = skillGaps(dashboard?.recommendations ?? [], profile.skills);
  const sourceNote = profile.source === 'resume' ? `From your resume, version ${profile.version}` : profile.source === 'builder' ? 'From your Builder resume' : 'Nothing yet';
  const maxColumn = Math.max(...applications.byStatus.map((s: { count: number }) => s.count), 1);

  return (
    <>
      <PageHeader crumb="Account" title="My activity" actions={<PreviewBadge />} />
      <div className="content activity">
        <p className="alert alert-info" role="note">
          Only you can see this page. Your community activity is counted on this device alone: Coverlay never links a post, a vote or a comment to your account, so another browser or phone starts at zero.
        </p>

        <h2 className="insights-section">Skills and education</h2>
        <Tiles
          label="Skills and education"
          tiles={[
            { label: 'Total skills', value: String(profile.total), note: sourceNote },
            { label: 'Education', value: String(profile.education.length), note: profile.education[0] ? [profile.education[0].degree, profile.education[0].year].filter(Boolean).join(' · ') : 'Nothing listed yet' },
            { label: 'Skills to add', value: String(gaps.length), note: dashboard?.recommendations?.length ? 'Asked for by your role matches' : 'Upload a resume to see role matches' },
            { label: 'Role matches', value: String(dashboard?.recommendations?.length ?? 0), note: dashboard?.domain?.name ?? 'From your latest analysis' },
          ]}
        />
        <div className="activity-grid">
          <article className="card" aria-labelledby="skills-title">
            <div className="card-head">
              <h3 className="viz-title" id="skills-title">Your skills</h3>
              <Link className="btn btn-ghost btn-sm" to={profile.source === 'builder' ? ROUTES.builder : ROUTES.upload}>{profile.source === 'builder' ? 'Builder' : 'Resume'}</Link>
            </div>
            {profile.skills.length ? (
              <Chips items={profile.skills} tone="green" label="Your skills" />
            ) : (
              <p className="empty">No skills yet. Upload a resume, or add a Skills section in the Builder.</p>
            )}
            {gaps.length ? (
              <>
                <p className="section-label activity-sub">Skills your role matches ask for</p>
                <ul className="chips chips-amber" aria-label="Skills your role matches ask for">
                  {gaps.map((gap) => (
                    <li key={gap.skill} title={`Asked for by ${gap.roles} of your role matches`}>
                      {gap.skill}
                      {gap.roles > 1 ? <span className="mono activity-gap-count"> ×{gap.roles}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </article>
          <article className="card" aria-labelledby="education-title">
            <div className="card-head"><h3 className="viz-title" id="education-title">Education</h3></div>
            {profile.education.length ? (
              <ul className="activity-list">
                {profile.education.map((entry: { degree: string; institution: string; year: string }, index: number) => (
                  <li key={`${entry.degree}-${index}`}>
                    <span>
                      {entry.degree || entry.institution}
                      {entry.degree && entry.institution ? <span className="field-hint activity-on">{entry.institution}</span> : null}
                    </span>
                    {entry.year ? <span className="field-hint mono">{entry.year}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No education listed yet. Upload a resume, or add an Education section in the Builder.</p>
            )}
            <p className="field-hint">{sourceNote}.</p>
          </article>
        </div>

        <h2 className="insights-section">Applications and jobs</h2>
        <Tiles
          label="Applications and jobs"
          tiles={[
            { label: 'Applications sent', value: String(applications.sent), note: `${applications.total} on your board · ${applications.sentLast30} in the last 30 days` },
            { label: 'Job postings opened', value: String(jobs.opened), note: `${jobs.openedLast7} in the last 7 days` },
            { label: 'Saved jobs', value: jobs.saved === null ? '–' : String(jobs.saved), note: jobs.savedApplied === null ? 'Loading…' : `${jobs.savedApplied} marked applied or further` },
            { label: 'Interviews and offers', value: String(applications.byStatus.filter((s: { value: string }) => s.value === 'INTERVIEW' || s.value === 'OFFER').reduce((sum: number, s: { count: number }) => sum + s.count, 0)), note: 'On your board now' },
          ]}
        />
        <div className="activity-grid">
          <article className="card viz-card" aria-labelledby="board-title">
            <div className="card-head"><h3 className="viz-title" id="board-title">Your board</h3><Link className="btn btn-ghost btn-sm" to={ROUTES.applications}>Open</Link></div>
            <ul className="viz-bars">
              {applications.byStatus.map((s: { value: string; label: string; count: number }) => (
                <li key={s.value} className="viz-row" aria-label={`${s.label}: ${s.count}`}>
                  <span className="viz-label">{s.label}</span>
                  <span className="viz-track">
                    <span className="viz-bar" style={{ width: `${Math.max((s.count / maxColumn) * 100, 1.5).toFixed(1)}%` }} />
                    <span className="viz-value">{s.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          </article>
          <article className="card viz-card" aria-labelledby="opened-title">
            <div className="card-head"><h3 className="viz-title" id="opened-title">Postings you opened</h3><Link className="btn btn-ghost btn-sm" to={ROUTES.jobs}>Jobs</Link></div>
            {jobs.recent.length ? (
              <ul className="activity-list">
                {jobs.recent.map((item: { jobId: string; title: string; company: string; at: number }) => (
                  <li key={item.jobId}>
                    <span>{item.title || 'A job posting'}{item.company ? <span className="muted"> · {item.company}</span> : null}</span>
                    <span className="field-hint">{dayLabel(item.at, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">Nothing yet. Postings you open with Apply or View posting show here.</p>
            )}
          </article>
        </div>

        <h2 className="insights-section">Community <span className="badge">This device only</span></h2>
        <Tiles
          label="Community"
          tiles={[
            { label: 'Posts viewed', value: String(community.viewed), note: 'Each post counted once' },
            { label: 'Upvotes given', value: String(community.upvotes), note: `${community.downvotes} ${community.downvotes === 1 ? 'downvote' : 'downvotes'}` },
            { label: 'Anonymous comments', value: String(community.replies), note: 'Shown to others as "Anonymous"' },
            { label: 'Your posts', value: String(community.posts), note: `${community.points} points waiting` },
          ]}
        />
        <div className="activity-grid">
          <article className="card" aria-labelledby="replies-title">
            <div className="card-head"><h3 className="viz-title" id="replies-title">Your comments</h3><Link className="btn btn-ghost btn-sm" to={ROUTES.community}>Community</Link></div>
            {community.myReplies.length ? (
              <ul className="activity-list">
                {community.myReplies.map((reply: { id: string; text: string; createdHour: number; onPost: string; onComment: string | null; topic: string; upvotes: number; downvotes: number }) => (
                  <li key={reply.id}>
                    <span>
                      {reply.text}
                      <span className="field-hint activity-on">
                        {reply.onComment ? `Reply to “${reply.onComment}” on “${reply.onPost}”` : `On “${reply.onPost}”`} · {topicLabel(reply.topic)} · {postAge(reply.createdHour, now)}
                      </span>
                    </span>
                    <span className="field-hint mono activity-votes"><Icon name="vote-up" /> {reply.upvotes} <Icon name="vote-down" /> {reply.downvotes}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No comments yet. Comments and replies you write show here, and only here.</p>
            )}
          </article>
          <article className="card" aria-labelledby="liked-title">
            <div className="card-head"><h3 className="viz-title" id="liked-title">What you upvoted</h3></div>
            {community.upvoted.length ? (
              <ul className="activity-list">
                {community.upvoted.map((item: { id: string; kind: string; topic: string; company: string | null; text: string; upvotes: number; downvotes: number }) => (
                  <li key={item.id}>
                    <span>
                      {item.text}
                      <span className="field-hint activity-on">{[item.kind === 'comment' ? 'Comment' : 'Post', topicLabel(item.topic), item.company].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="field-hint mono activity-votes"><Icon name="vote-up" /> {item.upvotes} <Icon name="vote-down" /> {item.downvotes}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">Nothing upvoted yet. Use the up arrow on a post or a comment in the community.</p>
            )}
          </article>
        </div>
      </div>
    </>
  );
}
