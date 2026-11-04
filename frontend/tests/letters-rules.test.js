import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SAMPLE_JOBS, addSuggestion, draftLetter, draftText, lengthNote, letterSuggestions, skillFit, strongestResult, templatesFor, wordCount } from '../src/js/pages/letters-rules.js';
import { guardText, knownValues, resolveText } from '../src/js/pages/privacy-guard-rules.js';
import { sampleResume } from '../src/js/pages/resume-builder-rules.js';

const resume = sampleResume();
const job = SAMPLE_JOBS[0];

test('every template drafts with placeholders, never the real personal details', () => {
  for (const type of ['cover', 'email']) {
    for (const template of templatesFor(type)) {
      const text = draftText(draftLetter({ type, templateId: template.id, resume, job }));
      assert.ok(!/Jane|jane@email\.com|98765|Acme|VIT/.test(text), `${type}/${template.id}: ${text}`);
      assert.match(text, /\{user\.(?:name|first_name)\}/);
    }
  }
});

test('the draft is filled in from the vault on the user\'s screen', () => {
  const draft = draftLetter({ type: 'email', templateId: 'referral', resume, job });
  const filled = resolveText(draftText(draft), { ...knownValues(resume), 'other.person_1': 'Priya' });
  assert.match(filled, /^Subject: Backend Engineer at Swiggy: Jane, backend developer/);
  assert.match(filled, /Hi Priya, I saw that you work at Swiggy/);
  assert.match(filled, /Best,\nJane Doe\n\+91 98765 43210$/);
});

test('suggestions use only facts from the resume and are added once', () => {
  assert.equal(strongestResult(resume), 'Built payment APIs used by 2 million people and cut their response time by 40%.');
  const fit = skillFit(resume, job);
  assert.deepEqual(fit, { matched: ['Java', 'Spring Boot', 'SQL'], missing: ['Kafka'] });
  const items = letterSuggestions({ type: 'cover', resume, job });
  assert.deepEqual(items.map((i) => i.id), ['result', 'learning']);
  assert.match(items[1].text, /haven't used Kafka at work yet/, 'honest about what is missing');
  const draft = draftLetter({ type: 'cover', templateId: 'standard', resume, job });
  const once = addSuggestion(draft, items[0]);
  assert.equal(addSuggestion(once, items[0]).paragraphs[1], once.paragraphs[1]);
});

test('an edited paragraph goes back through the guard', () => {
  const vault = { ...knownValues(resume), 'other.person_1': 'Priya' };
  const stored = guardText('Thanks Priya, I am Jane Doe from VIT.', vault).stored;
  assert.equal(stored, 'Thanks {other.person_1}, I am {user.name} from {user.college}.');
});

test('length notes', () => {
  assert.equal(wordCount('one two, three!'), 3);
  assert.equal(lengthNote('email', 90), '90 words · good length');
  assert.equal(lengthNote('email', 130), '130 words · aim for 120 or fewer');
});
