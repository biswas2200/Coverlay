import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ANSWERS,
  addVersion,
  answersSummary,
  applyEdit,
  canonicalSkill,
  createHistory,
  currentResume,
  diffResume,
  fieldLabel,
  isSavedState,
  joinList,
  normalizeText,
  relativeTime,
  restoreVersion,
  sampleLayReply,
  sampleResume,
  sectionLabel,
  suggestTemplates,
  versionsNewestFirst,
} from '../src/js/pages/resume-builder-rules.js';

const at = (minutesAgo, now = 1_000_000_000) => now - minutesAgo * 60_000;

test('applyEdit sets a nested field without touching the original', () => {
  const before = sampleResume();
  const after = applyEdit(before, 'experience.0.role', 'Senior Engineer, Acme Corp');

  assert.equal(after.experience[0].role, 'Senior Engineer, Acme Corp');
  assert.equal(before.experience[0].role, 'Software Engineer, Acme Corp');
  assert.notEqual(after, before);
});

test('applyEdit returns the same resume when nothing changes', () => {
  const resume = sampleResume();

  assert.equal(applyEdit(resume, 'name', resume.name), resume);
  assert.equal(applyEdit(resume, 'nope.0.x', 'y'), resume, 'unknown paths are ignored');
});

test('applyEdit on skills appends, renames, and removes an emptied skill', () => {
  const resume = sampleResume();
  const count = resume.skills.length;

  assert.deepEqual(applyEdit(resume, `skills.${count}`, 'Docker').skills.at(-1), 'Docker');
  assert.equal(applyEdit(resume, `skills.${count}`, ''), resume, 'an empty new chip adds nothing');
  assert.equal(applyEdit(resume, 'skills.0', 'Kotlin').skills[0], 'Kotlin');
  assert.equal(applyEdit(resume, 'skills.0', '').skills.length, count - 1);
});

test('diffResume lists changed fields and added or removed skills', () => {
  const before = sampleResume();
  const after = applyEdit(applyEdit(before, 'summary', 'Shorter.'), 'skills.1', '');
  const withDocker = applyEdit(after, `skills.${after.skills.length}`, 'Docker');

  const diff = diffResume(before, withDocker);

  assert.deepEqual(diff.fields, ['summary']);
  assert.deepEqual(diff.addedSkills, ['Docker']);
  assert.deepEqual(diff.removedSkills, [before.skills[1]]);
});

test('history numbers versions, tracks the current one, and lists newest first', () => {
  const resume = sampleResume();
  let history = createHistory(resume, { source: 'template', summary: 'Started from template Clean', at: at(10) });
  history = addVersion(history, applyEdit(resume, 'name', 'Jane D.'), { source: 'you', summary: 'You edited Name', at: at(5) });

  assert.equal(history.current, 2);
  assert.equal(currentResume(history).name, 'Jane D.');
  assert.deepEqual(versionsNewestFirst(history).map((v) => v.number), [2, 1]);
});

test('restoreVersion adds a new version with the old resume instead of deleting history', () => {
  const resume = sampleResume();
  let history = createHistory(resume, { source: 'template', summary: 'Started', at: at(10) });
  history = addVersion(history, applyEdit(resume, 'name', 'Changed'), { source: 'you', summary: 'You edited Name', at: at(5) });

  const restored = restoreVersion(history, 1, at(0));

  assert.equal(restored.versions.length, 3);
  assert.equal(restored.current, 3);
  assert.equal(currentResume(restored).name, resume.name);
  assert.equal(restored.versions[2].summary, 'Restored v1');
  assert.equal(restoreVersion(restored, 3, at(0)), restored, 'restoring the current version is a no-op');
  assert.equal(restoreVersion(restored, 99, at(0)), restored, 'an unknown version is a no-op');
});

test('sampleLayReply adds the skills it is asked for, with tidy casing, once', () => {
  const resume = sampleResume();

  const added = sampleLayReply('Add docker and kubernetes to my skills', resume);
  assert.deepEqual(added.resume.skills.slice(-2), ['Docker', 'Kubernetes']);
  assert.equal(added.reply, 'Done: added Docker and Kubernetes to Skills.');
  assert.equal(added.summary, 'Lay AI: added Docker, Kubernetes');

  const again = sampleLayReply('add Docker to my skills', added.resume);
  assert.equal(again.resume, added.resume);
  assert.match(again.reply, /already/);
});

