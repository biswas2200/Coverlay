import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseInline } from '../src/js/pages/resume-builder-rules.js';
import { knownValues } from '../src/js/pages/privacy-guard-rules.js';
import {
  MAX_PDF_BYTES,
  SAMPLE_LINKEDIN_PROFILE as PROFILE,
  fileProblem,
  foundItems,
  roleFrom,
  shortDates,
  shortDegree,
  toResume,
} from '../src/js/pages/linkedin-import-rules.js';

test('only a PDF under 5 MB is accepted', () => {
  assert.equal(fileProblem({ name: 'Profile.pdf', size: 120_000 }), null);
  assert.equal(fileProblem({ name: 'PROFILE.PDF', size: 1 }), null);
  assert.match(fileProblem({ name: 'Profile.docx', size: 1 }), /Choose a PDF/);
  assert.match(fileProblem({ name: 'big.pdf', size: MAX_PDF_BYTES + 1 }), /over 5 MB/);
  assert.match(fileProblem(null), /Choose the PDF/);
});

test('LinkedIn dates and degrees are shortened the way the Builder writes them', () => {
  assert.equal(shortDates('June 2022 - Present'), 'Jun 2022 - now');
  assert.equal(shortDates('January 2022 - May 2022'), 'Jan 2022 - May 2022');
  assert.equal(shortDegree('Bachelor of Technology - BTech, Computer Engineering'), 'BTech Computer Engineering');
  assert.equal(shortDegree('MBA'), 'MBA');
});

test('"What we found" lists every section, contact excluded', () => {
  const items = foundItems(PROFILE);
  assert.deepEqual(items.map((i) => i.id), ['about', 'experience-0', 'experience-1', 'education-0', 'skills']);
  assert.equal(items[1].meta, 'Jun 2022 - now');
  assert.equal(items.at(-1).label, 'Java, Spring Boot, Apache Kafka');
});

test('the import is a Builder resume with the profile link as a link', () => {
  const resume = toResume(PROFILE);
  assert.equal(resume.name, 'Riya Kapoor');
  assert.equal(resume.experience.length, 2);
  assert.equal(resume.experience[0].role, 'Backend Engineer, Finlo');
  assert.equal(resume.education[0].degree, 'BTech Computer Engineering, College of Engineering Pune');
  assert.deepEqual(resume.skills, ['Java', 'Spring Boot', 'Apache Kafka']);
  const link = parseInline(resume.contact).find((segment) => segment.href);
  assert.equal(link.href, 'https://www.linkedin.com/in/riya-kapoor-sample');
  assert.equal(link.text, 'linkedin.com/in/riya-kapoor-sample');
  assert.match(resume.contact, /^riya\.kapoor@example\.com \| Pune \| /);
});

test('unticked items stay out, and the headline stands in for a missing summary', () => {
  const resume = toResume(PROFILE, ['experience-1']);
  assert.equal(resume.summary, 'Backend Engineer at Finlo | Java, Spring Boot, Kafka');
  assert.deepEqual(resume.experience.map((e) => e.role), ['Software Engineering Intern, Kite Labs']);
  assert.deepEqual(resume.education, []);
  assert.deepEqual(resume.skills, []);
});

test('markup characters in a profile are kept as text, not tags', () => {
  const resume = toResume({ ...PROFILE, about: 'I like <b>bold</b> & C++' });
  assert.equal(resume.summary, 'I like &lt;b&gt;bold&lt;/b&gt; &amp; C++');
  assert.deepEqual(parseInline(resume.summary), [{ text: 'I like <b>bold</b> & C++' }]);
});

test('the privacy guard knows the imported name and email', () => {
  const values = knownValues(toResume(PROFILE));
  assert.equal(values['user.name'], 'Riya Kapoor');
  assert.equal(values['user.email'], 'riya.kapoor@example.com');
  assert.equal(roleFrom(PROFILE), 'Backend Engineer');
});
