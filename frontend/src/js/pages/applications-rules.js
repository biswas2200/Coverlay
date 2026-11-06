// The applications tracker (preview, sample data): where each application stands, the reminders
// it brings, and the "Did you hear back?" check-in whose answer feeds the outcome insights
// ("people with 1-3 yrs and these skills got interviews for this role"). The insight stores
// the outcome under the analytics id with the resume version's features -- never a name.
// DOM-free so tests/applications-rules.test.js can run it in Node.

export const DAY_MS = 24 * 60 * 60 * 1000;

export const STATUSES = [
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'INTERVIEW', label: 'Interview' },
  { value: 'OFFER', label: 'Offer' },
  { value: 'REJECTED', label: 'Rejected' },
];

export const PORTALS = ['Company site', 'LinkedIn', 'Naukri', 'Referral', 'Other'];

const CHECK_IN_AFTER_DAYS = 7;
const APPLY_REMINDER_DAYS = 3;

export function statusLabel(value) {
  return STATUSES.find((s) => s.value === value)?.label ?? value;
}

/** The one reminder an application carries in a status, or null. */
export function reminderFor(status, at) {
  switch (status) {
    case 'PREPARING':
      return { kind: 'apply', text: 'Send the application', dueAt: at + APPLY_REMINDER_DAYS * DAY_MS };
    case 'APPLIED':
      return { kind: 'follow_up', text: "Follow up if you haven't heard back", dueAt: at + CHECK_IN_AFTER_DAYS * DAY_MS };
    case 'INTERVIEW':
      return { kind: 'prepare', text: 'Prepare: read the job post again and your resume version', dueAt: at + DAY_MS };
    default:
      return null;
  }
}

/** Board columns in order, newest change first in each. */
export function boardColumns(apps) {
  return STATUSES.map((status) => ({
    ...status,
    items: apps.filter((a) => a.status === status.value).sort((a, b) => b.updatedAt - a.updatedAt),
  }));
}

/** The applications with one moved to `status` (a new array); unknown ids or statuses change nothing. */
export function moveTo(apps, id, status, now) {
  if (!STATUSES.some((s) => s.value === status)) {
    return apps;
  }
  return apps.map((app) => {
    if (app.id !== id || app.status === status) {
      return app;
    }
    return {
      ...app,
      status,
      updatedAt: now,
      appliedAt: status === 'APPLIED' && !app.appliedAt ? now : app.appliedAt,
      checkInAt: status === 'APPLIED' ? now + CHECK_IN_AFTER_DAYS * DAY_MS : null,
      reminder: reminderFor(status, now),
    };
  });
}

/** The next status along the board, or null at the end (Offer and Rejected are both ends). */
export function nextStatus(status) {
  return { PREPARING: 'APPLIED', APPLIED: 'INTERVIEW', INTERVIEW: 'OFFER' }[status] ?? null;
}

/** Whether to ask "Did you hear back?": applied, and the check-in date has come. */
export function needsCheckIn(app, now) {
  return app.status === 'APPLIED' && app.checkInAt !== null && app.checkInAt !== undefined && now >= app.checkInAt;
}

/** "Not yet": ask again in a week. */
export function snoozeCheckIn(apps, id, now) {
  return apps.map((app) => (app.id === id ? { ...app, checkInAt: now + CHECK_IN_AFTER_DAYS * DAY_MS } : app));
}

/** Reminders due within `withinDays`, soonest first: `[{ app, reminder, overdue }]`. */
export function dueReminders(apps, now, withinDays = 2) {
  return apps
    .filter((app) => app.reminder && app.reminder.dueAt <= now + withinDays * DAY_MS)
    .map((app) => ({ app, reminder: app.reminder, overdue: app.reminder.dueAt < now }))
    .sort((a, b) => a.reminder.dueAt - b.reminder.dueAt);
}

