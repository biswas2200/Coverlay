// The Resume Builder preview's logic, kept free of the DOM so tests/resume-builder-rules.test.js
// can run it under Node: the sample resume, edits by path, the version history, template
// suggestions, rich text (bold, italic, underline, links), the formatting toolbar's settings,
// suggest mode (what a role's job postings ask for, next to the resume: the user adds what is
// true), the Lay AI cursor's hints, and the canned "Lay AI" replies. This is a clickable
// prototype with sample data: nothing here calls the backend or an AI. The real Lay AI will
// replace sampleLayReply() and the backend will store the history (Roadmap phase B).

export const STEPS = ['start', 'templates', 'editor', 'finished'];

export const LEVEL_LABELS = { student: 'Student', fresher: 'Fresher', junior: '1-3 yrs', senior: '3+ yrs' };

export const DEFAULT_ANSWERS = { role: '', level: 'junior', style: 'simple', pages: 1 };

export const TEMPLATES = [
  { id: 'clean', name: 'Clean', blurb: 'One column with plain headings. Reads well in every ATS.', style: 'simple', pages: 1, levels: ['fresher', 'junior', 'senior'] },
  { id: 'modern', name: 'Modern', blurb: 'An accent colour on the name and headings, still one column.', style: 'modern', pages: 1, levels: ['junior', 'senior'] },
  { id: 'compact', name: 'Compact', blurb: 'Tighter spacing, so more fits on one page.', style: 'simple', pages: 1, levels: ['student', 'fresher'] },
  { id: 'academic', name: 'Academic', blurb: 'Serif type and a centred header. Room for two pages.', style: 'academic', pages: 2, levels: ['student', 'senior'] },
  {
    id: 'classic', name: 'Classic', blurb: 'The LaTeX look: Computer Modern type, small-caps headings, justified text. Download as PDF only.',
    style: 'classic', pages: 1, levels: ['student', 'fresher', 'junior', 'senior'], pdfOnly: true,
  },
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

// ---------- the formatting toolbar ----------

/** What the toolbar can set, and the default for each. Values outside these are ignored. */
export const FORMAT_OPTIONS = {
  font: ['sans', 'serif', 'classic'],
  size: ['s', 'm', 'l'],
  spacing: ['tight', 'normal', 'airy'],
  align: ['left', 'center'],
  bullets: [false, true],
  style: ['formal', 'concise', 'friendly', 'beginner'],
};

export const DEFAULT_FORMAT = { font: 'sans', size: 'm', spacing: 'normal', align: 'left', bullets: false, style: 'formal' };

export const WRITING_STYLE_LABELS = { formal: 'Formal', concise: 'Concise', friendly: 'Friendly', beginner: 'Beginner' };

/** A saved format with every unknown or missing value replaced by its default. */
export function normalizeFormat(format) {
  const next = { ...DEFAULT_FORMAT };
  if (format && typeof format === 'object') {
    for (const [key, allowed] of Object.entries(FORMAT_OPTIONS)) {
      if (allowed.includes(format[key])) {
        next[key] = format[key];
      }
    }
  }
  return next;
}

// ---------- rich text: bold, italic, underline and links ----------
// Text fields keep their formatting as a tiny subset of HTML -- <b>, <i>, <u> and
// <a href="..."> around escaped text -- so a version is still one string and the diff, the
// history and the tests stay simple. The page never assigns it as HTML: parseInline() turns it
// into segments that are built with textContent. Links are only ever http(s), mailto or tel.

const TAG = /<(\/?)(b|i|u|a)(?:\s+href="([^"<>]*)")?>/g;
const STYLE_OF = { b: 'bold', i: 'italic', u: 'underline' };
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

