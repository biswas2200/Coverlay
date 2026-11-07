import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LETTER_TYPES, SAMPLE_JOBS, addSuggestion, draftLetter, draftText, lengthNote, letterSuggestions, skillFit, strongestResult, templatesFor, wordCount } from '../src/js/pages/letters-rules.js';
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

test('a cover letter is about a page: every template and job writes 250 to 400 words in six paragraphs, with a greeting', () => {
  const values = knownValues(resume);
  for (const aJob of SAMPLE_JOBS) {
    for (const template of templatesFor('cover')) {
      const letter = draftLetter({ type: 'cover', templateId: template.id, resume, job: aJob });
      const filled = resolveText(draftText(letter, { withSubject: false }), values);
      const where = `${aJob.company} / ${template.id}`;
      assert.ok(wordCount(filled) >= 250 && wordCount(filled) <= 400, `${where}: ${wordCount(filled)} words`);
      assert.equal(letter.paragraphs.length, 6, where);
      assert.equal(letter.greeting, `Dear ${aJob.company} hiring team,`, where);
      assert.match(lengthNote('cover', wordCount(filled)), /good length$/, where);
      assert.ok(letter.paragraphs.every((p) => p.length > 60), `${where}: no one-line paragraphs`);
    }
  }
});

test('a cold email stays short, and its draft has no greeting field (the first paragraph says hello)', () => {
  for (const template of templatesFor('email')) {
    const letter = draftLetter({ type: 'email', templateId: template.id, resume, job });
    assert.equal(letter.greeting, undefined);
    assert.ok(wordCount(resolveText(draftText(letter, { withSubject: false }), knownValues(resume))) <= 120, template.id);
  }
});

test('the cover letter length note names the usual range, and the greeting is part of the text', () => {
  assert.equal(lengthNote('cover', 312), '312 words · good length');
  assert.equal(lengthNote('cover', 180), '180 words · a cover letter usually runs 250 to 400');
  assert.equal(lengthNote('cover', 450), '450 words · aim for 400 or fewer');
  assert.deepEqual(LETTER_TYPES.map((t) => [t.id, t.minWords ?? null, t.words]), [['cover', 250, 400], ['email', null, 120]]);
  const letter = draftLetter({ type: 'cover', templateId: 'standard', resume, job });
  assert.match(draftText(letter, { withSubject: false }), /^Dear Swiggy hiring team,\n\n/);
});

test('the honesty suggestion goes into the paragraph about the skills the job asks for', () => {
  const learning = letterSuggestions({ type: 'cover', resume, job }).find((i) => i.id === 'learning');
  assert.equal(learning.paragraph, 2);
  const letter = draftLetter({ type: 'cover', templateId: 'standard', resume, job });
  assert.match(letter.paragraphs[2], /^The Backend Engineer role asks for/);
  assert.match(addSuggestion(letter, learning).paragraphs[2], /haven't used Kafka at work yet/);
});