/** Why a new application can't be added, or null. */
export function validateApplication({ company, role, portal }) {
  if (!String(company ?? '').trim()) {
    return 'Add the company.';
  }
  if (!String(role ?? '').trim()) {
    return 'Add the role.';
  }
  if (!PORTALS.includes(portal)) {
    return 'Choose where you apply.';
  }
  return null;
}

export function addApplication(apps, { company, role, portal }, now, resumeVersion = null) {
  if (validateApplication({ company, role, portal })) {
    return apps;
  }
  const app = {
    id: `app-${now.toString(36)}-${apps.length + 1}`,
    company: company.trim().slice(0, 80),
    role: role.trim().slice(0, 80),
    portal,
    status: 'PREPARING',
    createdAt: now,
    updatedAt: now,
    appliedAt: null,
    checkInAt: null,
    resumeVersion,
    reminder: reminderFor('PREPARING', now),
  };
  return [app, ...apps];
}

/** "today", "yesterday", "in 3 days", "3 days ago". */
export function dayLabel(at, now) {
  const days = Math.round((at - now) / DAY_MS);
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return 'tomorrow';
  }
  if (days === -1) {
    return 'yesterday';
  }
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * What the outcome insight stores for an application: the analytics id, the role, the
 * experience band and the resume version's features -- never the company contact, a name or
 * an email. Shown on the card so the user can see it.
 */
export function outcomeRecord(app, { subjectId, experienceBand, skills }) {
  if (!['INTERVIEW', 'OFFER', 'REJECTED'].includes(app.status)) {
    return null;
  }
  return {
    subject_id: subjectId,
    role: app.role,
    experience_band: experienceBand,
    skills,
    resume_version: app.resumeVersion,
    outcome: app.status.toLowerCase(),
  };
}

export function sampleApplications(now) {
  const make = (id, company, role, portal, status, daysAgo, resumeVersion) => {
    const at = now - daysAgo * DAY_MS;
    return {
      id, company, role, portal, status, createdAt: at - DAY_MS, updatedAt: at,
      appliedAt: status === 'PREPARING' ? null : at,
      checkInAt: status === 'APPLIED' ? at + CHECK_IN_AFTER_DAYS * DAY_MS : null,
      resumeVersion, reminder: reminderFor(status, at),
    };
  };
  return [
    make('app-1', 'Razorpay', 'Platform Engineer', 'Company site', 'PREPARING', 1, 4),
    make('app-2', 'Swiggy', 'Backend Engineer', 'LinkedIn', 'APPLIED', 9, 3),
    make('app-3', 'Flipkart', 'SDE II', 'Referral', 'APPLIED', 2, 3),
    make('app-4', 'Zerodha', 'DevOps Engineer', 'Naukri', 'INTERVIEW', 4, 2),
    make('app-5', 'Freshworks', 'Java Developer', 'Company site', 'REJECTED', 15, 1),
  ];
}

export function isApplicationList(value) {
  return Array.isArray(value) && value.every((a) => a && typeof a.id === 'string' && STATUSES.some((s) => s.value === a.status));
}

// ---------- Lay AI on the board (preview: answers are worked out from the board, no AI call) ----------

const PLURAL = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// What a reminder asks of the person, as a phrase that fits inside one of Lay AI's sentences.
const TASK = {
  apply: 'send the application',
  follow_up: "follow up if you haven't heard back",
  prepare: 'get ready for the interview',
};
const taskOf = (reminder) => TASK[reminder.kind] ?? reminder.text.toLowerCase();

// Words that say what the person wants rather than which application they mean.
const NOISE = new Set([
  'the', 'for', 'and', 'what', 'whats', 'how', 'is', 'my', 'at', 'of', 'to', 'on', 'in', 'with', 'about', 'status', 'update',
  'application', 'applications', 'where', 'move', 'mark', 'set', 'put', 'job', 'role', 'position', 'got', 'get', 'offer',
  'offered', 'interview', 'applied', 'rejected', 'reject', 'preparing', 'from', 'by', 'me', 'please', 'show', 'tell', 'did',
  'do', 'have', 'has', 'been', 'was', 'are', 'it', 'now', 'next', 'follow', 'up', 'prepare', 'prep', 'into', 'column', 'board',
  'sent', 'submitted', 'received', 'and', 'any', 'news', 'back', 'heard', 'turned', 'down', 'selected', 'change', 'shift',
]);

