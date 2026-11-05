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

export function addApplication(apps, { company, role, portal, externalId = null }, now, resumeVersion = null) {
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
    externalId: externalId ? String(externalId).trim().slice(0, 40) : null,
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
    make('app-2', 'Swiggy', 'AI Engineer Intern', 'LinkedIn', 'APPLIED', 9, 3),
    make('app-3', 'Flipkart', 'SDE II', 'Referral', 'APPLIED', 2, 3),
    make('app-4', 'Zerodha', 'DevOps Engineer', 'Naukri', 'INTERVIEW', 4, 2),
    make('app-5', 'Freshworks', 'Java Developer', 'Company site', 'REJECTED', 15, 1),
  ];
}

export function isApplicationList(value) {
  return Array.isArray(value) && value.every((a) => a && typeof a.id === 'string' && STATUSES.some((s) => s.value === a.status));
}
