// The Resume Builder preview's logic, kept free of the DOM so tests/resume-builder-rules.test.js
// can run it under Node: the sample resume, edits by path, the version history, template
// suggestions, and the canned "Lay AI" replies. This is a clickable prototype with sample data
// (Roadmap step A2): nothing here calls the backend or an AI. The real Lay AI will replace
// sampleLayReply() and the backend will store the history (Roadmap phase B).

export const STEPS = ['start', 'templates', 'editor', 'finished'];

export const LEVEL_LABELS = { student: 'Student', fresher: 'Fresher', junior: '1-3 yrs', senior: '3+ yrs' };

export const DEFAULT_ANSWERS = { role: '', level: 'junior', style: 'simple', pages: 1 };

export const TEMPLATES = [
  { id: 'clean', name: 'Clean', blurb: 'One column with plain headings. Reads well in every ATS.', style: 'simple', pages: 1, levels: ['fresher', 'junior', 'senior'] },
  { id: 'modern', name: 'Modern', blurb: 'An accent colour on the name and headings, still one column.', style: 'modern', pages: 1, levels: ['junior', 'senior'] },
  { id: 'compact', name: 'Compact', blurb: 'Tighter spacing, so more fits on one page.', style: 'simple', pages: 1, levels: ['student', 'fresher'] },
  { id: 'academic', name: 'Academic', blurb: 'Serif type and a centred header. Room for two pages.', style: 'academic', pages: 2, levels: ['student', 'senior'] },
];

const SAMPLE_RESUME = {
  name: 'Jane Doe',
  contact: 'jane@email.com | +91 98765 43210 | Bengaluru',
  summary:
    'Backend developer with 3 years of Java and Spring Boot experience. Built payment APIs used by 2 million people and cut their response time by 40%.',
  experience: [
    { role: 'Software Engineer, Acme Corp', dates: '2021 - now', details: 'Built and ran the payment APIs: Java, Spring Boot, PostgreSQL.' },
  ],
  education: [{ degree: 'B.Tech Computer Science, VIT', dates: '2021' }],
  skills: ['Java', 'Spring Boot', 'SQL'],
};

const SECTION_LABELS = {
  name: 'Name', contact: 'Contact', summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills',
};

const FIELD_LABELS = {
  name: 'Name', contact: 'Contact details', summary: 'Summary', role: 'Job title and company', dates: 'Dates',
  details: 'What you did', degree: 'Degree and institution', skills: 'Skill',
};

// How a skill is usually written; anything else just gets a capital first letter.
const SKILL_CASING = {
  aws: 'AWS', azure: 'Azure', 'ci/cd': 'CI/CD', docker: 'Docker', gcp: 'GCP', git: 'Git', graphql: 'GraphQL',
  java: 'Java', javascript: 'JavaScript', kafka: 'Kafka', kubernetes: 'Kubernetes', linux: 'Linux', mongodb: 'MongoDB',
  'node.js': 'Node.js', nodejs: 'Node.js', postgresql: 'PostgreSQL', python: 'Python', react: 'React', redis: 'Redis',
  'spring boot': 'Spring Boot', sql: 'SQL', terraform: 'Terraform', typescript: 'TypeScript',
};

const MAX_VERSIONS = 50;

export function sampleResume() {
  return structuredClone(SAMPLE_RESUME);
}

