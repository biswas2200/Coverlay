// The dashboard's decision logic, kept free of the DOM so tests/dashboard-rules.test.js can
// cover every lock-reason combination under Node. `dashboard` is the
// `GET /recommendations/dashboard` body (recommendation.dto.DashboardResponse).

/** Matches the backend's `JdMatchRequest` size cap. */
export const JD_MAX_CHARS = 20_000;

export function asPercent(score) {
  return Math.round(score * 100);
}

/**
 * Whether the explanation is the AI-written narrative rather than the deterministic template
 * (a locked result, or the fallback when the AI call failed) — an absent `explanationSource`
 * counts as template, matching the backend's own default.
 */
export function isLlmExplanation(dashboard) {
  return dashboard.explanationSource === 'llm';
}

/** Recommendations were withheld because the AI engine could not run for this analysis. */
export function isLocked(dashboard) {
  return dashboard.recommendationsLocked === true;
}

/** Locked because the operator's daily AI budget was spent (back tomorrow), not because the engine is off. */
export function isBudgetExhausted(dashboard) {
  return dashboard.lockReason === 'ai_budget_exhausted';
}

/** A locked result can always be re-analysed: it unlocks as soon as the AI engine is back. */
export function canUnlock(dashboard) {
  return isLocked(dashboard) && !!dashboard.resumeId;
}

export function confidencePercent(domain) {
  return Math.round(domain.confidence * 100);
}

/** The JD form needs an analysed resume; every account can use it. */
export function canMatchJd(dashboard) {
  return !!dashboard.resumeId;
}

/** Sidebar badge text for a `UserRole` (`USER` | `ADMIN`): only administrators get one. */
export function roleLabel(role) {
  return role === 'ADMIN' ? 'Admin' : '';
}

/**
 * The job-market demand (`GET /jobs/in-demand`) for one role match, or null when there is
 * nothing worth showing: the role wasn't measured, too few open jobs to say (jobCount 0), or
 * no skills. Roles are matched by title, which is how the backend keys them.
 */
export function demandFor(inDemand, roleTitle) {
  const role = (inDemand?.roles ?? []).find((entry) => entry.role === roleTitle);
  if (!role || !role.jobCount || !(role.skills ?? []).length) {
    return null;
  }
  return role;
}

/** "Python · 62%": a skill and the share of the role's open jobs asking for it. */
export function demandChipLabel(skill) {
  return `${skill.skill} · ${Math.round((skill.share ?? 0) * 100)}%`;
}

/** "What 14 open jobs for this role ask for" (one job reads "1 open job asks"). */
export function demandHeading(jobCount) {
  return jobCount === 1 ? 'What 1 open job for this role asks for' : `What ${jobCount} open jobs for this role ask for`;
}
