// Cover letters and cold emails (preview, sample data). A draft is written the way Gemini would
// get it -- with placeholders ({user.name}, {other.person_1}) instead of personal details --
// and filled in on the user's own screen from the vault. Suggestions are offered one by one
// and only change the draft when the user adds them, using only facts already in the resume.
// DOM-free so tests/letters-rules.test.js can run it in Node.

import { joinList } from './resume-builder-rules.js';

export const LETTER_TYPES = [
  { id: 'cover', label: 'Cover letter', words: 250, credits: 18 },
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
 * `{ subject, paragraphs: [string], signOff }`.
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
  const openings = {
    standard: `I'm applying for the ${job.title} role at ${job.company}. I'm a backend developer with ${experience} experience in ${skills}, and the work your team does is exactly what I want to do next.`,
    'career-change': `I'm applying for the ${job.title} role at ${job.company}. I'm moving into this field from my current work, and I bring ${experience} experience with ${skills}.`,
    fresher: `I'm applying for the ${job.title} role at ${job.company}. I'm a recent graduate of {user.college}, and I've built projects with ${skills}.`,
  };
  return {
    subject: `${job.title}: application from {user.name}`,
    paragraphs: [
      openings[templateId] ?? openings.standard,
      `At {user.company}, I built and ran production services, and I'd bring the same care for reliable, well-tested software to ${job.company}.`,
      `I'd be glad to talk about how I can help. Thank you for considering my application.`,
    ],
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
      paragraph: 1,
    });
  }
  if (fit.matched.length > 3) {
    items.push({ id: 'skills', label: 'Name every matching skill', text: `You asked for ${joinList(fit.matched)}; I use all of them.`, paragraph: 0 });
  }
  return items;
}

/** The draft with one suggestion added to its paragraph (a new object). */
export function addSuggestion(draft, item) {
  const paragraphs = draft.paragraphs.map((p, i) => (i === item.paragraph && !p.includes(item.text) ? `${p} ${item.text}` : p));
  return { ...draft, paragraphs };
}

/** The whole draft as one text (subject first), e.g. to copy or count. */
export function draftText(draft, { withSubject = true } = {}) {
  return [withSubject ? `Subject: ${draft.subject}` : null, ...draft.paragraphs, draft.signOff].filter(Boolean).join('\n\n');
}

export function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter((w) => /\w/.test(w)).length;
}

/** "182 words · good length" or a nudge to cut. */
export function lengthNote(type, words) {
  const limit = LETTER_TYPES.find((t) => t.id === type)?.words ?? 250;
  return words <= limit ? `${words} words · good length` : `${words} words · aim for ${limit} or fewer`;
}
