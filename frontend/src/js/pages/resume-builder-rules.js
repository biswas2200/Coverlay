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
  { id: 'clean', name: 'Clean', blurb: 'One column with plain headings. Reads well in every ATS.', style: 'simple', pages: 1, levels: ['fresher', 'junior', 'senior'], fontSize: 11, margin: 19.1 },
  { id: 'modern', name: 'Modern', blurb: 'An accent colour on the name and headings, still one column.', style: 'modern', pages: 1, levels: ['junior', 'senior'], fontSize: 11, margin: 19.1 },
  { id: 'compact', name: 'Compact', blurb: 'Tighter spacing, so more fits on one page.', style: 'simple', pages: 1, levels: ['student', 'fresher'], fontSize: 10, margin: 12.7 },
  { id: 'academic', name: 'Academic', blurb: 'Serif type and a centred header. Room for two pages.', style: 'academic', pages: 2, levels: ['student', 'senior'], fontSize: 11, margin: 19.1 },
  {
    id: 'classic', name: 'Classic', blurb: 'The LaTeX look: Computer Modern type, small-caps headings, justified text. Download as PDF only.',
    style: 'classic', pages: 1, levels: ['student', 'fresher', 'junior', 'senior'], pdfOnly: true, fontSize: 11, margin: 19.1,
  },
  {
    id: 'sidebar', name: 'Sidebar', blurb: 'Two columns: education and skills down the side, summary and experience in the main column. Compact and easy to scan.',
    style: 'simple', pages: 1, levels: ['student', 'fresher', 'junior'], fontSize: 10.5, margin: 15, columns: 2,
  },
  {
    id: 'executive', name: 'Executive', blurb: 'Serif type, a centred header and two columns, with room for two pages.',
    style: 'academic', pages: 2, levels: ['senior'], fontSize: 11, margin: 19.1, columns: 2, font: 'serif',
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
  name: 'Name', contact: 'Contact', summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', custom: 'Custom section',
};

const FIELD_LABELS = {
  name: 'Name', contact: 'Contact details', summary: 'Summary', role: 'Job title and company', dates: 'Dates',
  details: 'What you did', degree: 'Degree and institution', skills: 'Skill', custom: 'Custom section',
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
  spacing: ['tight', 'normal', 'airy'],
  align: ['left', 'center'],
  bullets: [false, true],
  style: ['formal', 'concise', 'friendly', 'beginner'],
  columns: [1, 2],
  page: ['a4', 'letter'],
  unit: ['cm', 'in'],
  rules: [false, true],
};

/** The text size in points: set with the A- / A+ buttons, 8 to 14 in half steps. `fit` is the smallest Lay AI goes. */
export const FONT_SIZE = { min: 8, max: 14, step: 0.5, fit: 9.5, default: 11 };

/** The page margins, one per side, in millimetres, like Word's Page Setup. */
export const MARGIN_KEYS = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'];
export const MARGIN_LIMITS_MM = { min: 5, max: 50, step: 0.5 };

/** Ready-made margins: Narrow is Word's 0.5 in, Wide is 1 in. */
export const MARGIN_PRESETS = {
  narrow: { marginTop: 12.7, marginBottom: 12.7, marginLeft: 12.7, marginRight: 12.7 },
  moderate: { marginTop: 12.7, marginBottom: 12.7, marginLeft: 19.1, marginRight: 19.1 },
  normal: { marginTop: 19.1, marginBottom: 19.1, marginLeft: 19.1, marginRight: 19.1 },
  wide: { marginTop: 25.4, marginBottom: 25.4, marginLeft: 25.4, marginRight: 25.4 },
};

/** The built-in sections that can be hidden (their text is kept): what is left is the header and the experience. */
export const HIDEABLE_SECTIONS = ['summary', 'education', 'skills'];

export const DEFAULT_FORMAT = {
  font: 'sans', fontSize: FONT_SIZE.default, spacing: 'normal', align: 'left', bullets: false, style: 'formal',
  columns: 1, page: 'a4', unit: 'cm', rules: false, hidden: [], ...MARGIN_PRESETS.normal,
};

export const WRITING_STYLE_LABELS = { formal: 'Formal', concise: 'Concise', friendly: 'Friendly', beginner: 'Beginner' };

/** A font size kept to the allowed range and to half points. */
export function clampFontSize(size) {
  const rounded = Math.round(Number(size) / FONT_SIZE.step) * FONT_SIZE.step;
  return Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, rounded));
}