/** Escapes text so it can sit inside the markup: &, < and >. */
export function escapeMarkup(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeMarkup(text) {
  return text.replace(/&(?:amp|lt|gt|quot);/g, (entity) => ENTITIES[entity]);
}

/**
 * A link target that is safe to put in href: http(s), mailto or tel; a bare
 * "linkedin.com/in/x" or "www.x.com" gets https://. Anything else is null.
 */
export function safeHref(raw) {
  const url = String(raw ?? '').trim();
  if (!url || /[\s"'<>`]/.test(url)) {
    return null;
  }
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(url)) {
    return /^https?:\/\/[^/]/i.test(url) || /^(?:mailto|tel):./i.test(url) ? url : null;
  }
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#].*)?$/i.test(url)) {
    return `https://${url}`;
  }
  return null;
}

/** The markup as segments: `[{ text, bold?, italic?, underline?, href? }]`. */
export function parseInline(markup) {
  const source = String(markup ?? '');
  const segments = [];
  const open = []; // [{ tag, href }]
  const push = (raw) => {
    if (!raw) {
      return;
    }
    const segment = { text: unescapeMarkup(raw) };
    for (const { tag, href } of open) {
      if (tag === 'a') {
        if (href) {
          segment.href = href;
        }
      } else {
        segment[STYLE_OF[tag]] = true;
      }
    }
    segments.push(segment);
  };
  let last = 0;
  for (const match of source.matchAll(TAG)) {
    push(source.slice(last, match.index));
    last = match.index + match[0].length;
    const [, closing, tag, href] = match;
    if (closing) {
      const at = open.map((o) => o.tag).lastIndexOf(tag);
      if (at !== -1) {
        open.splice(at, 1);
      }
    } else {
      open.push({ tag, href: tag === 'a' ? safeHref(unescapeMarkup(href ?? '')) : null });
    }
  }
  push(source.slice(last));
  return segments;
}

/** The text without its formatting, e.g. for word counts and the analyzer. */
export function plainText(markup) {
  return parseInline(markup).map((s) => s.text).join('');
}

/** Segments back to markup (the inverse of parseInline). */
export function serializeSegments(segments) {
  return segments
    .map((segment) => {
      let out = escapeMarkup(segment.text);
      if (!out) {
        return '';
      }
      if (segment.italic) {
        out = `<i>${out}</i>`;
      }
      if (segment.bold) {
        out = `<b>${out}</b>`;
      }
      if (segment.underline) {
        out = `<u>${out}</u>`;
      }
      const href = segment.href ? safeHref(segment.href) : null;
      if (href) {
        out = `<a href="${escapeMarkup(href)}">${out}</a>`;
      }
      return out;
    })
    .join('');
}

/** Joins neighbouring segments that carry the same formatting. */
export function mergeSegments(segments) {
  const out = [];
  for (const segment of segments) {
    const last = out.at(-1);
    const same = last && ['bold', 'italic', 'underline', 'href'].every((k) => (last[k] ?? null) === (segment[k] ?? null));
    if (same) {
      last.text += segment.text;
    } else if (segment.text) {
      out.push({ ...segment });
    }
  }
  return out;
}

