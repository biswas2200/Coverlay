// Cover letters and cold emails (preview, sample data). A draft is written the way Gemini would
// get it -- with placeholders ({user.name}, {other.person_1}) instead of personal details --
// and filled in on the user's own screen from the vault. Suggestions are offered one by one
// and only change the draft when the user adds them, using only facts already in the resume.
// DOM-free so tests/letters-rules.test.js can run it in Node.

import { escapeMarkup, joinList, plainText } from './resume-builder-rules.js';

// `words` is the most a good draft has; `minWords` the least (a cover letter is a page, a cold email a few lines).
/** @type {{ id: 'cover' | 'email', label: string, minWords?: number, words: number, credits: number }[]} */
export const LETTER_TYPES = [
  { id: 'cover', label: 'Cover letter', minWords: 250, words: 400, credits: 18 },
  { id: 'email', label: 'Cold email', words: 120, credits: 11 },
];

export const TEMPLATES = {
  cover: [
    { id: 'standard', label: 'Standard', blurb: 'Why this job, what you bring, a clear close.' },
    { id: 'career-change', label: 'Career change', blurb: 'Explains the move and what carries over.' },
    { id: 'fresher', label: 'Fresher', blurb: 'Projects and learning instead of years.' },
  ],
  email: [
    { id: 'referral', label: 'Referral ask', blurb: 'Short note to someone who works there.' },
    { id: 'hiring-manager', label: 'Hiring manager', blurb: 'Two lines on fit, one link, one ask.' },
    { id: 'follow-up', label: 'Follow-up', blurb: 'A polite nudge a week after applying.' },
  ],
};

export const SAMPLE_JOBS = [
  { id: 'job-1', title: 'Backend Engineer', company: 'Swiggy', skills: ['Java', 'Spring Boot', 'Kafka', 'SQL'] },
  { id: 'job-2', title: 'SDE II', company: 'Flipkart', skills: ['Java', 'System Design', 'SQL', 'Redis'] },
  { id: 'job-3', title: 'Platform Engineer', company: 'Razorpay', skills: ['Kubernetes', 'Terraform', 'Docker', 'Java'] },
];

export function templatesFor(type) {
  return TEMPLATES[type] ?? TEMPLATES.cover;
}

export function jobById(id) {
  return SAMPLE_JOBS.find((j) => j.id === id) ?? SAMPLE_JOBS[0];
}

/** Skills the job asks for that the resume has, and the ones it doesn't. */
export function skillFit(resume, job) {
  const have = new Set(resume.skills.map((s) => s.toLowerCase()));
  return {
    matched: job.skills.filter((s) => have.has(s.toLowerCase())),
    missing: job.skills.filter((s) => !have.has(s.toLowerCase())),
  };
}

