// Lay AI on the phone (preview, sample data): the agent conversation the owner described. It
// answers "What's the status for AI engineer intern?" from the applications tracker, finds new
// roles only from sources Coverlay may read, prepares an application one click away (the user
// always presses Apply on the company's own page), tracks the portal's application id, and
// reminds once if a prepared application wasn't sent. Every paid step shows its price first.
// DOM-free: step() is the whole conversation, so tests/lay-assistant-rules.test.js runs it in Node.

import { DAY_MS, addApplication, dayLabel, moveTo } from './applications-rules.js';
import { actionById, formatRupees, rupeesFor, spend } from './wallet-rules.js';

export const REMIND_AFTER_DAYS = 3;

export const OPENERS = [
  'Every application teaches you something. Two more this week puts you ahead of most people.',
  "Today's top story in your field (sample): Bengaluru startups posted more AI and backend internships this month than last.",
];

/** Roles found on sources Coverlay may read: company job boards and job APIs. Sample data. */
export const SAMPLE_FINDS = [
  { id: 'find-1', title: 'AI Engineer Intern', company: 'Zerodha', match: 82, source: 'Company careers page', applyUrl: 'https://example.com/apply/zerodha-ai-intern' },
  { id: 'find-2', title: 'ML Engineer Intern', company: 'Razorpay', match: 76, source: 'Greenhouse job board', applyUrl: 'https://example.com/apply/razorpay-ml-intern' },
  { id: 'find-3', title: 'Applied AI Intern', company: 'Freshworks', match: 71, source: 'Lever job board', applyUrl: 'https://example.com/apply/freshworks-ai-intern' },
];

const PREPARE_ACTIONS = ['tailor', 'cover_letter'];

export function freshConversation() {
  return { stage: 'idle', lastRole: null, chosen: null, preparedAt: null, appliedAt: null, reminded: false, externalId: null };
}