/** A paragraph split into its sentences (for bullet points), formatting kept. */
export function sentences(markup) {
  return String(markup ?? '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9<])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Fields that keep formatting; the name, dates and skill chips are plain text. */
export function isRichPath(path) {
  return path === 'contact' || path === 'summary' || /^(?:experience\.\d+\.(?:role|details)|education\.\d+\.degree)$/.test(path);
}

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
  '"Remove SQL from my skills", "Shorten my summary", "Rewrite my summary for a senior backend role" ' +
  'or "Make it fit a DevOps role".';

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

/** One summary sentence for a role in the chosen writing style, from skills the resume already has. */
export function styledSummary(lead, skillList, style = 'formal') {
  const role = `${lead.charAt(0).toUpperCase()}${lead.slice(1)}`;
  const skills = joinList(skillList);
  switch (style) {
    case 'concise':
      return `${role}: ${skillList.join(', ')}. Reliable, well-tested software.`;
    case 'friendly':
      return `I'm a ${lead.charAt(0).toLowerCase()}${lead.slice(1)} who enjoys building reliable software with ${skills}.`;
    case 'beginner':
      return `${role} who builds software with ${skills} and checks that it works well.`;
    default:
      return `${role} with hands-on experience in ${skills}, building reliable, well-tested software.`;
  }
}

function rewriteSummary(prompt, resume, style) {
  const role = prompt.match(/\b(?:for|fit|as)\s+(?:a|an|the)?\s*(.+?)\s+(?:role|position|job)\b/i)?.[1];
  const title = role ? normalizeText(role) : 'developer';
  const lead = JOB_WORD.test(title) ? title : `${title} developer`;
  const summary = escapeMarkup(styledSummary(lead, resume.skills.slice(0, 3), style));
  const next = structuredClone(resume);
  next.summary = summary;
  return {
    reply: role ? `Updated your Summary for a ${title} role.` : 'Rewrote your Summary.',
    resume: next,
    summary: 'Lay AI: rewrote Summary',
  };
}

// ---------- suggest mode: what a role asks for, next to the resume ----------
// Lay AI never writes a whole resume for a role ("create me a DevOps resume"). It lists what
// that role's job postings ask for, says what the resume already has and where it hints at the
// rest, and the user adds only what is true. The shares are sample numbers here; the real ones
// come from the backend's market_skill_demand table (built from open job postings).

export const MARKET_SAMPLE = {
  devops: { label: 'DevOps Engineer', jobs: 412, skills: [['Docker', 0.71], ['Kubernetes', 0.64], ['Linux', 0.58], ['CI/CD', 0.55], ['AWS', 0.52], ['Terraform', 0.41]] },
  sde: { label: 'Software Development Engineer', jobs: 1280, skills: [['Data Structures', 0.62], ['System Design', 0.48], ['Java', 0.44], ['SQL', 0.39], ['Git', 0.36]] },
  backend: { label: 'Backend Developer', jobs: 860, skills: [['Java', 0.52], ['SQL', 0.47], ['Spring Boot', 0.41], ['Docker', 0.38], ['Kafka', 0.27], ['Redis', 0.25]] },
  data: { label: 'Data Analyst', jobs: 540, skills: [['SQL', 0.74], ['Excel', 0.61], ['Python', 0.49], ['Power BI', 0.38], ['Tableau', 0.31]] },
};

const ROLE_PATTERNS = [
  [/\bdev\s?ops\b/i, 'devops'],
  [/\b(?:sde|software development engineer|software engineer)\b/i, 'sde'],
  [/\bback-?end\b/i, 'backend'],
  [/\b(?:data analyst|analyst)\b/i, 'data'],
];

const SUGGEST_VERB = /\b(?:fit|fits|tailor|target|suggest|match|create|write|make|build|prepare|aim|ready)\b/i;

// Words in the resume that hint the person has used a skill without listing it.
const EVIDENCE = {
  Docker: ['container', 'docker'], Kubernetes: ['kubernetes', 'k8s', 'cluster'], Linux: ['linux', 'unix', 'shell'],
  'CI/CD': ['pipeline', 'deploy', 'release'], AWS: ['aws', 'cloud'], Terraform: ['terraform', 'infrastructure'],
  'Data Structures': ['algorithm'], 'System Design': ['architecture', 'design', 'scal'], Git: ['git', 'github'],
  Kafka: ['kafka', 'queue', 'event'], Redis: ['redis', 'cache'], SQL: ['sql', 'postgres', 'database'],
  Excel: ['excel', 'spreadsheet'], Python: ['python'], 'Power BI': ['power bi', 'dashboard'], Tableau: ['tableau'],
};

/** Which sample role a prompt names ("devops", "sde", "backend", "data"), or null. */
export function roleFromPrompt(prompt) {
  return ROLE_PATTERNS.find(([pattern]) => pattern.test(prompt))?.[1] ?? null;
}

/** The first sentence of the summary that carries a number: a fact worth keeping. */
function achievement(summary) {
  return sentences(summary).find((s, i) => i > 0 && /\d/.test(s)) ?? null;
}

/**
 * Suggestions for a role, or null when the prompt doesn't ask to fit one:
 * `{ role, jobs, reply, items: [{ id, kind: 'skill'|'summary', ..., status }] }`. Skills the
 * resume has are `status: 'have'`; the rest and the summary start `open`.
 */
export function suggestForRole(prompt, resume, style = 'formal') {
  const key = roleFromPrompt(prompt);
  if (!key || !SUGGEST_VERB.test(prompt)) {
    return null;
  }
  const market = MARKET_SAMPLE[key];
  const have = new Set(resume.skills.map((s) => s.toLowerCase()));
  const written = plainText([resume.summary, ...resume.experience.map((e) => `${e.role} ${e.details}`)].join(' ')).toLowerCase();
  const items = market.skills.map(([skill, share]) => {
    const already = have.has(skill.toLowerCase());
    const hint = EVIDENCE[skill]?.find((word) => written.includes(word));
    let evidence = 'Not in your resume yet: add it only if you have used it.';
    if (already) {
      evidence = 'Already in your Skills.';
    } else if (hint) {
      evidence = `Your resume mentions "${hint}", so you may have used it.`;
    }
    return { id: `skill:${skill}`, kind: 'skill', skill, share, evidence, status: already ? 'have' : 'open' };
  });
  const lead = market.label.charAt(0).toLowerCase() + market.label.slice(1);
  const fact = achievement(resume.summary);
  const after = [escapeMarkup(styledSummary(lead, resume.skills.slice(0, 3), style)), fact].filter(Boolean).join(' ');
  if (after !== resume.summary) {
    items.push({ id: 'summary', kind: 'summary', before: resume.summary, after, status: 'open' });
  }
  return {
    role: market.label,
    jobs: market.jobs,
    items,
    reply: `I won't write a new resume from scratch. Here is what ${market.jobs} ${market.label} postings ask for (sample data), next to what you have. Add only what is true for you:`,
  };
}

/** The resume with one suggestion applied (a new object), or the same resume. */
export function applySuggestion(resume, item) {
  if (item.kind === 'skill') {
    if (resume.skills.some((s) => s.toLowerCase() === item.skill.toLowerCase())) {
      return resume;
    }
    const next = structuredClone(resume);
    next.skills.push(item.skill);
    return next;
  }
  if (item.kind === 'summary' && item.after && item.after !== resume.summary) {
    const next = structuredClone(resume);
    next.summary = item.after;
    return next;
  }
  return resume;
}

// ---------- the Lay AI cursor's hints while the user types ----------

/** A short tip for the field being typed in, or null. Shown beside the Lay AI cursor. */
export function watchHint(path, markup) {
  const text = plainText(markup);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (path === 'summary') {
    if (words > 60) {
      return 'Two or three sentences read best.';
    }
    return /\d/.test(text) ? null : 'A number (users, %, time saved) makes this stronger.';
  }
  if (/^experience\.\d+\.details$/.test(path)) {
    if (!/\d/.test(text)) {
      return 'Add one result with a number, like "cut costs by 20%".';
    }
    return /^(?:I |My |Was |Responsible)/i.test(text) ? 'Start with what you did: Built, Led, Cut…' : null;
  }
  if (path === 'contact') {
    return parseInline(markup).some((s) => s.href) ? null : 'Add your LinkedIn: select text, then the link button.';
  }
  if (path.startsWith('skills.')) {
    return 'List the tools you used at work first.';
  }
  return null;
}

/**
 * A canned reply for the preview: `{ reply, resume, summary, suggestion? }`, where `resume` is
 * the same object when nothing changed, `summary` names the new version (null when none), and
 * `suggestion` (suggest mode) lists changes the user can add one by one.
 */
export function sampleLayReply(prompt, resume, style = 'formal') {
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
      return rewriteSummary(text, resume, style);
    }
  }
  const suggestion = suggestForRole(text, resume, style);
  if (suggestion) {
    return { reply: suggestion.reply, resume, summary: null, suggestion };
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
  if (state.format !== undefined && (typeof state.format !== 'object' || state.format === null)) {
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
