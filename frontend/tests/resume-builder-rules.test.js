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

// ---------- rich text, toolbar, Classic, writing styles, suggest mode, cursor tips ----------

import {
  DEFAULT_FORMAT,
  MARKET_SAMPLE,
  applySuggestion,
  escapeMarkup,
  isRichPath,
  mergeSegments,
  normalizeFormat,
  parseInline,
  plainText,
  roleFromPrompt,
  safeHref,
  sentences,
  serializeSegments,
  styledSummary,
  suggestForRole,
  watchHint,
} from '../src/js/pages/resume-builder-rules.js';

test('formatting round-trips through the markup, typed characters stay literal', () => {
  const segments = [
    { text: 'Hi ' },
    { text: 'both', bold: true, italic: true },
    { text: ' C++ 5* snake_case a<b & R&D ' },
    { text: 'me', href: 'https://linkedin.com/in/jane', underline: true },
  ];
  const markup = serializeSegments(segments);

  assert.equal(markup, 'Hi <b><i>both</i></b> C++ 5* snake_case a&lt;b &amp; R&amp;D <a href="https://linkedin.com/in/jane"><u>me</u></a>');
  assert.deepEqual(parseInline(markup), segments);
  assert.equal(plainText(markup), 'Hi both C++ 5* snake_case a<b & R&D me');
});

test('parseInline drops unsafe links and survives broken markup', () => {
  assert.deepEqual(parseInline('<a href="javascript:alert(1)">x</a>'), [{ text: 'x' }]);
  assert.deepEqual(parseInline('<b>unclosed'), [{ text: 'unclosed', bold: true }]);
  assert.deepEqual(parseInline('stray</b> text'), [{ text: 'stray' }, { text: ' text' }]);
  assert.deepEqual(parseInline('<script>x</script>'), [{ text: '<script>x</script>' }], 'unknown tags are just text');
  assert.deepEqual(parseInline(''), []);
});

test('safeHref allows http(s), mailto and tel, and completes bare domains', () => {
  assert.equal(safeHref('linkedin.com/in/jane'), 'https://linkedin.com/in/jane');
  assert.equal(safeHref('www.example.com'), 'https://www.example.com');
  assert.equal(safeHref('mailto:a@b.co'), 'mailto:a@b.co');
  assert.equal(safeHref('https://x.y/z?q=1'), 'https://x.y/z?q=1');
  for (const bad of ['javascript:alert(1)', 'https://', 'data:text/html,x', 'a b.com', '"x".com', '']) {
    assert.equal(safeHref(bad), null, bad);
  }
});

test('escapeMarkup, mergeSegments and sentences', () => {
  assert.equal(escapeMarkup('<b> & '), '&lt;b&gt; &amp; ');
  assert.deepEqual(mergeSegments([{ text: 'a' }, { text: 'b' }, { text: 'c', bold: true }, { text: '' }]), [{ text: 'ab' }, { text: 'c', bold: true }]);
  assert.deepEqual(sentences('One <b>two</b>. Three 40%. <i>Four</i>.'), ['One <b>two</b>.', 'Three 40%.', '<i>Four</i>.']);
  assert.equal(isRichPath('summary'), true);
  assert.equal(isRichPath('experience.0.details'), true);
  assert.equal(isRichPath('name'), false);
  assert.equal(isRichPath('skills.2'), false);
});

test('normalizeFormat keeps known values and fills in the rest', () => {
  assert.deepEqual(normalizeFormat(null), DEFAULT_FORMAT);
  assert.deepEqual(normalizeFormat({ font: 'classic', size: 'xl', bullets: true, style: 'friendly' }), { ...DEFAULT_FORMAT, font: 'classic', bullets: true, style: 'friendly' });
});

test('the Classic template ranks first for the LaTeX look and is PDF only', () => {
  const [best] = suggestTemplates({ ...DEFAULT_ANSWERS, style: 'classic' });
  assert.equal(best.id, 'classic');
  assert.equal(best.pdfOnly, true);
});

