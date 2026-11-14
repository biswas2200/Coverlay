import { rejectionsSummary } from './applications-rules.js';
import { blocksPlain } from './letter-doc.js';
import { draftLetter, toBlocks } from './letters-rules.js';
import { SAMPLE_GMAIL, blanksIn, buildMailRequest, describeBlank, mailSummary } from './mail-rules.js';
import { canonicalSkill, joinList, plainText, summaryForRole } from './resume-builder-rules.js';

// Lay AI as an assistant that works across the whole app (preview: the replies are worked out here, no AI call).
// The person says what they want in their own words, with a job description pasted under it if they like:
//   "I learned Docker and Kubernetes, add them to my resume. Here is the JD: ..."
// Lay AI reads the request and the job description, then PROPOSES: what it would change, with a button to agree.
// One approval covers one action. Nothing is changed, saved or sent before the person presses it, and an email is
// never sent from here at all (that stays on the Letters page, behind its own confirmation).
//
// Honesty rules (docs/prototype-spec.md, RB-LAY): Lay AI adds only skills the person says they have; it never
// writes experience; the skills a job asks for that the resume lacks are listed, not added; the match says what it
// counted. The raw job description is never stored: only what was read from it (the role, the company, the skills).
//
// DOM-free, so tests/lay-agent-rules.test.js can run it in Node. Pages carry out the `effect` a step returns
// (lay-agent.js and lay-global.js); the Builder commits a `resume` a step returns as one new version.

// ---------- what a job description asks for ----------

// Each entry is `Name|alias|alias`; a piece that starts with "=" must match capital for capital (so the verb
// "excel" is not the spreadsheet). The first piece is the name used on the resume.
const VOCAB_SOURCE = [
  'Java', 'Spring Boot|springboot', 'SQL', 'Kafka', 'Redis', 'Docker', 'Kubernetes|k8s', 'Terraform', 'AWS|Amazon Web Services', 'Azure',
  'GCP|Google Cloud', 'Linux', 'Git', 'CI/CD|CICD', 'Python', 'JavaScript', 'TypeScript', 'React|React.js|ReactJS', 'Node.js|NodeJS',
  'GraphQL', 'MongoDB', 'PostgreSQL|Postgres', 'MySQL', 'System Design', 'Data Structures', 'Algorithms', 'Microservices',
  'REST APIs|REST API|RESTful APIs', 'Jenkins', 'Ansible', 'Prometheus', 'Grafana', '=Excel', 'Power BI', 'Tableau', '=Spark|=Apache Spark',
  'Airflow', 'Go|=Golang', 'C++', '.NET', 'C#', 'Android', 'Kotlin', '=Swift', 'Angular', 'Vue|Vue.js', 'HTML', 'CSS', 'Figma',
  'Machine Learning', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'Hadoop', 'Elasticsearch', 'RabbitMQ', '=Helm', 'Nginx', '=Bash',
  'Agile|Scrum', 'JIRA', 'Selenium', 'JUnit', 'Maven', 'Hibernate', 'Django', 'Flask', 'FastAPI', 'Next.js', '=Rust',
];
/** A bare "Go" is too common a word to find in a job description: it only counts when the person names it. */
const NOT_SCANNED = new Set(['Go']);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

const VOCAB = VOCAB_SOURCE.map((source) => {
  const pieces = source.split('|').map((piece) => ({ text: piece.replace(/^=/, ''), exact: piece.startsWith('=') }));
  const name = pieces[0].text;
  const found = pieces.map(({ text, exact }) => ({
    text,
    exact,
    scan: !(NOT_SCANNED.has(text)),
    pattern: new RegExp(`(?<![A-Za-z0-9])${escapeRegex(text)}(?![A-Za-z0-9+#])`, exact ? '' : 'i'),
  }));
  return { name, pieces: found };
});

const BY_NAME = new Map(VOCAB.map((skill) => [skill.name.toLowerCase(), skill]));
const BY_ALIAS = new Map(VOCAB.flatMap((skill) => skill.pieces.map((piece) => [piece.text.toLowerCase(), skill.name])));

const lower = (text) => String(text ?? '').toLowerCase();

/** The name used on the resume for a skill the vocabulary knows ("k8s" is "Kubernetes"), or null. */
export function knownSkill(text) {
  return BY_ALIAS.get(lower(text).trim()) ?? null;
}

/** Whether a piece of text mentions a skill (by its name or an alias), as a whole word. */
export function mentions(text, skillName) {
  const skill = BY_NAME.get(lower(skillName));
  const body = String(text ?? '');
  return skill ? skill.pieces.some((piece) => piece.pattern.test(body)) : new RegExp(`(?<![A-Za-z0-9])${escapeRegex(skillName)}(?![A-Za-z0-9])`, 'i').test(body);
}