/** A saved format with every unknown or missing value replaced by its default. */
export function normalizeFormat(format) {
  const next = { ...DEFAULT_FORMAT, hidden: [] };
  if (format && typeof format === 'object') {
    if (Array.isArray(format.hidden)) {
      next.hidden = HIDEABLE_SECTIONS.filter((name) => format.hidden.includes(name));
    }
    for (const [key, allowed] of Object.entries(FORMAT_OPTIONS)) {
      if (allowed.includes(format[key])) {
        next[key] = format[key];
      }
    }
    if (format.fontSize !== null && format.fontSize !== '' && Number.isFinite(Number(format.fontSize))) {
      next.fontSize = clampFontSize(format.fontSize);
    }
    // An older save kept one named margin for all sides.
    const legacy = { narrow: 'narrow', normal: 'normal', wide: 'wide' }[format.margins];
    if (legacy) {
      Object.assign(next, MARGIN_PRESETS[legacy]);
    }
    for (const key of MARGIN_KEYS) {
      if (format[key] !== null && format[key] !== '' && Number.isFinite(Number(format[key]))) {
        next[key] = clampMargin(format[key]);
      }
    }
  }
  return next;
}

/** A margin kept to the allowed range, in tenths of a millimetre. */
export function clampMargin(mm) {
  return Math.min(MARGIN_LIMITS_MM.max, Math.max(MARGIN_LIMITS_MM.min, Math.round(Number(mm) * 10) / 10));
}

/** The name of the preset these margins match, or 'custom'. */
export function marginPreset(format) {
  const found = Object.entries(MARGIN_PRESETS).find(([, preset]) => MARGIN_KEYS.every((key) => Math.abs(preset[key] - format[key]) < 0.05));
  return found ? found[0] : 'custom';
}

/** A length in millimetres in the unit the person works in: centimetres or inches. */
export const fromMm = (mm, unit) => (unit === 'in' ? mm / 25.4 : mm / 10);
export const toMm = (value, unit) => Math.round((unit === 'in' ? value * 25.4 : value * 10) * 100) / 100;

/** "1.9 cm" or "0.75 in". */
export function formatLength(mm, unit) {
  const value = fromMm(mm, unit);
  return `${Number(value.toFixed(unit === 'in' ? 2 : 1))} ${unit}`;
}

// ---------- the page: size, margins, and fitting the resume into it ----------

/** Real paper sizes, in millimetres: the preview is drawn at this size so the page count is true. */
export const PAGE_SIZES = {
  a4: { name: 'A4', widthMm: 210, heightMm: 297 },
  letter: { name: 'Letter', widthMm: 215.9, heightMm: 279.4 },
};

/** CSS pixels (96 per inch) for a length in millimetres. */
export const mmToPx = (mm) => (mm * 96) / 25.4;

export function pageHeightPx(page) {
  return mmToPx((PAGE_SIZES[page] ?? PAGE_SIZES.a4).heightMm);
}

/** How full the pages are: `used` is in pages (1.14 = one page and a bit), `over` is how far past `limit` pages. */
export function pageUsage(contentHeightPx, page, limit) {
  const used = contentHeightPx / pageHeightPx(page);
  return { used, over: Math.max(0, used / limit - 1), fits: used <= limit + 0.003 };
}

const SPACING_TIGHTER = ['airy', 'normal', 'tight'];
/** The widest any margin may stay, tried in turn: 1 in, 0.75 in, 0.5 in. Smaller margins are left alone. */
const MARGIN_STEPS_MM = [25.4, 19.1, 12.7];

/**
 * Makes the resume fit `pages` pages by changing only how it is set, never what it says:
 * line spacing first, then the margins, then the font size, in the gentlest order, and it
 * stops as soon as it fits. It never makes anything bigger, never goes below the smallest
 * readable size, and never deletes text. `measure(format)` returns the content height in
 * pixels for a format (the page measures the real editor; the tests pass a stand-in).
 * Returns `{ format, fits, changes, used, over }`: `changes` says in words what was tightened,
 * and when it still does not fit, `over` is how much too long it is at the tightest setting.
 */