test('sampleLayReply removes a skill and handles one it cannot find', () => {
  const resume = sampleResume();

  const removed = sampleLayReply('Remove SQL from my skills', resume);
  assert.ok(!removed.resume.skills.includes('SQL'));
  assert.equal(removed.summary, 'Lay AI: removed SQL');

  const missing = sampleLayReply('remove Cobol from my skills', resume);
  assert.equal(missing.resume, resume);
});

test('sampleLayReply shortens and rewrites the summary', () => {
  const resume = sampleResume();

  const shorter = sampleLayReply('Make my summary shorter', resume);
  assert.ok(shorter.resume.summary.split(' ').length < resume.summary.split(' ').length);
  assert.equal(shorter.summary, 'Lay AI: shortened Summary');

  const fit = sampleLayReply('Rewrite my summary for a senior backend role', resume);
  assert.match(fit.resume.summary, /^Senior backend developer with hands-on experience in Java, Spring Boot and SQL/);
  assert.equal(fit.reply, 'Updated your Summary for a senior backend role.');
});

test('sampleLayReply explains what it understands when it cannot help', () => {
  const resume = sampleResume();
  const reply = sampleLayReply('Write me a poem', resume);

  assert.equal(reply.resume, resume);
  assert.equal(reply.summary, null);
  assert.match(reply.reply, /Add Docker to my skills/);
});

test('suggestTemplates ranks three templates from the answers', () => {
  const simple = suggestTemplates(DEFAULT_ANSWERS);
  assert.equal(simple.length, 3);
  assert.equal(simple[0].id, 'clean');

  assert.equal(suggestTemplates({ ...DEFAULT_ANSWERS, style: 'academic', pages: 2 })[0].id, 'academic');
  assert.equal(suggestTemplates({ ...DEFAULT_ANSWERS, style: 'modern' })[0].id, 'modern');
  assert.equal(suggestTemplates({ ...DEFAULT_ANSWERS, level: 'student' })[0].id, 'compact');
});

test('answersSummary reads like the template page subtitle', () => {
  assert.equal(answersSummary({ role: 'Backend Developer', level: 'junior', style: 'simple', pages: 1 }), 'For Backend Developer · 1-3 yrs · simple · 1 page');
  assert.equal(answersSummary({ role: ' ', level: 'senior', style: 'modern', pages: 2 }), '3+ yrs · modern · 2 pages');
});

test('small helpers', () => {
  assert.equal(normalizeText('  a \n  b\t'), 'a b');
  assert.equal(joinList(['A']), 'A');
  assert.equal(joinList(['A', 'B', 'C']), 'A, B and C');
  assert.equal(canonicalSkill('  node.js '), 'Node.js');
  assert.equal(canonicalSkill('figma'), 'Figma');
  assert.equal(sectionLabel('experience.0.role'), 'Experience');
  assert.equal(fieldLabel('skills.3'), 'Skill');
  const now = 1_000_000_000;
  assert.equal(relativeTime(now - 10_000, now), 'now');
  assert.equal(relativeTime(at(5, now), now), '5 min ago');
  assert.equal(relativeTime(at(150, now), now), '2 h ago');
  assert.equal(relativeTime(at(60 * 30, now), now), 'yesterday');
  assert.equal(relativeTime(at(60 * 24 * 3, now), now), '3 days ago');
});

test('isSavedState accepts a saved builder and rejects junk', () => {
  const history = createHistory(sampleResume(), { source: 'template', summary: 'Started', at: 1 });
  const saved = { step: 'editor', answers: DEFAULT_ANSWERS, fromUpload: false, templateId: 'clean', history, messages: [] };

  assert.equal(isSavedState(saved), true);
  assert.equal(isSavedState({ ...saved, step: 'nope' }), false);
  assert.equal(isSavedState({ ...saved, history: null }), false, 'the editor needs a history');
  assert.equal(isSavedState({ ...saved, step: 'start', history: null, templateId: null }), true);
  assert.equal(isSavedState(null), false);
  assert.equal(isSavedState({ ...saved, history: { versions: [], current: 1 } }), false);
});
