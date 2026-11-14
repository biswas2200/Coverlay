// "My activity": a person's own numbers, worked out from what is already theirs. Applications come from their
// board; job postings opened come from a small list this browser keeps; community posts, likes ("useful"), views
// and anonymous replies come from the community's device tally (community-rules.js). The community part is never
// sent to the server, because the server must not be able to tie a post, a like or a reply to an account
// (RB-COM-02, RB-COM-04): so it is only on the device that made it, and the page says so. Nothing here is ever
// shown to anyone else or to the admin console (RB-ADM-04).
// DOM-free so tests/activity-rules.test.js can run it in Node.

import { STATUSES } from './applications-rules.js';
import { voteCounts, withDefaults } from './community-rules.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
/** How many opened job postings are remembered (the oldest are dropped first). */
export const JOBS_OPENED_MAX = 200;
/** How long a reply excerpt or a post excerpt is on the activity page. */
export const EXCERPT = 90;
/** Saved-job statuses that mean the person applied (Not selected comes after applying). */
const SENT_SAVED = ['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED'];

export function activityKey(userId) {
  return `coverlay.preview.activity.${userId}`;
}

export function newJobActivity() {
  return { opened: [] };
}

export function isJobActivity(value) {
  return Boolean(value) && Array.isArray(value.opened);
}

/**
 * A job posting the person opened (Apply or View posting), newest first, each posting once (opening it again moves
 * it to the top with the new time). Only the id, title, company and time are kept.
 */
export function recordJobOpen(activity, job, now) {
  if (!job || !job.id) {
    return activity;
  }
  const entry = { jobId: String(job.id), title: String(job.title ?? '').slice(0, 120), company: String(job.company ?? '').slice(0, 80), at: now };
  const rest = (activity?.opened ?? []).filter((item) => item.jobId !== entry.jobId);
  return { opened: [entry, ...rest].slice(0, JOBS_OPENED_MAX) };
}

export function excerpt(text, max = EXCERPT) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * Everything the activity page shows, from the person's own data:
 * - `applications`: total on the board, how many were sent (have reached Applied at some point), the count per
 *   column, and how many were sent in the last 30 days.
 * - `jobs`: postings opened in all and in the last 7 days, the latest five, and from the saved jobs (the server's
 *   list, or null while unknown) how many are saved and how many of those are marked applied or further.
 * - `community`: posts, points waiting, posts viewed, upvotes and downvotes given, and comments, with what was upvoted
 *   (posts and comments) and the person's own comments (newest first, with the post or comment each answers) listed
 *   as excerpts. Posts or replies no longer in the feed are skipped from the lists but still
 *   counted, because the device still knows it made them.
 *
 * @param {{ apps?: any[], jobActivity?: any, saved?: any[] | null, community?: any }} input
 * @param {number} now
 */
export function activitySummary({ apps = [], jobActivity = null, saved = null, community = null }, now) {
  const sent = apps.filter((app) => app.appliedAt != null || ['APPLIED', 'INTERVIEW', 'OFFER'].includes(app.status));
  const byStatus = STATUSES.map((s) => ({ value: s.value, label: s.label, count: apps.filter((app) => app.status === s.value).length }));
  const opened = jobActivity?.opened ?? [];
  const device = withDefaults(community?.device);
  const feed = Array.isArray(community?.feed) ? community.feed : [];
  const postsById = new Map(feed.map((post) => [post.id, post]));

  // Everything this device upvoted, posts and comments, as `{ id, kind, postId, topic, company, text, upvotes, downvotes }`.
  const voted = Object.entries(device.votes);
  const upvoted = voted.flatMap(([id, value]) => {
    if (value !== 1) {
      return [];
    }
    if (postsById.has(id)) {
      const post = postsById.get(id);
      return [{ id, kind: 'post', postId: id, topic: post.topic, company: post.company ?? null, text: excerpt(post.text), upvotes: voteCounts(post).up, downvotes: voteCounts(post).down }];
    }
    for (const post of feed) {
      const reply = post.replies?.find((r) => r.id === id);
      if (reply) {
        return [{ id, kind: 'comment', postId: post.id, topic: post.topic, company: post.company ?? null, text: excerpt(reply.text), upvotes: voteCounts(reply).up, downvotes: voteCounts(reply).down }];
      }
    }
    return [];
  });

  const replies = device.replies.flatMap(({ id, postId }) => {
    const post = postsById.get(postId);
    const reply = post?.replies?.find((r) => r.id === id);
    const parent = reply?.parentId ? post.replies.find((r) => r.id === reply.parentId) : null;
    return reply
      ? [{ id, postId, text: excerpt(reply.text, 200), createdHour: reply.createdHour, onPost: excerpt(post.text, 70), onComment: parent ? excerpt(parent.text, 70) : null, topic: post.topic, upvotes: voteCounts(reply).up, downvotes: voteCounts(reply).down }]
      : [];
  });

  return {
    applications: {
      total: apps.length,
      sent: sent.length,
      sentLast30: sent.filter((app) => app.appliedAt != null && now - app.appliedAt <= 30 * DAY_MS).length,
      byStatus,
    },
    jobs: {
      opened: opened.length,
      openedLast7: opened.filter((item) => now - item.at <= 7 * DAY_MS).length,
      recent: opened.slice(0, 5),
      saved: Array.isArray(saved) ? saved.length : null,
      savedApplied: Array.isArray(saved) ? saved.filter((item) => SENT_SAVED.includes(item?.status)).length : null,
    },
    community: {
      posts: device.posts,
      points: device.points,
      viewed: device.viewed.length,
      upvotes: voted.filter(([, value]) => value === 1).length,
      downvotes: voted.filter(([, value]) => value === -1).length,
      replies: device.replies.length,
      upvoted,
      myReplies: replies,
    },
  };
}