export function fitToPages(format, pages, measure) {
  const start = normalizeFormat(format);
  let current = start;
  const check = () => pageUsage(measure(current), current.page, pages);
  let usage = check();
  const apply = (change) => {
    current = normalizeFormat({ ...current, ...change });
    usage = check();
    return usage.fits;
  };
  const finish = () => ({ format: current, fits: usage.fits, changes: describeFitChanges(start, current), used: usage.used, over: usage.over });
  if (usage.fits) {
    return finish();
  }
  for (const spacing of SPACING_TIGHTER.slice(SPACING_TIGHTER.indexOf(current.spacing) + 1)) {
    if (apply({ spacing })) {
      return finish();
    }
  }
  for (const limit of MARGIN_STEPS_MM) {
    if (MARGIN_KEYS.some((key) => current[key] > limit + 0.05)) {
      if (apply(Object.fromEntries(MARGIN_KEYS.map((key) => [key, Math.min(current[key], limit)])))) {
        return finish();
      }
    }
  }
  while (current.fontSize - FONT_SIZE.step >= FONT_SIZE.fit - 1e-9) {
    if (apply({ fontSize: current.fontSize - FONT_SIZE.step })) {
      return finish();
    }
  }
  return finish();
}

/** "tightened the line spacing, narrowed the margins to 12.7 mm, and reduced the text from 11 to 10 pt". */
export function describeFitChanges(before, after) {
  const changes = [];
  if (before.spacing !== after.spacing) {
    changes.push('tightened the line spacing');
  }
  const widest = (format) => Math.max(...MARGIN_KEYS.map((key) => format[key]));
  if (widest(after) < widest(before) - 0.05) {
    changes.push(`narrowed the margins to ${Number(widest(after).toFixed(1))} mm`);
  }
  if (before.fontSize !== after.fontSize) {
    changes.push(`reduced the text from ${before.fontSize} to ${after.fontSize} pt`);
  }
  return changes;
}

/**
 * Is this chat message a request to fit the resume on a page ("fit it on one page", "squeeze
 * everything into 2 pages")? Returns `{ pages }` (1, 2, or null for "the page limit already
 * set") or null. "Make it fit a DevOps role" is not one.
 */
export function fitRequest(prompt) {
  const text = String(prompt ?? '').toLowerCase();
  const verb = /\b(fit|fits|fitting|squeeze|shrink|compress|condense|cram|tighten)\b/.test(text);
  const page = /\bpages?\b/.test(text);
  const roleTalk = /\b(role|job|position|posting|jd|company)\b/.test(text);
  const wholeResume = /\b(everything|all|contents?|whole|entire)\b/.test(text) && /\bresume\b|\bcv\b|\bcontents?\b|\beverything\b/.test(text);
  if (!((page && (verb || /\b(one|1|single|two|2)[ -]pages?\b/.test(text))) || (verb && wholeResume && !roleTalk))) {
    return null;
  }
  if (/\b(two|2)[ -]?pages?\b/.test(text)) {
    return { pages: 2 };
  }
  return /\b(one|1|single)[ -]?pages?\b/.test(text) ? { pages: 1 } : { pages: null };
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

/** The text in some editor blocks, for the word count. */
function blocksPlainText(nodes) {
  const parts = [];
  const walk = (node) => {
    if (node.text) {
      parts.push(node.text);
    }
    (node.content ?? []).forEach(walk);
  };
  (nodes ?? []).forEach(walk);
  return parts.join(' ');
}

/** Word and character counts of everything on the resume, formatting ignored (for the status bar). */
export function resumeStats(resume) {
  const parts = [resume.name, resume.contact, resume.summary, ...resume.skills];
  for (const section of resume.extra ?? []) {
    parts.push(section.title, blocksPlainText(section.body));
  }
  for (const job of resume.experience) {
    parts.push(job.role, job.dates, job.details);
  }
  for (const school of resume.education) {
    parts.push(school.degree, school.dates);
  }
  const text = parts.map((part) => plainText(part)).filter(Boolean);
  return {
    words: text.join(' ').split(/\s+/).filter(Boolean).length,
    characters: text.join(' ').length,
  };
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
  const change = {
    fields,
    addedSkills: after.skills.filter((s) => !had.has(s.toLowerCase())),
    removedSkills: before.skills.filter((s) => !has.has(s.toLowerCase())),
  };
  // Custom sections (titles, text, bullets, tables) are free-form, so they are compared as a whole.
  if (JSON.stringify(before.extra ?? []) !== JSON.stringify(after.extra ?? [])) {
    change.extraChanged = true;
  }
  return change;
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
export function suggestTemplates(answers, limit = 3) {
  const score = (t) => (t.style === answers.style ? 3 : 0) + (t.pages === answers.pages ? 2 : 0) + (t.levels.includes(answers.level) ? 1 : 0);
  return TEMPLATES.map((template, index) => ({ template, index, score: score(template) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
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