const words = (text) => String(text ?? '').toLowerCase().match(/[a-z0-9+#.]{2,}/g)?.map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean) ?? [];

/**
 * The application a message is about, or null: the company's name counts most, then the words of
 * the role. "status of swiggy" and "the SDE II one" both find a card; "what's due" finds none.
 */
export function findApplication(apps, text) {
  const asked = words(text).filter((word) => !NOISE.has(word));
  if (!asked.length) {
    return null;
  }
  let best = null;
  let bestScore = 0;
  for (const app of apps) {
    const company = new Set(words(app.company));
    const role = new Set(words(app.role));
    const score = asked.reduce((sum, word) => sum + (company.has(word) ? 3 : 0) + (role.has(word) ? 1 : 0), 0);
    if (score > bestScore || (score === bestScore && score > 0 && app.updatedAt > best.updatedAt)) {
      best = app;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

/** The stage a message talks about ("to interview", "I got an offer", "rejected me"), or null. */
export function stageFromText(text) {
  const t = String(text ?? '').toLowerCase();
  if (/\boffer(?:ed|s)?\b|\bgot the job\b|\bselected\b/.test(t)) {
    return 'OFFER';
  }
  if (/\breject(?:ed|ion)?\b|\bturned me down\b|\bdidn'?t get\b/.test(t)) {
    return 'REJECTED';
  }
  if (/\binterview(?:s|ing)?\b/.test(t)) {
    return 'INTERVIEW';
  }
  if (/\bapplied\b|\bsent the application\b|\bsubmitted\b/.test(t)) {
    return 'APPLIED';
  }
  if (/\bpreparing\b|\bback to preparing\b/.test(t)) {
    return 'PREPARING';
  }
  return null;
}

/** "You have 5 applications: 1 preparing, 2 applied, …" and the one that needs the person most. */
export function boardSummary(apps, now) {
  if (!apps.length) {
    return 'Your board is empty. Use Add an application to start.';
  }
  const counts = boardColumns(apps).map((c) => `${c.items.length} ${c.label.toLowerCase()}`).join(', ');
  const [first] = dueReminders(apps, now, 2);
  const urgent = first
    ? ` The one that needs you most is ${first.app.role} at ${first.app.company} (${taskOf(first.reminder)}, ${first.overdue ? 'due ' : ''}${dayLabel(first.reminder.dueAt, now)}).`
    : ' Nothing is due in the next two days.';
  return `You have ${PLURAL(apps.length, 'application')}: ${counts}.${urgent}`;
}

function describe(app, now) {
  const since = app.appliedAt ? `you applied ${dayLabel(app.appliedAt, now)}` : `you added it ${dayLabel(app.createdAt, now)}`;
  const resume = app.resumeVersion ? ` with resume v${app.resumeVersion}` : '';
  const reminder = app.reminder
    ? ` Next: ${taskOf(app.reminder)}, ${app.reminder.dueAt < now ? 'due ' : ''}${dayLabel(app.reminder.dueAt, now)}.`
    : '';
  return `${app.role} at ${app.company} is in ${statusLabel(app.status)}: ${since} on ${app.portal}${resume}.${reminder}`;
}

/**
 * Lay AI's answer to a message on the Applications page, worked out from the board:
 * `{ reply, proposal, focus }`. `proposal` is a move the person can confirm (`{ id, status }`):
 * Lay AI never moves a card by itself. `focus` is the card the answer is about, so the page can
 * bring it into view. Replies are short and plain, like the Lay AI style guide asks.
 */
export function layApplicationsReply(text, apps, now) {
  const message = String(text ?? '').trim();
  const lower = message.toLowerCase();
  const app = findApplication(apps, message);
  const stage = stageFromText(message);

  const movesCard = /\b(?:move|mark|set|put|shift|change)\b/.test(lower)
    || /\b(?:got|received|have|had)\b.*\b(?:offer|interview)\b/.test(lower)
    || /\b(?:rejected me|turned me down|i applied|i have applied|i've applied|i submitted)\b/.test(lower);
  if (stage && movesCard) {
    if (!app) {
      return { reply: `Which application? Say the company, like "move Swiggy to ${statusLabel(stage)}".`, proposal: null, focus: null };
    }
    if (app.status === stage) {
      return { reply: `${app.role} at ${app.company} is already in ${statusLabel(stage)}.`, proposal: null, focus: app.id };
    }
    return {
      reply: `Move ${app.role} at ${app.company} from ${statusLabel(app.status)} to ${statusLabel(stage)}? I only move it when you say yes.`,
      proposal: { id: app.id, status: stage },
      focus: app.id,
    };
  }

  if (/\b(?:due|today|reminders?|what should i do|what next|what now|to do|todo)\b/.test(lower) && !app) {
    const due = dueReminders(apps, now, 2);
    if (!due.length) {
      return { reply: 'Nothing is due in the next two days.', proposal: null, focus: null };
    }
    const lines = due.slice(0, 3).map(({ app: a, reminder, overdue }) =>
      `${a.role} at ${a.company}: ${taskOf(reminder)} (${overdue ? 'due ' : ''}${dayLabel(reminder.dueAt, now)})`);
    return { reply: `${due.length === 1 ? 'One thing needs' : `${PLURAL(due.length, 'thing')} need`} you. ${lines.join('. ')}.`, proposal: null, focus: due[0].app.id };
  }

  if (/\b(?:follow ?up|hasn'?t replied|haven'?t heard|no reply|not replied|silent|waiting)\b/.test(lower) && !app) {
    const waiting = apps.filter((a) => a.status === 'APPLIED' && a.appliedAt && now - a.appliedAt >= CHECK_IN_AFTER_DAYS * DAY_MS)
      .sort((a, b) => a.appliedAt - b.appliedAt);
    if (!waiting.length) {
      return { reply: 'Every application you sent is less than a week old, so there is nothing to chase yet.', proposal: null, focus: null };
    }
    const names = waiting.map((a) => `${a.role} at ${a.company} (${dayLabel(a.appliedAt, now)})`);
    return { reply: `It has been a week or more with no news from ${names.join(' and ')}. A short, polite follow-up is the usual next step.`, proposal: null, focus: waiting[0].id };
  }

  if (/\b(?:summary|summari[sz]e|overview|how many|how am i doing|board)\b/.test(lower) && !app) {
    return { reply: boardSummary(apps, now), proposal: null, focus: null };
  }

  if (/\b(?:prepare|prep|ready for)\b/.test(lower) && app) {
    const reply = app.status === 'INTERVIEW'
      ? `For ${app.role} at ${app.company}: read the job post again, and open resume v${app.resumeVersion ?? '?'} so your answers match what it says.`
      : `${app.role} at ${app.company} is in ${statusLabel(app.status)}. Interview preparation starts when it moves to Interview.`;
    return { reply, proposal: null, focus: app.id };
  }

  if (app) {
    return { reply: describe(app, now), proposal: null, focus: app.id };
  }

  if (/\b(?:status|update|news|where|how is|how's|about|any word|heard from)\b/.test(lower)) {
    return { reply: `I can't find that on your board. Say the company, like "status of Swiggy", or use Add an application.`, proposal: null, focus: null };
  }
  return {
    reply: 'I can answer from your board: "What\'s due?", "Summarise my board", "Who hasn\'t replied?", "Status of Swiggy", "Prepare for Zerodha" or "Move Razorpay to Applied".',
    proposal: null,
    focus: null,
  };
}