/** What a typed message asks for. Order matters: "I applied" is not "apply for". */
export function intentOf(text) {
  const t = String(text ?? '').toLowerCase();
  if (/\bi(?:'ve| have)? (?:just )?applied\b|\bdone applying\b|\bsubmitted\b/.test(t)) {
    return 'applied';
  }
  if (/\bstatus\b|\bheard back\b|\bany update\b|\bwhat happened\b/.test(t)) {
    return 'status';
  }
  if (/\b(?:yes|go ahead|do it|sure|okay|ok)\b/.test(t)) {
    return 'confirm';
  }
  if (/\b(?:not now|later|remind me|no thanks|skip)\b/.test(t)) {
    return 'later';
  }
  if (/\b(?:prepare|tailor|get (?:it|me) ready|apply for)\b/.test(t)) {
    return 'prepare';
  }
  if (/\b(?:find|search|look for|new ones?|more jobs|other jobs|jobs for me)\b/.test(t)) {
    return 'find';
  }
  if (/\b(?:motivat|top stor|news|cheer)\b/.test(t)) {
    return 'opener';
  }
  return 'help';
}

/** The tracked application a question is about: the best word match, else the latest applied. */
export function findApplication(apps, text) {
  const words = String(text ?? '').toLowerCase().match(/[a-z]{2,}/g) ?? [];
  const score = (app) => words.filter((w) => `${app.role} ${app.company}`.toLowerCase().includes(w)).length;
  const ranked = [...apps].map((app) => ({ app, s: score(app) })).sort((a, b) => b.s - a.s || b.app.updatedAt - a.app.updatedAt);
  if (ranked.length && ranked[0].s >= 2) {
    return ranked[0].app;
  }
  return apps.filter((a) => a.status === 'APPLIED').sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

/** The answer to "what's the status", in Lay AI's voice (the owner's own example for pending). */
export function statusReply(app, now) {
  if (!app) {
    return "You haven't tracked any applications yet. Want me to find some roles for you?";
  }
  const where = `${app.role} at ${app.company}`;
  switch (app.status) {
    case 'APPLIED':
      return `Boss, your application is still pending. Want me to find a new one? (${where}, applied ${dayLabel(app.appliedAt, now)}.)`;
    case 'INTERVIEW':
      return `Good news: ${where} is at the interview stage. Want help preparing?`;
    case 'OFFER':
      return `${where} made you an offer. Congratulations.`;
    case 'REJECTED':
      return `${where} said no this time. Want me to find similar roles?`;
    default:
      return `${where} is still being prepared. Want me to finish it?`;
  }
}

/** Links for sites Lay AI may not search itself; the user opens them. */
export function portalLinks(role) {
  const q = encodeURIComponent(role || 'internship');
  return [
    { label: 'LinkedIn Jobs', url: `https://www.linkedin.com/jobs/search/?keywords=${q}` },
    { label: 'Naukri', url: `https://www.naukri.com/${q.replace(/%20/g, '-').toLowerCase()}-jobs` },
  ];
}

/** What preparing an application costs: a tailored resume and a cover letter. */
export function prepareCost() {
  const credits = PREPARE_ACTIONS.reduce((sum, id) => sum + actionById(id).credits, 0);
  return { credits, rupees: rupeesFor(credits) };
}

/** The reminder Lay AI may send once: prepared, not applied, and three days have passed. */
export function reminderDue(conv, now) {
  if (conv.stage !== 'prepared' || conv.appliedAt || conv.reminded || !conv.preparedAt) {
    return null;
  }
  if (now - conv.preparedAt < REMIND_AFTER_DAYS * DAY_MS) {
    return null;
  }
  return `You prepared the ${conv.chosen.company} application ${REMIND_AFTER_DAYS} days ago. Want to finish it? It's one click away.`;
}

/** A sample application id, as the portal's confirmation page or email would show it. */
export function sampleApplicationId(job) {
  let n = 0;
  for (const ch of job.id) {
    n = (n * 31 + ch.charCodeAt(0)) % 90000;
  }
  return `APP-${10000 + n}`;
}

const say = (text, extra = {}) => ({ from: 'lay', text, ...extra });

/**
 * One turn of the conversation. `input` is `{ text }` (typed) or `{ intent, jobId? }` (a chip).
 * `ctx` is `{ apps, wallet, now }`. Returns the next conversation state, the replies, and the
 * applications and wallet after the turn (changed only by "prepare" and "applied").
 */
export function step(conv, input, ctx) {
  const intent = input.intent ?? intentOf(input.text);
  const next = { ...conv };
  let { apps, wallet } = ctx;
  const replies = [];

  if (intent === 'status') {
    const app = findApplication(apps, input.text ?? 'AI engineer intern');
    next.lastRole = app?.role ?? null;
    next.stage = 'idle';
    replies.push(say(statusReply(app, ctx.now)));
  } else if (intent === 'find') {
    next.stage = 'found';
    replies.push(say('Here are three roles from job boards Coverlay can read. LinkedIn and Naukri don\'t allow automated search, so I\'ve added their links for you to look yourself.', {
      kind: 'jobs', jobs: SAMPLE_FINDS, links: portalLinks(next.lastRole ?? 'AI engineer intern'),
    }));
  } else if (intent === 'prepare') {
    const job = SAMPLE_FINDS.find((j) => j.id === input.jobId) ?? (next.stage === 'found' ? SAMPLE_FINDS[0] : null);
    if (!job) {
      replies.push(say('Which role should I prepare? Ask me to find some first.'));
    } else {
      const cost = prepareCost();
      next.chosen = job;
      next.stage = 'quote';
      replies.push(say(`Preparing ${job.title} at ${job.company} takes ${cost.credits} credits (${formatRupees(cost.rupees)}): a tailored resume and a cover letter. Go ahead?`, { kind: 'quote' }));
    }
  } else if (intent === 'confirm' && next.stage === 'quote') {
    const cost = prepareCost();
    if (wallet.balance < cost.credits) {
      replies.push(say(`Your wallet has ${wallet.balance} credits and this needs ${cost.credits}. Recharge from ₹60 in Wallet, then ask me again.`, { kind: 'wallet' }));
    } else {
      for (const id of PREPARE_ACTIONS) {
        wallet = spend(wallet, id, ctx.now);
      }
      next.stage = 'prepared';
      next.preparedAt = ctx.now;
      next.appliedAt = null;
      next.reminded = false;
      apps = addApplication(apps, { company: next.chosen.company, role: next.chosen.title, portal: 'Company site' }, ctx.now, 4);
      replies.push(say(`Done. Your resume is tailored for ${next.chosen.title} (version 4) and a cover letter is drafted. Nothing invented: only what's in your resume.`, { kind: 'package', job: next.chosen }));
      replies.push(say(`It's one click away: open ${next.chosen.company}'s apply page, attach resume v4, paste the cover letter, and press Apply yourself. I never apply for you.`, { kind: 'ready', job: next.chosen }));
    }
  } else if (intent === 'applied') {
    if (next.stage !== 'prepared' || !next.chosen) {
      replies.push(say('Nice. Which application did you send? I track the ones I prepared with you, and you can add any other on the Applications board.'));
    } else {
      const externalId = input.externalId ?? sampleApplicationId(next.chosen);
      const app = apps.find((a) => a.company === next.chosen.company && a.role === next.chosen.title && a.status === 'PREPARING');
      if (app) {
        apps = moveTo(apps, app.id, 'APPLIED', ctx.now).map((a) => (a.id === app.id ? { ...a, externalId } : a));
      }
      next.stage = 'applied';
      next.appliedAt = ctx.now;
      next.externalId = externalId;
      replies.push(say(`Tracked: ${next.chosen.title} at ${next.chosen.company}, application id ${externalId}. If you haven't heard back in a week, I'll ask you once.`, { kind: 'tracked' }));
    }
  } else if (intent === 'later') {
    replies.push(say(next.stage === 'prepared'
      ? `Okay. If you haven't applied in ${REMIND_AFTER_DAYS} days, I'll remind you once.`
      : 'Okay. I\'m here when you need me.'));
    if (next.stage === 'quote') {
      next.stage = 'found';
    }
  } else if (intent === 'opener') {
    replies.push(say(OPENERS[0]));
  } else {
    replies.push(say('I can check an application ("What\'s the status for AI engineer intern?"), find new roles, prepare one so it\'s one click away, and remind you once.'));
  }
  return { conv: next, replies, apps, wallet };
}

/** The quick replies that fit where the conversation is. */
export function chipsFor(conv) {
  switch (conv.stage) {
    case 'found':
      return [{ label: 'Prepare the first one', intent: 'prepare', jobId: SAMPLE_FINDS[0].id }, { label: 'Not now', intent: 'later' }];
    case 'quote':
      return [{ label: 'Yes, prepare it', intent: 'confirm' }, { label: 'Not now', intent: 'later' }];
    case 'prepared':
      return [{ label: 'I applied', intent: 'applied' }, { label: 'Remind me later', intent: 'later' }];
    default:
      return [
        { label: "What's the status for AI engineer intern?", intent: 'status' },
        { label: 'Find new ones', intent: 'find' },
        { label: 'Motivate me', intent: 'opener' },
      ];
  }
}
