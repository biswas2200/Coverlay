// Settings & privacy (preview, sample data): consent defaults by region, and the
// delete-account job. Deleting is a durable job of steps -- each step is safe to repeat and is
// retried until it succeeds -- so the screen says "Deleting…" until every step is done and
// "Deleted" only after. Then the email is free for a new account at once (no ghost user),
// and only a tombstone remains: the analytics id, the date and the reason.
// DOM-free so tests/settings-rules.test.js can run it in Node.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const UNDO_DAYS = 14;

/** "EU/UK" for a European time zone, else "Other" (the preview's stand-in for the country). */
export function regionFromTimeZone(timeZone) {
  return /^Europe\//.test(String(timeZone ?? '')) ? 'EU/UK' : 'Other';
}

/** Analytics and AI learning are opt-in in the EU and UK, on by default elsewhere; switches for all. */
export function defaultConsents(region) {
  const optIn = region === 'EU/UK';
  return { analytics: !optIn, learning: !optIn, reminders: true };
}

export const CONSENTS = [
  { key: 'analytics', label: 'Usage analytics', hint: 'Which features you use, under a random id that is never linked to your name or email.' },
  { key: 'learning', label: 'Help Coverlay learn', hint: 'Your choices and resume features (skills, roles, outcomes) improve suggestions. Never your name, email, phone or links.' },
  { key: 'reminders', label: 'Email reminders', hint: 'One reminder per application, for example to follow up after a week.' },
];

export const EXPORT_CONTENTS = [
  'Your account details and consents',
  'Every resume you uploaded, and every Builder version',
  'Your Lay AI chats',
  'Your applications and reminders',
  'Your wallet history',
];

const STEPS = [
  { name: 'files', label: 'Uploaded resume files' },
  { name: 'search', label: 'Search index entries' },
  { name: 'account', label: 'Account rows: resumes, versions, chats, applications, wallet' },
];

/**
 * A new deletion job. `mode` "grace" waits 14 days (undo possible), "now" runs at once;
 * `deletePosts` adds a step the device signs (only it can prove which posts are yours).
 */
export function startDeletion({ mode, deletePosts }, now) {
  const steps = [...STEPS];
  if (deletePosts) {
    steps.splice(2, 0, { name: 'posts', label: 'Your community posts (signed by this device)' });
  }
  return {
    mode: mode === 'now' ? 'now' : 'grace',
    requestedAt: now,
    purgeAt: mode === 'now' ? now : now + UNDO_DAYS * DAY_MS,
    status: mode === 'now' ? 'running' : 'scheduled',
    steps: steps.map((step) => ({ ...step, state: 'pending', attempts: 0 })),
  };
}

export function canUndo(job, now) {
  return job?.status === 'scheduled' && now < job.purgeAt;
}

/** The scheduled job, started now (the preview's "skip the wait", or the purge job's run). */
export function beginPurge(job, now) {
  return job.status === 'scheduled' ? { ...job, status: 'running', purgeAt: now } : job;
}

/**
 * One tick of the worker: the next unfinished step runs. `failing` names steps that fail on
 * their first try (the preview makes "search" fail once to show the retry). A failed step is
 * retried on the next tick; the job is done only when every step is.
 */
export function advanceDeletion(job, { failing = [] } = {}) {
  if (job.status !== 'running') {
    return job;
  }
  const index = job.steps.findIndex((s) => s.state !== 'done');
  if (index === -1) {
    return { ...job, status: 'done' };
  }
  const steps = job.steps.map((step, i) => {
    if (i !== index) {
      return step;
    }
    const attempts = step.attempts + 1;
    const fails = failing.includes(step.name) && attempts === 1;
    return { ...step, attempts, state: fails ? 'retrying' : 'done' };
  });
  const done = steps.every((s) => s.state === 'done');
  return { ...job, steps, status: done ? 'done' : 'running' };
}

/** What the screen says about the job. Never "Deleted" before the last step is done. */
export function deletionStatusText(job, now) {
  if (!job) {
    return null;
  }
  if (job.status === 'scheduled') {
    const date = new Date(job.purgeAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Scheduled for ${date}. You're signed out everywhere, and you can undo until then.`;
  }
  if (job.status === 'running') {
    const done = job.steps.filter((s) => s.state === 'done').length;
    const retrying = job.steps.find((s) => s.state === 'retrying');
    return `Deleting… ${done} of ${job.steps.length} steps done${retrying ? `. Retrying: ${retrying.label.toLowerCase()}` : ''}.`;
  }
  return 'Deleted. Your email is free: signing up again starts a brand-new account.';
}

/** The one row that remains: no email, no name, no account id. */
export function tombstone(job, subjectId) {
  return job?.status === 'done' ? { subject_id: subjectId, deleted_at: new Date(job.purgeAt).toISOString().slice(0, 10), reason: 'USER_REQUEST' } : null;
}