test('writing styles change how Lay AI words the summary', () => {
  const skills = ['Java', 'Spring Boot', 'SQL'];
  assert.match(styledSummary('backend developer', skills, 'formal'), /^Backend developer with hands-on experience in Java, Spring Boot and SQL/);
  assert.equal(styledSummary('backend developer', skills, 'concise'), 'Backend developer: Java, Spring Boot, SQL. Reliable, well-tested software.');
  assert.match(styledSummary('backend developer', skills, 'friendly'), /^I'm a backend developer/);
  assert.match(styledSummary('backend developer', skills, 'beginner'), /checks that it works well\.$/);
  const concise = sampleLayReply('Rewrite my summary for a senior backend role', sampleResume(), 'concise');
  assert.match(concise.resume.summary, /^Senior backend developer: Java, Spring Boot, SQL\./);
});

test('suggest mode lists what a role asks for and never rewrites the resume by itself', () => {
  const resume = sampleResume();
  const reply = sampleLayReply('create me a resume for devops', resume);

  assert.equal(reply.resume, resume, 'nothing changes until the user adds a suggestion');
  assert.equal(reply.suggestion.role, 'DevOps Engineer');
  const skills = reply.suggestion.items.filter((i) => i.kind === 'skill');
  assert.deepEqual(skills.map((i) => i.skill), MARKET_SAMPLE.devops.skills.map(([s]) => s));
  assert.ok(skills.every((i) => i.status === 'open'), 'the sample resume has none of them');
  const summary = reply.suggestion.items.find((i) => i.kind === 'summary');
  assert.match(summary.after, /^DevOps Engineer with hands-on experience in Java, Spring Boot and SQL/);
  assert.match(summary.after, /40%/, 'keeps the real result from the resume');
  assert.ok(!/Docker|Kubernetes/.test(summary.after), 'never claims a skill the resume lacks');
});

test('suggest mode marks skills the resume has and where it hints at others', () => {
  const resume = applyEdit(sampleResume(), 'experience.0.details', 'Built the deploy pipeline for our services on AWS.');
  const { items } = suggestForRole('Make it fit a backend role', resume);
  const byName = Object.fromEntries(items.filter((i) => i.kind === 'skill').map((i) => [i.skill, i]));

  assert.equal(byName.Java.status, 'have');
  assert.equal(byName.SQL.status, 'have');
  assert.equal(byName.Docker.status, 'open');
  assert.equal(roleFromPrompt('Tailor this for SDE roles'), 'sde');
  assert.equal(suggestForRole('What is DevOps?', resume), null, 'a question about a role is not a request to fit it');
});

test('applySuggestion adds one skill or the new summary, once', () => {
  const resume = sampleResume();
  const withDocker = applySuggestion(resume, { kind: 'skill', skill: 'Docker' });
  assert.deepEqual(withDocker.skills.at(-1), 'Docker');
  assert.equal(applySuggestion(withDocker, { kind: 'skill', skill: 'docker' }), withDocker);
  assert.equal(applySuggestion(resume, { kind: 'summary', after: 'New.' }).summary, 'New.');
  assert.equal(resume.skills.length, 3, 'the original is untouched');
});

test('watchHint gives one short tip for the field being typed in', () => {
  assert.match(watchHint('summary', 'Backend developer.'), /number/);
  assert.equal(watchHint('summary', 'Cut response time by 40%.'), null);
  assert.match(watchHint('experience.0.details', 'Built things.'), /number/);
  assert.match(watchHint('experience.0.details', 'I was responsible for 3 services.'), /Start with what you did/);
  assert.match(watchHint('contact', 'jane@email.com'), /LinkedIn/);
  assert.equal(watchHint('contact', '<a href="https://linkedin.com/in/j">LinkedIn</a>'), null);
  assert.equal(watchHint('name', 'Jane'), null);
});

test('isSavedState accepts a saved format and rejects a broken one', () => {
  const history = createHistory(sampleResume(), { source: 'template', summary: 'Started', at: 1 });
  const saved = { step: 'editor', answers: DEFAULT_ANSWERS, fromUpload: false, templateId: 'classic', history, messages: [] };
  assert.equal(isSavedState({ ...saved, format: { font: 'classic' } }), true);
  assert.equal(isSavedState({ ...saved, format: null }), false);
});