/** Collapses runs of whitespace (typed newlines included) and trims. */
export function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** "A", "A and B", "A, B and C". */
export function joinList(items) {
  if (items.length <= 1) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function canonicalSkill(raw) {
  const text = normalizeText(raw);
  return SKILL_CASING[text.toLowerCase()] ?? text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Experience" for "experience.0.role": the section a field belongs to, for version names. */
export function sectionLabel(path) {
  return SECTION_LABELS[path.split('.')[0]] ?? 'Resume';
}

/** What a screen reader calls the field at `path`. */
export function fieldLabel(path) {
  const parts = path.split('.');
  return FIELD_LABELS[parts.at(-1)] ?? FIELD_LABELS[parts[0]] ?? 'Resume field';
}

function parsePath(path) {
  return path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export function getAt(resume, path) {
  return parsePath(path).reduce((node, key) => (node == null ? undefined : node[key]), resume);
}

/**
 * The resume with the field at `path` set to `value`, as a new object; the same object when
 * nothing changes or the path is unknown. Skills are a list: `skills.<length>` appends, and an
 * emptied skill is removed.
 */
export function applyEdit(resume, path, value) {
  const keys = parsePath(path);
  const text = normalizeText(value);

  if (keys[0] === 'skills' && keys.length === 2 && typeof keys[1] === 'number') {
    const index = keys[1];
    if (index > resume.skills.length || (index === resume.skills.length && !text)) {
      return resume;
    }
    if (resume.skills[index] === text) {
      return resume;
    }
    const next = structuredClone(resume);
    if (text) {
      next.skills[index] = text;
    } else {
      next.skills.splice(index, 1);
    }
    return next;
  }

  const current = getAt(resume, path);
  if (typeof current !== 'string' || current === text) {
    return resume;
  }
  const next = structuredClone(resume);
  const parent = keys.slice(0, -1).reduce((node, key) => node[key], next);
  parent[keys.at(-1)] = text;
  return next;
}

function textPaths(resume) {
  const paths = ['name', 'contact', 'summary'];
  resume.experience.forEach((_, i) => paths.push(`experience.${i}.role`, `experience.${i}.dates`, `experience.${i}.details`));
  resume.education.forEach((_, i) => paths.push(`education.${i}.degree`, `education.${i}.dates`));
  return paths;
}

/** What changed between two resumes: text fields by path, and skills added or removed. */
export function diffResume(before, after) {
  const fields = textPaths(after).filter((path) => getAt(before, path) !== getAt(after, path));
  const had = new Set(before.skills.map((s) => s.toLowerCase()));
  const has = new Set(after.skills.map((s) => s.toLowerCase()));
  return {
    fields,
    addedSkills: after.skills.filter((s) => !had.has(s.toLowerCase())),
    removedSkills: before.skills.filter((s) => !has.has(s.toLowerCase())),
  };
}

// ---------- version history ----------

export function createHistory(resume, { source, summary, at }) {
  return { versions: [{ number: 1, source, summary, at, resume }], current: 1 };
}

export function addVersion(history, resume, { source, summary, at }) {
  const number = history.versions.at(-1).number + 1;
  const versions = [...history.versions, { number, source, summary, at, resume }].slice(-MAX_VERSIONS);
  return { versions, current: number };
}

export function findVersion(history, number) {
  return history.versions.find((version) => version.number === number) ?? null;
}

export function currentResume(history) {
  return findVersion(history, history.current)?.resume ?? history.versions.at(-1).resume;
}

export function versionsNewestFirst(history) {
  return [...history.versions].reverse();
}

/**
 * Going back to an earlier version adds it again as the newest one ("Restored v2"), so nothing
 * is lost and the restore itself can be undone. Restoring the current or an unknown version
 * changes nothing.
 */
export function restoreVersion(history, number, at) {
  const version = findVersion(history, number);
  if (!version || number === history.current) {
    return history;
  }
  return addVersion(history, structuredClone(version.resume), { source: 'restore', summary: `Restored v${number}`, at });
}

export function relativeTime(at, now) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// ---------- start questions and templates ----------

/** "For Backend Developer · 1-3 yrs · simple · 1 page" (no role part when it is blank). */
export function answersSummary(answers) {
  const role = normalizeText(answers.role);
  const parts = [LEVEL_LABELS[answers.level] ?? '', answers.style, answers.pages === 2 ? '2 pages' : '1 page'];
  return [role ? `For ${role}` : null, ...parts].filter(Boolean).join(' · ');
}

/** The three templates that fit the answers best, best first (ties keep the list order). */
export function suggestTemplates(answers) {
  const score = (t) => (t.style === answers.style ? 3 : 0) + (t.pages === answers.pages ? 2 : 0) + (t.levels.includes(answers.level) ? 1 : 0);
  return TEMPLATES.map((template, index) => ({ template, index, score: score(template) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .map(({ template }) => template);
}

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

// ---------- sample Lay AI replies ----------

const HELP_REPLY =
  'In this preview I understand a few requests, for example: "Add Docker to my skills", ' +
  '"Remove SQL from my skills", "Shorten my summary" or "Rewrite my summary for a senior backend role".';

function parseSkillList(text) {
  return text
    .split(/,|&|\+|\band\b/i)
    .map((s) => s.replace(/^(?:the|a|an)\s+/i, '').replace(/[.!?]+$/, ''))
    .map(normalizeText)
    .filter(Boolean)
    .map(canonicalSkill);
}

function looksLikeSkills(prompt, skills) {
  return /\bskills?\b/i.test(prompt) || (skills.length > 0 && skills.every((s) => s.toLowerCase() in SKILL_CASING));
}

function addSkills(prompt, resume) {
  const match = prompt.match(/\badd\s+(.+?)(?:\s+(?:to|in|into|under)\s+(?:my\s+|the\s+)?skills?\b.*)?$/i);
  const skills = match ? parseSkillList(match[1]) : [];
  if (!skills.length || !looksLikeSkills(prompt, skills)) {
    return null;
  }
  const have = new Set(resume.skills.map((s) => s.toLowerCase()));
  const fresh = skills.filter((s, i) => !have.has(s.toLowerCase()) && skills.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === i);
  if (!fresh.length) {
    return { reply: `You already have ${joinList(skills)} in Skills.`, resume, summary: null };
  }
  const next = structuredClone(resume);
  next.skills.push(...fresh);
  return { reply: `Done: added ${joinList(fresh)} to Skills.`, resume: next, summary: `Lay AI: added ${fresh.join(', ')}` };
}

function removeSkills(prompt, resume) {
  const match = prompt.match(/\b(?:remove|delete|drop)\s+(.+?)(?:\s+from\s+(?:my\s+|the\s+)?skills?\b.*)?$/i);
  const skills = match ? parseSkillList(match[1]) : [];
  if (!skills.length || !looksLikeSkills(prompt, skills)) {
    return null;
  }
  const wanted = new Set(skills.map((s) => s.toLowerCase()));
  const gone = resume.skills.filter((s) => wanted.has(s.toLowerCase()));
  if (!gone.length) {
    return { reply: `I couldn't find ${joinList(skills)} in your Skills.`, resume, summary: null };
  }
  const next = structuredClone(resume);
  next.skills = resume.skills.filter((s) => !wanted.has(s.toLowerCase()));
  return { reply: `Removed ${joinList(gone)} from Skills.`, resume: next, summary: `Lay AI: removed ${gone.join(', ')}` };
}

function shortenSummary(resume) {
  const first = resume.summary.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? resume.summary;
  const words = first.split(' ');
  const shorter = words.length > 14 ? `${words.slice(0, 14).join(' ').replace(/[,;:]$/, '')}.` : first;
  if (shorter === resume.summary) {
    return { reply: 'Your Summary is already short.', resume, summary: null };
  }
  const next = structuredClone(resume);
  next.summary = shorter;
  return { reply: 'Shortened your Summary to one sentence.', resume: next, summary: 'Lay AI: shortened Summary' };
}

const JOB_WORD = /(developer|engineer|analyst|designer|manager|scientist|nurse|accountant|specialist|consultant|intern|lead|architect)$/i;

function rewriteSummary(prompt, resume) {
  const role = prompt.match(/\b(?:for|fit|as)\s+(?:a|an|the)?\s*(.+?)\s+(?:role|position|job)\b/i)?.[1];
  const title = role ? normalizeText(role) : 'developer';
  const lead = JOB_WORD.test(title) ? title : `${title} developer`;
  const skills = joinList(resume.skills.slice(0, 3));
  const summary = `${lead.charAt(0).toUpperCase()}${lead.slice(1)} with hands-on experience in ${skills}, building reliable, well-tested software.`;
  const next = structuredClone(resume);
  next.summary = summary;
  return {
    reply: role ? `Updated your Summary for a ${title} role.` : 'Rewrote your Summary.',
    resume: next,
    summary: 'Lay AI: rewrote Summary',
  };
}

/**
 * A canned reply for the preview: `{ reply, resume, summary }`, where `resume` is the same
 * object when nothing changed and `summary` names the new version (null when none).
 */
export function sampleLayReply(prompt, resume) {
  const text = normalizeText(prompt);
  const fromSkills = /\b(?:remove|delete|drop)\b/i.test(text) ? removeSkills(text, resume) : addSkills(text, resume);
  if (fromSkills) {
    return fromSkills;
  }
  if (/\bsummary\b/i.test(text)) {
    if (/\b(?:short|shorter|shorten|concise|brief|trim|cut)\b/i.test(text)) {
      return shortenSummary(resume);
    }
    if (/\b(?:rewrite|improve|better|fit|for|tailor|stronger|update)\b/i.test(text)) {
      return rewriteSummary(text, resume);
    }
  }
  return { reply: HELP_REPLY, resume, summary: null };
}

// ---------- saved state ----------

function isResume(value) {
  return (
    !!value && typeof value.name === 'string' && typeof value.contact === 'string' && typeof value.summary === 'string' &&
    Array.isArray(value.experience) && Array.isArray(value.education) && Array.isArray(value.skills)
  );
}

/** Whether what this browser saved is a builder state the page can show (else start over). */
export function isSavedState(state) {
  if (!state || typeof state !== 'object' || !STEPS.includes(state.step) || !state.answers || !Array.isArray(state.messages)) {
    return false;
  }
  const needsHistory = state.step === 'editor' || state.step === 'finished';
  if (state.history === null) {
    return !needsHistory;
  }
  const { history } = state;
  return (
    !!history && Array.isArray(history.versions) && history.versions.length > 0 &&
    history.versions.every((v) => typeof v.number === 'number' && isResume(v.resume)) &&
    typeof history.current === 'number'
  );
}
