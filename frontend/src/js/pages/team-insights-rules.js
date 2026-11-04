// Team insights (preview, sample numbers): the admin dashboards for product, outcomes, money and
// health. Everything here is aggregate and anonymous: no names, no emails, no account ids.
// A group smaller than K_MIN people is never shown (k-anonymity), so no insight can point at
// one person. DOM-free so tests/team-insights-rules.test.js can run it in Node.

export const K_MIN = 20;

/** A share as a whole percent, or null for an empty base. */
export function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** A cell shown only when at least K_MIN people are behind it; otherwise null (shown as "–"). */
export function suppress(cell, k = K_MIN) {
  return cell && cell.people >= k ? cell : null;
}

/** 1,284 / 12.9K / 4.2M: compact figures for tiles and bar tips. */
export function compact(n) {
  const abs = Math.abs(n);
  if (abs >= 1e6) {
    return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (abs >= 1e4) {
    return `${(n / 1e3).toFixed(abs >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  }
  return new Intl.NumberFormat('en-IN').format(n);
}

/** "+12% vs Oct" with whether it is good: up is good unless `upIsGood` is false. */
export function delta(current, previous, { upIsGood = true, period = 'last month' } = {}) {
  if (!previous) {
    return null;
  }
  const change = Math.round(((current - previous) / previous) * 100);
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const good = direction === 'flat' ? null : (direction === 'up') === upIsGood;
  return { text: `${change > 0 ? '+' : ''}${change}% vs ${period}`, direction, good };
}

/** Each funnel step with its share of the first step and of the step before. */
export function funnelRates(steps) {
  const first = steps[0]?.count ?? 0;
  return steps.map((step, i) => ({
    ...step,
    ofFirst: pct(step.count, first),
    ofPrevious: i === 0 ? null : pct(step.count, steps[i - 1].count),
  }));
}

/** Rows as shares of their own total, largest first: `[{ label, value, share }]`. */
export function shareRows(rows) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return [...rows].sort((a, b) => b.value - a.value).map((row) => ({ ...row, share: pct(row.value, total) }));
}

export const SAMPLE = {
  month: 'November 2026',
  kpis: {
    activeUsers: { value: 1240, previous: 1010 },
    revenue: { value: 48200, previous: 39100 },
    aiCost: { value: 19900, previous: 17300 },
    costPerJourney: { value: 13.9, previous: 14.6 },
  },
  funnel: [
    { label: 'Signed up', count: 1240 },
    { label: 'Uploaded a resume', count: 980 },
    { label: 'Got an analysis', count: 910 },
    { label: 'Used the Builder', count: 520 },
    { label: 'Tracked an application', count: 310 },
    { label: 'Reported an interview', count: 84 },
  ],
  templates: {
    names: ['Clean', 'Modern', 'Classic', 'Compact'],
    byRole: [
      { role: 'Backend Developer', counts: [142, 98, 61, 30] },
      { role: 'DevOps Engineer', counts: [64, 71, 22, 9] },
      { role: 'Data Analyst', counts: [88, 40, 35, 41] },
      { role: 'Nurse', counts: [52, 18, 6, 27] },
    ],
  },
  prompts: [
    { label: 'Add skills', value: 3120 },
    { label: 'Shorten or rewrite the summary', value: 1870 },
    { label: 'Fit a role (suggest mode)', value: 1410 },
    { label: 'Cover letter', value: 980 },
    { label: 'Is this skill worth adding?', value: 760 },
  ],
  promptExample: 'Should I add the {user.college} hackathon to my summary?',
  outcomes: {
    roles: ['Backend Developer', 'DevOps Engineer', 'Data Analyst'],
    bands: ['Fresher', '1-3 yrs', '3+ yrs'],
    // [role][band]: interviews / applications, from people who answered "Did you hear back?"
    cells: [
      [{ interviews: 9, applications: 74, people: 41 }, { interviews: 31, applications: 152, people: 88 }, { interviews: 22, applications: 70, people: 37 }],
      [{ interviews: 2, applications: 19, people: 12 }, { interviews: 14, applications: 61, people: 33 }, { interviews: 11, applications: 30, people: 21 }],
      [{ interviews: 12, applications: 66, people: 39 }, { interviews: 10, applications: 41, people: 24 }, { interviews: 3, applications: 9, people: 6 }],
    ],
  },
  split: [
    { label: 'AI (Gemini)', value: 50 },
    { label: 'Servers & storage', value: 25 },
    { label: 'Buffer', value: 12.64 },
    { label: 'Your fee', value: 10 },
    { label: 'Payment gateway', value: 2.36 },
  ],
  aiByFeature: [
    { label: 'Lay AI chat', value: 9100 },
    { label: 'Cover letters', value: 4300 },
    { label: 'Tailored resumes', value: 3900 },
    { label: 'Cold emails', value: 1900 },
    { label: 'Resume analysis', value: 700 },
  ],
  spendByType: [
    { label: 'Student', value: 34 },
    { label: 'Fresher', value: 61 },
    { label: '1-3 yrs', value: 88 },
    { label: '3+ yrs', value: 72 },
  ],
  topSpendersShare: 31,
  health: [
    { label: 'Server errors (24 h)', value: '3', state: 'good', note: 'Under the alert line of 5 in 5 min' },
    { label: 'AI unavailable events (24 h)', value: '0', state: 'good', note: 'Alert fires on the first one' },
    { label: 'Deletion jobs stuck > 24 h', value: '0', state: 'good', note: 'Every step retried until done' },
    { label: 'AI jobs waiting in the queue', value: '3', state: 'warning', note: 'Normal under 50' },
    { label: 'Uptime (30 days)', value: '99.95%', state: 'good', note: 'Checked from outside Google' },
  ],
};

/** The outcome grid with every cell's interview rate, or null where too few people answered. */
export function outcomeGrid(outcomes = SAMPLE.outcomes) {
  return outcomes.roles.map((role, r) => ({
    role,
    cells: outcomes.bands.map((band, b) => {
      const cell = suppress(outcomes.cells[r][b]);
      return { band, rate: cell ? pct(cell.interviews, cell.applications) : null, people: outcomes.cells[r][b].people };
    }),
  }));
}
