// LinkedIn import for the Resume Builder (preview, sample data). The user saves their own profile
// as a PDF (LinkedIn: Me -> View profile -> More -> Save to PDF) and picks what to bring over.
// We never scrape LinkedIn, and its profile API is open only to approved partners. The real app
// reads the PDF on the server like a resume upload; this preview uses SAMPLE_LINKEDIN_PROFILE,
// which has the sections LinkedIn's PDF has. Name, email and profile link go on the resume and
// stay in the account; Lay AI sees placeholders for them (privacy-guard-rules.js).
// DOM-free so tests/linkedin-import-rules.test.js can run it in Node.

import { canonicalSkill, escapeMarkup, normalizeText } from './resume-builder-rules.js';

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/** A profile as LinkedIn's "Save to PDF" lays it out. Fictional person, sample data. */
export const SAMPLE_LINKEDIN_PROFILE = {
  name: 'Riya Kapoor',
  headline: 'Backend Engineer at Finlo | Java, Spring Boot, Kafka',
  location: 'Pune, Maharashtra, India',
  email: 'riya.kapoor@example.com',
  profileUrl: 'www.linkedin.com/in/riya-kapoor-sample',
  about:
    'Backend engineer who builds payment systems. I moved settlement jobs to Kafka and cut failed payouts by 30%, and I like code that is easy to read.',
  topSkills: ['Java', 'Spring Boot', 'Apache Kafka'],
  experience: [
    {
      title: 'Backend Engineer', company: 'Finlo', dates: 'June 2022 - Present', duration: '2 years 6 months',
      description: 'Built the refunds service in Java and Spring Boot. Moved settlement jobs to Kafka and cut failed payouts by 30%.',
    },
    {
      title: 'Software Engineering Intern', company: 'Kite Labs', dates: 'January 2022 - May 2022', duration: '5 months',
      description: 'Wrote REST APIs and their tests for an internal admin tool.',
    },
  ],
  education: [{ school: 'College of Engineering Pune', degree: 'Bachelor of Technology - BTech, Computer Engineering', dates: '2018 - 2022' }],
};

/** Why a chosen file can't be used, or null. Only the name and size are read in the preview. */
export function fileProblem(file) {
  if (!file) {
    return 'Choose the PDF you saved from LinkedIn.';
  }
  if (!/\.pdf$/i.test(file.name ?? '')) {
    return 'Choose a PDF: LinkedIn saves your profile as a .pdf file.';
  }
  if (file.size > MAX_PDF_BYTES) {
    return 'That file is over 5 MB. A LinkedIn profile PDF is usually under 1 MB.';
  }
  return null;
}

/** "Jun 2022 - now" for LinkedIn's "June 2022 - Present". */
export function shortDates(dates) {
  return normalizeText(dates)
    .replace(/\bPresent\b/i, 'now')
    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, (month) => month.slice(0, 3));
}

/** "BTech Computer Engineering" for "Bachelor of Technology - BTech, Computer Engineering". */
export function shortDegree(degree) {
  const text = normalizeText(degree);
  const short = text.includes(' - ') ? text.split(' - ').slice(1).join(' - ') : text;
  return short.replace(/,\s*/, ' ');
}

/** What the review step lists, each with a checkbox (all on by default). Contact is not a choice. */
export function foundItems(profile) {
  return [
    profile.about ? { id: 'about', group: 'About', label: profile.about } : null,
    ...profile.experience.map((job, i) => ({
      id: `experience-${i}`, group: 'Experience', label: `${job.title}, ${job.company}`, meta: shortDates(job.dates),
    })),
    ...profile.education.map((school, i) => ({
      id: `education-${i}`, group: 'Education', label: `${shortDegree(school.degree)}, ${school.school}`, meta: school.dates,
    })),
    profile.topSkills.length ? { id: 'skills', group: 'Top skills', label: profile.topSkills.map(canonicalSkill).join(', ') } : null,
  ].filter(Boolean);
}

/** The profile link as the builder's link markup, shown without "https://www.". */
function profileLink(url) {
  const bare = normalizeText(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  return bare ? `<a href="https://www.${escapeMarkup(bare)}">${escapeMarkup(bare)}</a>` : '';
}

/**
 * The Builder resume from a profile and the chosen item ids. Without "About" the headline is the
 * summary, so the summary is never empty. The city is the first part of LinkedIn's location.
 */
export function toResume(profile, chosen = foundItems(profile).map((item) => item.id)) {
  const keep = new Set(chosen);
  const city = normalizeText(profile.location).split(',')[0];
  return {
    name: normalizeText(profile.name),
    contact: [escapeMarkup(normalizeText(profile.email)), escapeMarkup(city), profileLink(profile.profileUrl)].filter(Boolean).join(' | '),
    summary: escapeMarkup(normalizeText(keep.has('about') && profile.about ? profile.about : profile.headline)),
    experience: profile.experience
      .map((job, i) => (keep.has(`experience-${i}`)
        ? { role: escapeMarkup(`${job.title}, ${job.company}`), dates: shortDates(job.dates), details: escapeMarkup(normalizeText(job.description)) }
        : null))
      .filter(Boolean),
    education: profile.education
      .map((school, i) => (keep.has(`education-${i}`) ? { degree: escapeMarkup(`${shortDegree(school.degree)}, ${school.school}`), dates: school.dates } : null))
      .filter(Boolean),
    skills: keep.has('skills') ? profile.topSkills.map(canonicalSkill) : [],
  };
}

/** The role the template step suggests from: the latest job title. */
export function roleFrom(profile) {
  return normalizeText(profile.experience[0]?.title ?? '').slice(0, 80);
}