/** How many "skills roles ask for" are shown. */
export const GAPS_MAX = 8;

function cleanList(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      out.push(text);
    }
  }
  return out;
}

/**
 * The person's skills and education for "My activity" (RB-ACT-05): from the latest uploaded resume as the system read it
 * (`parsed`, the `ParsedProfile` of `GET /resumes/{id}/profile`), or, when there is no upload yet or it has neither
 * skills nor education, from the Builder resume (`builder`). Skills are de-duplicated ignoring case and keep their
 * first spelling; education entries keep the degree, the institution and the year, and empty ones are dropped.
 * `source` says which was used: `'resume'` (with `version`), `'builder'`, or null when there is nothing.
 *
 * @param {{ parsed?: any, version?: number | null, builder?: any }} input
 */
export function profileSummary({ parsed = null, version = null, builder = null }) {
  const fromParsed = {
    skills: cleanList(parsed?.skills),
    education: (Array.isArray(parsed?.education) ? parsed.education : [])
      .map((e) => ({ degree: String(e?.degree ?? '').trim(), institution: String(e?.institution ?? '').trim(), year: String(e?.year ?? '').trim() }))
      .filter((e) => e.degree || e.institution || e.year),
  };
  if (fromParsed.skills.length || fromParsed.education.length) {
    return { source: 'resume', version, ...fromParsed, total: fromParsed.skills.length };
  }
  const fromBuilder = {
    skills: cleanList(builder?.skills),
    education: (Array.isArray(builder?.education) ? builder.education : [])
      .map((e) => ({ degree: String(e?.degree ?? '').replace(/<[^>]*>/g, '').trim(), institution: '', year: String(e?.dates ?? '').trim() }))
      .filter((e) => e.degree || e.year),
  };
  if (fromBuilder.skills.length || fromBuilder.education.length) {
    return { source: 'builder', version: null, ...fromBuilder, total: fromBuilder.skills.length };
  }
  return { source: null, version: null, skills: [], education: [], total: 0 };
}

/**
 * Skills the person's role matches ask for that they don't list yet: every role's `missingSkills`, counted across
 * roles, most-asked first (then A to Z), without the ones the person already has (ignoring case), at most GAPS_MAX.
 * Each is `{ skill, roles }`, where `roles` is how many matched roles ask for it.
 */
export function skillGaps(recommendations, skills) {
  const have = new Set(cleanList(skills).map((s) => s.toLowerCase()));
  const counts = new Map();
  for (const rec of Array.isArray(recommendations) ? recommendations : []) {
    for (const skill of cleanList(rec?.missingSkills)) {
      const key = skill.toLowerCase();
      if (!have.has(key)) {
        const entry = counts.get(key) ?? { skill, roles: 0 };
        entry.roles += 1;
        counts.set(key, entry);
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.roles - a.roles || a.skill.localeCompare(b.skill)).slice(0, GAPS_MAX);
}