/** The skills a text names, in the order it first names them. */
export function jdSkills(text) {
  const body = String(text ?? '');
  const hits = [];
  for (const skill of VOCAB) {
    let first = Infinity;
    for (const piece of skill.pieces) {
      if (!piece.scan) {
        continue;
      }
      const at = body.search(piece.pattern);
      if (at >= 0 && at < first) {
        first = at;
      }
    }
    if (first !== Infinity) {
      hits.push({ name: skill.name, at: first });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((hit) => hit.name);
}

const JOB_WORD = /\b(?:developer|engineer|analyst|designer|manager|scientist|architect|lead|intern|specialist|consultant|administrator|programmer|tester|devops|sde|sre|qa)\b/i;
const NOT_A_COMPANY = new Set(['the', 'we', 'our', 'this', 'you', 'role', 'job', 'team', 'us', 'a', 'an', 'your']);

function cleanName(raw, limit = 60) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').replace(/^[\s"'*•\-–—:|]+|[\s"'*.,;:|]+$/g, '').trim();
  return text && text.length <= limit && !NOT_A_COMPANY.has(text.toLowerCase()) ? text : null;
}

/** The job title and the company from the top of a job description ("Platform Engineer at Razorpay"). */
function titleLine(line) {
  const text = line.replace(/^[\s#*•\-–—]+/, '').trim();
  if (!text || text.length > 110 || /[.!?]$/.test(text)) {
    return {};
  }
  const at = text.match(/^(.{3,80}?)\s+(?:at|@)\s+([A-Z][^\n|·,]{1,50})/);
  if (at && JOB_WORD.test(at[1])) {
    return { role: cleanName(at[1], 70), company: cleanName(at[2], 50) };
  }
  const plain = text.split(/\s+[|·]\s+/)[0];
  return JOB_WORD.test(plain) && plain.length <= 70 ? { role: cleanName(plain, 70) } : {};
}

/** The role and the company a job description is for; either is null when it does not say. */
export function jdHeadline(text) {
  const body = String(text ?? '');
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  let role = null;
  let company = null;

  const labelled = (names) => body.match(new RegExp(`^[ \\t>*•-]*(?:${names})\\s*[:\\-–]\\s*(.+)$`, 'im'))?.[1];
  role = cleanName(labelled('job title|title|role|position|designation'), 70);
  company = cleanName(labelled('company|organi[sz]ation|employer|hiring company'), 50);

  const top = titleLine(lines[0] ?? '');
  role ??= top.role ?? null;
  company ??= top.company ?? null;

  if (!role) {
    const wants = body.match(/(?:looking for|seeking|hiring|we need)\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z0-9+#./ -]{2,60}?)\s+(?:to|who|with|for|that|in|at|on)\b/i)?.[1];
    if (wants && JOB_WORD.test(wants) && wants.split(/\s+/).length <= 6) {
      role = cleanName(wants, 70);
    }
  }
  if (!company) {
    const capital = '[A-Z][A-Za-z0-9&.\\-]*(?: [A-Z][A-Za-z0-9&.\\-]*){0,2}';
    const named = body.match(new RegExp(`\\bAbout\\s+(${capital})`))?.[1]
      ?? body.match(new RegExp(`\\bJoin\\s+(${capital})`))?.[1]
      ?? body.match(new RegExp(`(${capital})\\s+is\\s+(?:hiring|looking|seeking)`))?.[1];
    company = cleanName(named, 50);
  }
  return { role, company };
}

const NICE_TO_HAVE = /^[ \t>*•\-–#]*(?:nice[ -]to[ -]haves?|good[ -]to[ -]haves?|preferred(?: qualifications| skills)?|bonus(?: points)?|desirable|plus points|optional)\b/im;

/**
 * Reads a job description: `{ role, company, skills, nice }`. `skills` are what it asks for, `nice` what it lists
 * under "nice to have" or "preferred". The text itself is not kept.
 */
export function parseJd(text) {
  const body = String(text ?? '').replace(/\r/g, '');
  const cut = body.search(NICE_TO_HAVE);
  const required = jdSkills(cut >= 0 ? body.slice(0, cut) : body);
  const nice = cut >= 0 ? jdSkills(body.slice(cut)).filter((skill) => !required.includes(skill)) : [];
  return { ...jdHeadline(body), skills: required, nice };
}

/** The skills that count for a match: what the job asks for, or its nice-to-haves when it names nothing else. */
export const asked = (jd) => (jd.skills.length ? jd.skills : jd.nice ?? []);

/** Whether a message is, or carries, a job description: long enough, and it reads like one. */
export function looksLikeJd(text) {
  const body = String(text ?? '');
  if (body.split(/\s+/).filter(Boolean).length < 30) {
    return false;
  }
  const cues = (body.match(/\b(?:responsibilit(?:y|ies)|requirements?|qualifications?|experience (?:with|in)|you will|we are (?:looking|hiring)|looking for|must have|nice to have|about (?:the )?(?:role|job|us)|what you'll|skills?|years? of experience)\b/gi) ?? []).length;
  return cues >= 2 || (cues >= 1 && jdSkills(body).length >= 3);
}

// ---------- reading the person's request ----------

const MARKER = /(?:^|\n|(?<=[.!?:])[ \t]+)[ \t]*(?:here(?:'s| is| are)\s+(?:the\s+|my\s+)?(?:jd|job description|job post(?:ing)?)\s*[:\-–]?|(?:the\s+)?(?:jd|job description|job post(?:ing)?)\s*[:\-–])\s*/i;
const INSTRUCTION = /\b(?:add|put|include|update|tailor|make|build|create|prepare|match|write|draft|compare|please|i (?:learned|learnt|acquired|have|want|need)|my new)\b/i;

/** The request and the job description apart: `{ instruction, jdText }` (either may be empty). */
export function splitMessage(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').trim();
  const marked = text.match(MARKER);
  if (marked) {
    const before = text.slice(0, marked.index).trim();
    const after = text.slice(marked.index + marked[0].length).trim();
    if (after) {
      return { instruction: before, jdText: after };
    }
  }
  if (!looksLikeJd(text)) {
    return { instruction: text, jdText: '' };
  }
  const [first, ...rest] = text.split(/\n\s*\n/);
  const restText = rest.join('\n\n').trim();
  if (restText && first.split(/\s+/).length <= 60 && INSTRUCTION.test(first) && looksLikeJd(restText)) {
    return { instruction: first.trim(), jdText: restText };
  }
  return { instruction: '', jdText: text };
}

const SKILL_FILLER = /^(?:the|a|an|some|new|also|using|with|in|like|such as|namely|skills?|of|and)\s+/i;

/** One piece of a list of skills: a known skill by its resume name, or (when `open`) a short plain phrase, or null. */
function oneSkill(piece, open) {
  let text = piece.trim().replace(/[.!?:;]+$/, '');
  let before;
  do {
    before = text;
    text = text.replace(SKILL_FILLER, '').trim();
  } while (text !== before);
  text = text.replace(/\s+(?:skills?|certification|course)$/i, '').trim();
  if (!text) {
    return null;
  }
  const known = knownSkill(text);
  if (known) {
    return known;
  }
  return open && text.split(/\s+/).length <= 3 && text.length <= 28 && /^[A-Za-z][A-Za-z0-9 .+#/&-]*$/.test(text) ? canonicalSkill(text) : null;
}

function skillList(phrase, open) {
  const seen = new Set();
  const skills = [];
  for (const piece of phrase.split(/,|;|&|\+|\band\b/i)) {
    const skill = oneSkill(piece, open);
    if (skill && !seen.has(skill.toLowerCase())) {
      seen.add(skill.toLowerCase());
      skills.push(skill);
    }
  }
  return skills.slice(0, 15);
}

const PHRASE_END = /[.!?\n]|,?\s+(?:and\s+)?(?:please\s+)?(?:i\s+(?:want|need|would)|add|put|include|update|make|tell|give|can you|could you)\b|\s+(?:to|in|into|on)\s+(?:my|the)\s+(?:resume|cv|skills?)\b|\s+so\b/i;
const TOLD = /\b(?:i(?:'ve| have)?\s+(?:just\s+)?(?:acquired|learn(?:ed|t)|picked up|gained|completed|finished|mastered|started using|now know)|(?:my\s+)?new\s+skills?(?:\s+(?:are|is|include|includes))?|i\s+(?:can\s+now|now)\s+(?:use|work with)|skills?\s+i\s+(?:have\s+)?(?:acquired|learned|gained))\b[:\s-]*/i;
const COMMAND = /\b(?:add|include|put)\s+(.+?)\s+(?:to|in|into|under|on)\s+(?:my|the)\s+(?:skills?|resume|cv)\b/i;
const LISTED = /\bskills?\s*[:\-–]\s*(.+)/i;

/**
 * The skills a person says they have: `{ skills, how }`. `how` is `told` ("I learned Docker", "my new skills are
 * ...") or `command` ("add Docker to my skills"); `skills` is empty when the message names none.
 */
export function declaredSkills(instruction) {
  const text = String(instruction ?? '');
  const told = text.match(TOLD);
  if (told) {
    const rest = text.slice(told.index + told[0].length);
    const phrase = rest.slice(0, rest.search(PHRASE_END) >= 0 ? rest.search(PHRASE_END) : undefined);
    const skills = skillList(phrase, /skills?/i.test(told[0]));
    if (skills.length) {
      return { skills, how: 'told' };
    }
  }
  const listed = text.match(LISTED);
  if (listed) {
    const rest = listed[1];
    const skills = skillList(rest.slice(0, rest.search(PHRASE_END) >= 0 ? rest.search(PHRASE_END) : undefined), true);
    if (skills.length) {
      return { skills, how: 'told' };
    }
  }
  const command = text.match(COMMAND);
  if (command) {
    const skills = skillList(command[1], /\bskills?\b/i.test(text));
    if (skills.length) {
      return { skills, how: 'command' };
    }
  }
  return { skills: [], how: null };
}

const PAGES = {
  builder: 'resume-builder.html', resume: 'resume-builder.html', letters: 'letters.html', letter: 'letters.html',
  applications: 'applications.html', application: 'applications.html', jobs: 'jobs.html', job: 'jobs.html', saved: 'saved.html',
  wallet: 'wallet.html', settings: 'settings.html', watchlist: 'watchlist.html', community: 'community.html',
  overview: 'dashboard.html', dashboard: 'dashboard.html',
};
const PAGE_NAMES = {
  'resume-builder.html': 'the Builder', 'letters.html': 'Letters & emails', 'applications.html': 'Applications', 'jobs.html': 'Jobs for you',
  'saved.html': 'Saved jobs', 'wallet.html': 'the Wallet', 'settings.html': 'Settings', 'watchlist.html': 'the Watchlist',
  'community.html': 'Community', 'dashboard.html': 'the Overview',
};

/** A page Lay AI may take the person to: only the app's own pages, by name. */
export function pageHref(name) {
  return PAGES[lower(name).replace(/s$/, '')] ?? PAGES[lower(name)] ?? null;
}

/**
 * What the person asked for: `{ ask, jd, skills, how, intents }`. `intents` is some of `update`, `match`, `email`,
 * `rejections` and `go` (with `target`). The declared skills come from the request only, never from the job
 * description (a job asks for skills; the person says which they have).
 */
export function readRequest(text) {
  const { instruction, jdText } = splitMessage(text);
  const jd = jdText ? parseJd(jdText) : null;
  const ask = lower(instruction);
  const { skills, how } = declaredSkills(instruction);
  const intents = new Set();
  const resumeWord = /\b(?:resume|cv)\b/.test(ask);
  if ((resumeWord && /\b(?:add|put|include|update|upgrade|refresh|tailor|make|build|create|prepare|rewrite|redo|latest|new|fit|adapt|improve)\b/.test(ask)) || skills.length) {
    intents.add('update');
  }
  if (/\b(?:match|how well|compare|my chances|am i (?:a )?(?:good )?fit|suitable|score)\b/.test(ask)) {
    intents.add('match');
  }
  if (/\bcold[- ]?(?:e-?mail|mail|message)\b|\b(?:e-?mail|mail|write to|message|reach out to|contact)\s+(?:the\s+)?(?:recruiter|hiring|manager|team)\b|\breach out\b|\breferral\s+(?:e-?mail|mail|message)\b|\b(?:draft|write|compose)\s+(?:an?\s+)?(?:e-?mail|mail)\b/.test(ask)) {
    intents.add('email');
  }
  if (/\brejections?\b|\brejected\b/.test(ask) && /\b(?:where|kept|stored|maintain|history|track|list|show|all)\b/.test(ask)) {
    intents.add('rejections');
  }
  const go = ask.match(/\b(?:open|go to|take me to|show me|navigate to)\s+(?:the\s+|my\s+)?(builder|resume builder|letters?|applications?|jobs?|saved|wallet|settings|watchlist|community|overview|dashboard)\b/);
  const target = go ? pageHref(go[1].replace(/^resume\s+/, '')) : null;
  if (target) {
    intents.add('go');
  }
  // A job description Lay AI read earlier is used for an update only when the message points at it ("for this
  // job", "tailor it"), so "add Docker to my skills" never turns into a tailoring.
  const refersToJd = /\b(?:jd|job description|this (?:job|role|position|posting|one)|that (?:job|role)|for it|tailor(?:ed)?|latest resume)\b/.test(ask);
  return { ask: instruction, jd, skills, how, intents, target, refersToJd };
}

// ---------- updating the resume ----------

const lc = (text) => text.toLowerCase();
const unique = (items) => items.filter((item, index) => items.findIndex((other) => lc(other) === lc(item)) === index);

/**
 * What an update would change, from a request: `{ add, already, reorder, role, summary, order, gap, nothing }`.
 * `add` are the skills the person said they have and the resume lacks; with a job description the skills it asks for
 * move to the front and the Summary is written for its role from skills the resume lists. Nothing here comes from
 * the job description except the order and the role: `gap` is what it asks for that the resume still lacks.
 */
export function planResumeUpdate(resume, { skills = [], jd = null } = {}, style = 'formal') {
  const have = new Set(resume.skills.map(lc));
  const told = unique(skills);
  const add = told.filter((skill) => !have.has(lc(skill)));
  const already = told.filter((skill) => have.has(lc(skill))).map((skill) => resume.skills.find((own) => lc(own) === lc(skill)));
  const all = [...resume.skills, ...add];
  const wanted = new Set(jd ? [...jd.skills, ...(jd.nice ?? [])].map(lc) : []);
  const front = all.filter((skill) => wanted.has(lc(skill)));
  const order = jd ? [...front, ...all.filter((skill) => !front.includes(skill))] : all;
  const reorder = order.some((skill, index) => skill !== all[index]);
  const role = jd?.role ?? null;
  // The Summary claims experience, so it names only skills the resume listed before this update, never one the person just added.
  const listed = front.filter((skill) => resume.skills.some((own) => lc(own) === lc(skill)));
  const written = role ? summaryForRole({ ...resume, skills: order }, role, style, listed.length ? listed : resume.skills) : null;
  const summary = written && written !== resume.summary ? written : null;
  const gap = jd ? asked(jd).filter((skill) => !order.some((own) => lc(own) === lc(skill))) : [];
  return { add, already, reorder, role, summary, order, gap, nothing: !add.length && !reorder && !summary };
}

/** The resume after a plan (a new object), or the same resume when the plan changes nothing. */
export function applyResumePlan(resume, plan) {
  if (plan.nothing) {
    return resume;
  }
  const next = structuredClone(resume);
  next.skills = [...plan.order];
  if (plan.summary) {
    next.summary = plan.summary;
  }
  return next;
}

/** The name a version gets: what changed, and that the person agreed. */
export function planVersionName(plan) {
  const parts = [];
  if (plan.add.length) {
    parts.push(`added ${plan.add.join(', ')}`);
  }
  if (plan.role && (plan.reorder || plan.summary)) {
    parts.push(`tailored for ${plan.role}`);
  } else if (plan.reorder) {
    parts.push('put the skills the job asks for first');
  }
  return `Lay AI: ${parts.join('; ') || 'no change'} (you agreed)`;
}

const gapSentence = (gap) => (gap.length ? `The job also asks for ${joinList(gap)}. I won't add ${gap.length === 1 ? 'it' : 'them'} unless you tell me you have ${gap.length === 1 ? 'it' : 'them'}.` : '');

/** What Lay AI says before it changes anything: the changes as a short list, and what it will not touch. */
export function planReply(plan, { onBuilder = true } = {}) {
  const lines = [];
  if (plan.add.length) {
    lines.push(`- Add ${joinList(plan.add)} to Skills, because you told me you have ${plan.add.length === 1 ? 'it' : 'them'}.`);
  }
  if (plan.reorder) {
    lines.push('- Put the skills this job asks for first.');
  }
  if (plan.summary) {
    lines.push(`- Write your Summary for a ${plan.role} role, from skills you already list.`);
  }
  lines.push('- Leave your Experience, Education and contact details as they are.');
  const where = onBuilder ? 'in your resume' : 'in your Builder';
  const already = plan.already.length ? ` ${joinList(plan.already)} ${plan.already.length === 1 ? 'is' : 'are'} already in your Skills.` : '';
  return [`Here is what I will change ${where}, only if you say yes:`, ...lines, `${gapSentence(plan.gap)}${already}`.trim(), onBuilder ? 'Go ahead?' : 'I will open the Builder and make the change there. Go ahead?']
    .filter(Boolean).join('\n');
}

/** What Lay AI says after it changed the resume. */
export function doneReply(plan) {
  const parts = [];
  if (plan.add.length) {
    parts.push(`added ${joinList(plan.add)}`);
  }
  if (plan.reorder) {
    parts.push('put the skills the job asks for first');
  }
  if (plan.summary) {
    parts.push(`wrote your Summary for ${plan.role}`);
  }
  return `Done: ${joinList(parts)}. It is a new version, shown in green, and Versions can take it back. I did not touch your Experience.`;
}

// ---------- matching a resume to a job ----------

/**
 * The resume against a job description, by skills: `{ role, company, total, matched, inText, missing, percent, nice }`.
 * A skill counts when it is in Skills, or when the Summary or Experience text names it (listed in `inText`).
 */
export function matchAgainst(resume, jd) {
  const have = new Set(resume.skills.map(lc));
  const written = plainText([resume.summary, ...resume.experience.map((job) => `${job.role} ${job.details}`)].join(' '));
  const pool = asked(jd);
  const inText = [];
  const matched = [];
  const missing = [];
  for (const skill of pool) {
    if (have.has(lc(skill))) {
      matched.push(skill);
    } else if (mentions(written, skill)) {
      matched.push(skill);
      inText.push(skill);
    } else {
      missing.push(skill);
    }
  }
  const niceHave = (jd.nice ?? []).filter((skill) => have.has(lc(skill)) || mentions(written, skill));
  return {
    role: jd.role ?? null,
    company: jd.company ?? null,
    total: pool.length,
    matched,
    inText,
    missing,
    percent: pool.length ? Math.round((100 * matched.length) / pool.length) : 0,
    nice: { have: niceHave, total: (jd.nice ?? []).length },
  };
}

const jobLabel = (jd) => [jd.role ?? 'this job', jd.company ? `at ${jd.company}` : null].filter(Boolean).join(' ');

/** The match in a few plain lines, with what it counted and what it could not. */
export function matchReply(match) {
  if (!match.total) {
    return `I could not find specific skills in that description for ${match.role ?? 'this job'}, so I have nothing to count. Paste the requirements part and I will try again.`;
  }
  const band = match.percent >= 75 ? 'a strong match' : match.percent >= 50 ? 'a fair match' : 'a thin match';
  const lines = [`${match.role ?? 'This job'}${match.company ? ` at ${match.company}` : ''}: you cover ${match.matched.length} of ${match.total} skills it asks for (${match.percent}%), ${band}.`];
  if (match.matched.length) {
    const note = match.inText.length ? ` (${joinList(match.inText)} ${match.inText.length === 1 ? 'is' : 'are'} in your experience text, not in Skills)` : '';
    lines.push(`You have: ${joinList(match.matched)}${note}.`);
  }
  if (match.missing.length) {
    lines.push(`Not on your resume: ${joinList(match.missing)}. Tell me if you have ${match.missing.length === 1 ? 'it' : 'any'} and I will add ${match.missing.length === 1 ? 'it' : 'them'}.`);
  }
  if (match.nice.total) {
    lines.push(`Nice to have: you have ${match.nice.have.length} of ${match.nice.total}.`);
  }
  lines.push('(Preview: this counts skills by name. The real match also reads what your experience says.)');
  return lines.join('\n');
}

// ---------- a cold email ----------

/** The cold email for a job: `{ subject, body, job, missingCompany }`, with placeholders still in (nothing personal). */
export function draftColdEmail(resume, jd) {
  const job = { title: jd.role ?? 'Open role', company: jd.company ?? '[Company]', skills: asked(jd) };
  const letter = draftLetter({ type: 'email', templateId: 'hiring-manager', resume, job });
  return { subject: letter.subject, body: blocksPlain(toBlocks(letter)), job, missingCompany: !jd.company };
}

/** The job as the Letters page takes it. */
export function lettersJob(jd) {
  const slug = `${jd.company ?? ''}-${jd.role ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'job';
  return { id: `lay-${slug}`, title: jd.role ?? 'Open role', company: jd.company ?? '[Company]', skills: asked(jd).slice(0, 12) };
}

// ---------- what travels between pages ----------

export const HANDOFF_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_CHAT = 30;
const LIMITS = { skill: 40, name: 80, skills: 30, text: 6000 };

const str = (value, limit) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null);
const skillsOf = (value) => (Array.isArray(value) ? unique(value.map((s) => str(s, LIMITS.skill)).filter(Boolean)).slice(0, LIMITS.skills) : []);

export const builderHandoffKey = (userId) => `coverlay.layHandoff.builder.${userId ?? 'guest'}`;
export const lettersHandoffKey = (userId) => `coverlay.layHandoff.letters.${userId ?? 'guest'}`;
export const memoryKey = (userId) => `coverlay.layMemory.${userId ?? 'guest'}`;
export const chatKey = (userId) => `coverlay.layChat.${userId ?? 'guest'}`;

/** What Lay AI keeps of a job description: the role, the company and the skills, never the text. */
export function cleanJd(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const jd = { role: str(value.role, LIMITS.name), company: str(value.company, LIMITS.name), skills: skillsOf(value.skills), nice: skillsOf(value.nice) };
  return jd.role || jd.company || jd.skills.length || jd.nice.length ? jd : null;
}

const fresh = (at, now) => typeof at === 'number' && at <= now + 60_000 && now - at <= HANDOFF_TTL_MS;

export function makeBuilderHandoff({ skills = [], jd = null }, now) {
  return { v: 1, at: now, skills: skillsOf(skills), jd: cleanJd(jd) };
}

/** A request waiting for the Builder, or null when it is missing, too old or not one of ours. */
export function readBuilderHandoff(value, now) {
  if (!value || value.v !== 1 || !fresh(value.at, now)) {
    return null;
  }
  const handoff = { v: 1, at: value.at, skills: skillsOf(value.skills), jd: cleanJd(value.jd) };
  return handoff.skills.length || handoff.jd ? handoff : null;
}

export function makeLettersHandoff(jd, now) {
  return { v: 1, at: now, job: lettersJob(cleanJd(jd) ?? {}) };
}

/** A cold email job waiting for the Letters page, or null. */
export function readLettersHandoff(value, now) {
  const job = value?.job;
  if (!value || value.v !== 1 || !fresh(value.at, now) || !job || typeof job !== 'object') {
    return null;
  }
  const id = str(job.id, 48);
  const title = str(job.title, LIMITS.name);
  const company = str(job.company, LIMITS.name);
  return id && /^lay-[a-z0-9-]+$/.test(id) && title && company ? { v: 1, at: value.at, job: { id, title, company, skills: skillsOf(job.skills) } } : null;
}

/** The last messages of a chat that are well formed: `{ who: 'you' | 'lay', text, card? }`, newest `MAX_CHAT`. */
export function cleanChat(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const kept = [];
  for (const item of value) {
    const text = item && typeof item.text === 'string' ? item.text.slice(0, LIMITS.text) : '';
    if (!text || (item.who !== 'you' && item.who !== 'lay')) {
      continue;
    }
    const card = item.card && typeof item.card.subject === 'string' && typeof item.card.body === 'string'
      ? { subject: item.card.subject.slice(0, 200), body: item.card.body.slice(0, LIMITS.text) }
      : null;
    kept.push(card ? { who: item.who, text, card } : { who: item.who, text });
  }
  return kept.slice(-MAX_CHAT);
}

// ---------- one turn, one step ----------

export const HELP_REPLY = 'I can add skills you have learned to your resume, tailor it to a job description you paste, match your resume to a job, and draft a cold email. '
  + 'Try: "I learned Docker and Kubernetes, add them to my resume", then paste the job description under it.';

const action = (id, label, primary = false) => ({ id, label, primary });

/** What Lay AI offers after reading a job description on its own. */
function jdOnlyTurn(jd) {
  const asks = asked(jd);
  const head = `I read the job description: ${jobLabel(jd)}.`;
  const body = asks.length ? ` It asks for ${joinList(asks)}.` : ' I could not find specific skills in it.';
  return {
    strong: true,
    reply: `${head}${body} What should I do with it?`,
    actions: [action('update', 'Tailor my resume', true), action('match', 'Match my resume'), action('email', 'Draft a cold email')],
    payload: { skills: [], jd },
  };
}

const NEEDS_RESUME = 'You have no resume in the Builder yet, so I have nothing to work from. Start one there (upload or pick a template), then ask me again.';

/**
 * Lay AI's first answer to a message, or null when it is not one it claims.
 * `ctx`: `{ resume, jd, style, gmail, onBuilder, claim, applications }`; `jd` is the last job description Lay AI read,
 * `claim` is `all` (anywhere in the app) or `builder` (the Builder's own panel handles plain commands itself).
 * The answer is `{ strong, reply, actions: [{ id, label, primary }], payload, card? }`: a `strong` answer is
 * the agent's own work; a weak one (help, a link to a page) only fills in when the page has nothing better.
 */
export function agentTurn(text, ctx = {}) {
  const request = readRequest(text);
  const { intents } = request;
  const claimAll = ctx.claim !== 'builder';
  const jd = request.jd ?? ctx.jd ?? null;
  const updateJd = request.jd ?? (request.refersToJd ? ctx.jd ?? null : null);
  const pasted = request.jd !== null;
  const onBuilder = Boolean(ctx.onBuilder);

  const wantsUpdate = intents.has('update');
  const wantsEmail = intents.has('email');
  const wantsMatch = intents.has('match');
  const claimed = pasted || wantsEmail || (wantsMatch && jd) || (wantsUpdate && (request.how === 'told' || updateJd))
    || (claimAll && (wantsUpdate || wantsMatch || intents.has('rejections') || intents.has('go')));
  if (!claimed) {
    return null;
  }

  if (intents.has('go') && !pasted && !wantsUpdate && !wantsEmail) {
    return { strong: false, reply: `Opening ${PAGE_NAMES[request.target] ?? 'that page'}.`, actions: [action('go', `Open ${PAGE_NAMES[request.target] ?? 'it'}`, true)], payload: { href: request.target } };
  }
  if (intents.has('rejections') && !pasted && !wantsUpdate) {
    return { strong: false, reply: rejectionsSummary(ctx.applications ?? []), actions: [action('go', 'Open Applications', true)], payload: { href: 'applications.html' } };
  }
  if (!ctx.resume && (wantsUpdate || wantsEmail || wantsMatch || pasted)) {
    return { strong: true, reply: wantsUpdate && claimAll ? `${NEEDS_RESUME} I will keep what you asked and do it as soon as the Builder has a resume.` : NEEDS_RESUME, actions: wantsUpdate && claimAll ? [action('update', 'Open the Builder', true)] : [], payload: { skills: request.skills, jd } };
  }
  if (wantsUpdate) {
    const plan = planResumeUpdate(ctx.resume, { skills: request.skills, jd: updateJd }, ctx.style);
    if (plan.nothing) {
      const already = plan.already.length ? `${joinList(plan.already)} ${plan.already.length === 1 ? 'is' : 'are'} already in your Skills. ` : '';
      return { strong: true, reply: `${already}There is nothing to change yet. Tell me a skill you have learned, or paste a job description to tailor your resume for.`, actions: [], payload: {} };
    }
    return {
      strong: true,
      reply: planReply(plan, { onBuilder }),
      actions: [action('update', onBuilder ? 'Yes, do it' : 'Yes, open the Builder', true), action('later', 'Not now')],
      payload: { skills: request.skills, jd: updateJd },
    };
  }
  if (wantsEmail) {
    return emailTurn(ctx, jd);
  }
  if (wantsMatch) {
    return jd ? matchTurn(ctx.resume, jd) : { strong: true, reply: 'Paste the job description and I will match your resume to it.', actions: [], payload: {} };
  }
  if (pasted) {
    return jdOnlyTurn(jd);
  }
  return null;
}

function matchTurn(resume, jd) {
  const match = matchAgainst(resume, jd);
  return {
    strong: true,
    reply: matchReply(match),
    actions: match.total ? [action('email', 'Draft a cold email', true), action('done', 'No thanks')] : [],
    payload: { jd },
  };
}

/** What is still blank in a draft once the person's own details are filled in, as a sentence (or nothing). */
function blanksNote(draft, fill) {
  // Without a way to fill in the person's own details only [Company] can be judged; the rest is theirs to see.
  const same = fill ?? ((text) => text);
  const found = blanksIn(`${same(draft.subject)}\n${same(draft.body)}`);
  const blanks = fill === undefined ? found.filter((blank) => !blank.startsWith('{')) : found;
  return blanks.length ? ` Before you send, fill in ${joinList(blanks.map((b) => `${b} (${describeBlank(b)})`))}.` : '';
}

function emailTurn(ctx, jd) {
  if (!jd) {
    return { strong: true, reply: 'Paste the job description (or tell me the role and the company) and I will draft the email.', actions: [], payload: {} };
  }
  const draft = draftColdEmail(ctx.resume, jd);
  const note = blanksNote(draft, ctx.fill);
  return {
    strong: true,
    reply: `Here is a short cold email for ${jobLabel(jd)}. Nothing is sent: you choose what happens next.${note}`,
    card: { subject: draft.subject, body: draft.body },
    actions: [
      action('email-letters', 'Open in Letters to send', true),
      ctx.gmail ? action('email-draft', 'Save as a Gmail draft') : action('connect-gmail', 'Connect Gmail first'),
      action('done', 'Not now'),
    ],
    payload: { jd },
  };
}

/**
 * What happens when the person presses one of the answer's buttons: `{ reply, actions?, card?, payload?, resume?,
 * summary?, effect? }`. `effect` is something the page does: `{ type: 'navigate', href, handoff? }` where `handoff` is
 * `{ key: 'builder' | 'letters', value }` for the page to store first. A `resume` is the new resume the Builder
 * saves as one version named `summary`.
 */
export function agentStep(id, payload = {}, ctx = {}, now = Date.now()) {
  const jd = cleanJd(payload.jd) ?? ctx.jd ?? null;
  switch (id) {
    case 'update': {
      if (!ctx.onBuilder || !ctx.resume) {
        return {
          reply: ctx.resume ? 'Opening the Builder. I will make the change there, and you will see it in green.' : 'Opening the Builder. Start your resume there and I will make the change once it exists.',
          effect: { type: 'navigate', href: 'resume-builder.html', handoff: { key: 'builder', value: makeBuilderHandoff({ skills: payload.skills, jd }, now) } },
        };
      }
      const plan = planResumeUpdate(ctx.resume, { skills: payload.skills, jd }, ctx.style);
      if (plan.nothing) {
        return { reply: 'Your resume already has everything I would change, so I left it as it is.' };
      }
      const gap = gapSentence(plan.gap);
      return {
        reply: [doneReply(plan), gap].filter(Boolean).join(' '),
        resume: applyResumePlan(ctx.resume, plan),
        summary: planVersionName(plan),
        actions: jd && asked(jd).length ? [action('match', 'Match it to the job', true), action('later', 'Not now')] : [],
        payload: { jd },
      };
    }
    case 'match':
      if (!ctx.resume || !jd) {
        return { reply: 'I need a resume and a job description for that. Paste the job description and ask again.' };
      }
      return stripTurn(matchTurn(ctx.resume, jd));
    case 'email':
      if (!ctx.resume) {
        return { reply: NEEDS_RESUME };
      }
      return stripTurn(emailTurn(ctx, jd));
    case 'email-letters':
      if (!jd) {
        return { reply: 'I lost track of which job this was for. Paste the job description again.' };
      }
      return {
        reply: 'Opening Letters with the email ready. You add the address there and press Send, and nothing goes before that.',
        effect: { type: 'navigate', href: 'letters.html', handoff: { key: 'letters', value: makeLettersHandoff(jd, now) } },
      };
    case 'email-draft': {
      if (!ctx.resume || !jd) {
        return { reply: 'I lost track of which job this was for. Paste the job description again.' };
      }
      const draft = draftColdEmail(ctx.resume, jd);
      const fill = ctx.fill ?? ((text) => text);
      const made = buildMailRequest({
        provider: 'gmail', action: 'draft', to: '', subject: fill(draft.subject), body: fill(draft.body),
        attachments: [{ kind: 'resume', format: 'pdf' }, { kind: 'cover', format: 'pdf' }],
      }, ctx.resume.name);
      if (!made.ok) {
        return { reply: made.error };
      }
      return { reply: `${mailSummary(made.request, SAMPLE_GMAIL, { done: true })} Subject: ${made.request.subject} (Sample: the preview saves nothing in Gmail.)${blanksNote(draft, fill)}` };
    }
    case 'connect-gmail':
      return { reply: 'Opening Settings. Connect Gmail there, then ask me again.', effect: { type: 'navigate', href: 'settings.html' } };
    case 'go': {
      const href = Object.values(PAGES).includes(payload.href) ? payload.href : null;
      return href ? { reply: `Opening ${PAGE_NAMES[href] ?? 'it'}.`, effect: { type: 'navigate', href } } : { reply: 'I can only open pages of this app.' };
    }
    case 'later':
      return { reply: 'Okay, I left everything as it is.' };
    case 'done':
      return { reply: 'Okay.' };
    default:
      return { reply: 'I do not know that one.' };
  }
}

const stripTurn = ({ strong: _strong, ...rest }) => rest;