function plain(markup) {
  return String(markup ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** The resume's result with a number in it ("cut their response time by 40%"), or null. */
export function strongestResult(resume) {
  const text = plain([resume.summary, ...resume.experience.map((e) => e.details)].join(' '));
  return text.split(/(?<=[.!?])\s+/).find((s) => /\d+\s*%|\d[\d,]*\s*(?:million|lakh|users|people|customers)/i.test(s))?.trim() ?? null;
}

/** "3 years" from "with 3 years of ...", or null. */
function years(resume) {
  return plain(resume.summary).match(/(\d+)\+?\s+years?/i)?.[0] ?? null;
}

/**
 * A draft as Gemini would write it (placeholders, no personal details):
 * `{ subject, greeting?, paragraphs: [string], signOff }`. A cover letter has a greeting; an email's
 * "Hi {other.person_1}," is part of its first paragraph.
 */
export function draftLetter({ type, templateId, resume, job }) {
  const fit = skillFit(resume, job);
  const skills = joinList(fit.matched.slice(0, 3)) || joinList(resume.skills.slice(0, 2));
  const experience = years(resume) ? `${years(resume)} of` : 'hands-on';
  if (type === 'email') {
    const subject = templateId === 'follow-up'
      ? `Following up: ${job.title} application`
      : `${job.title} at ${job.company}: {user.first_name}, backend developer`;
    const opening = {
      referral: `Hi {other.person_1}, I saw that you work at ${job.company}. I'm applying for the ${job.title} role and would be grateful for a referral if you think I'm a fit.`,
      'hiring-manager': `Hi {other.person_1}, I'm applying for the ${job.title} role at ${job.company}. I have ${experience} experience with ${skills}.`,
      'follow-up': `Hi {other.person_1}, I applied for the ${job.title} role last week and wanted to check if there is anything else you need from me.`,
    }[templateId] ?? '';
    const middle = templateId === 'follow-up'
      ? `I'm still very interested, and I'm happy to share more about my work with ${skills}.`
      : `My resume is attached, and my profile is at {user.link}.`;
    return { subject, paragraphs: [opening, middle, 'Thank you for your time.'], signOff: 'Best,\n{user.name}\n{user.phone}' };
  }
  // A cover letter runs about a page: an opening, what you did, how you fit the job, why this company, how you
  // work, and a close. It says only what the resume says; the rest is how a person would write to a stranger.
  const asked = joinList(job.skills);
  const have = fit.matched.length ? `I already work with ${joinList(fit.matched)}` : 'I work with backend tools every day';
  const learn = fit.missing.length ? `, and I am ready to learn ${joinList(fit.missing)} quickly` : '';
  const fitParagraph = `The ${job.title} role asks for ${asked}. ${have}${learn}. I enjoy the parts of the job that make a system easy to live with: clear interfaces, careful changes to the database, and notes that explain why a decision was made.`;
  const company = `What draws me to ${job.company} is the chance to work on a product that a great many people use, with engineers who care about how it is built. I would like to understand how your team makes decisions, what it has learned from its mistakes, and where I can be useful in my first months.`;
  const close = 'I would be glad to talk about how I can help. My resume is attached to this letter. Thank you for your time and for considering my application.';
  const lines = {
    standard: [
      `I am writing to apply for the ${job.title} role at ${job.company}. I'm a backend developer with ${experience} experience in ${skills}, and the work your team does is exactly what I want to do next. I would like to bring that experience to a team that builds things people rely on every day.`,
      `At {user.company}, I built and ran production services, and I'd bring the same care for reliable, well-tested software to ${job.company}. I am used to owning a service from the first design to the day it is running for real users, and to learning from what it does once it is live.`,
      fitParagraph,
      company,
      `I also want to work with people who are good at what they do and generous with what they know. I learn fastest by reading other people's code, asking questions in review and passing on what I find, and I would like to keep doing that at ${job.company}.`,
      close,
    ],
    'career-change': [
      `I am writing to apply for the ${job.title} role at ${job.company}. I'm moving into this field from my current work, and I bring ${experience} experience with ${skills}. I have made this move on purpose, and I would like to explain why it suits me and what I bring with me.`,
      `At {user.company}, I built and ran production services, and the habits I learned there carry straight over: owning a problem until it is solved, working with the people who use what I build, and being honest about what is not working yet.`,
      fitParagraph,
      company,
      `Changing fields means I have to prove myself, and I am comfortable with that. I would start by learning how your team works, asking plenty of questions and taking on small, clearly defined work first, so that I earn trust through what I deliver at ${job.company}.`,
      close,
    ],
    fresher: [
      `I am writing to apply for the ${job.title} role at ${job.company}. I'm a recent graduate of {user.college}, and I've built projects with ${skills}. I am looking for a team where I can learn from experienced engineers while doing real work.`,
      `During my time at {user.company}, I built and ran production services, and it taught me how much care reliable, well-tested software needs. In my studies and projects I learned to start small, test early and ask for help when I am stuck.`,
      fitParagraph,
      company,
      `I do not have years of experience yet, and I won't pretend otherwise. What I can offer is steady effort, curiosity and a habit of finishing what I start, and I would like to put those to work for ${job.company}.`,
      close,
    ],
  };
  return {
    subject: `${job.title}: application from {user.name}`,
    greeting: `Dear ${job.company} hiring team,`,
    paragraphs: lines[templateId] ?? lines.standard,
    signOff: 'Sincerely,\n{user.name}\n{user.email} · {user.phone}',
  };
}

/**
 * Suggestions for a draft, each added only if the user wants it:
 * `[{ id, label, text, paragraph }]` -- `text` is a sentence to add to paragraph `paragraph`.
 */
export function letterSuggestions({ type, resume, job }) {
  const items = [];
  const result = strongestResult(resume);
  if (result) {
    items.push({ id: 'result', label: 'Add your strongest result', text: result, paragraph: 1 });
  }
  const fit = skillFit(resume, job);
  if (fit.missing.length && type === 'cover') {
    items.push({
      id: 'learning',
      label: `Be honest about ${fit.missing[0]}`,
      text: `I haven't used ${fit.missing[0]} at work yet, and I'm learning it now.`,
      paragraph: 2,
    });
  }
  if (fit.matched.length > 3) {
    items.push({ id: 'skills', label: 'Name every matching skill', text: `You asked for ${joinList(fit.matched)}; I use all of them.`, paragraph: 0 });
  }
  return items;
}

/**
 * A template draft as the blocks the editor works on (rich-text markup, placeholders kept): the greeting if
 * there is one, the paragraphs, then the sign-off, which is one block of lines.
 */
export function toBlocks(letter) {
  return [letter.greeting, ...letter.paragraphs, letter.signOff].filter(Boolean).map(escapeMarkup);
}

/** Blocks with a suggestion's sentence added to its paragraph (a new array; once only). `greeting` shifts the index by one. */
export function addSuggestionToBlocks(blocks, item, greeting) {
  const at = item.paragraph + (greeting ? 1 : 0);
  return blocks.map((block, i) => (i === at && !plainText(block).includes(item.text) ? `${block} ${escapeMarkup(item.text)}` : block));
}

/** The draft with one suggestion added to its paragraph (a new object). */
export function addSuggestion(draft, item) {
  const paragraphs = draft.paragraphs.map((p, i) => (i === item.paragraph && !p.includes(item.text) ? `${p} ${item.text}` : p));
  return { ...draft, paragraphs };
}

/** The whole draft as one text (subject first), e.g. to copy or count. */
export function draftText(draft, { withSubject = true } = {}) {
  return [withSubject ? `Subject: ${draft.subject}` : null, draft.greeting, ...draft.paragraphs, draft.signOff].filter(Boolean).join('\n\n');
}

export function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter((w) => /\w/.test(w)).length;
}

/** "312 words · good length", or a nudge to cut or to say more. */
export function lengthNote(type, words) {
  const kind = LETTER_TYPES.find((t) => t.id === type) ?? LETTER_TYPES[0];
  if (words > kind.words) {
    return `${words} words · aim for ${kind.words} or fewer`;
  }
  if (kind.minWords && words < kind.minWords) {
    return `${words} words · a ${kind.label.toLowerCase()} usually runs ${kind.minWords} to ${kind.words}`;
  }
  return `${words} words · good length`;
}
