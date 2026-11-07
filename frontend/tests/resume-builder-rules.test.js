import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ANSWERS,
  FONT_SIZE,
  HIDEABLE_SECTIONS,
  TEMPLATES,
  MARGIN_PRESETS,
  clampMargin,
  formatLength,
  fromMm,
  marginPreset,
  toMm,
  clampFontSize,
  fitRequest,
  fitToPages,
  pageHeightPx,
  pageUsage,
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
  resumeStats,
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
  MIN_TEXT_CONTRAST,
  TEXT_COLORS,
  applySuggestion,
  contrastOnWhite,
  escapeMarkup,
  isRichPath,
  mergeSegments,
  normalizeFormat,
  parseInline,
  plainText,
  roleFromPrompt,
  safeColor,
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

test('a text colour is stored as <font color="#rrggbb"> and comes back as the same colour', () => {
  const segments = [
    { text: 'Led ' },
    { text: 'payments', color: '#1d4ed8', bold: true },
    { text: ' and ' },
    { text: 'a site', color: '#b91c1c', href: 'https://example.com' },
  ];
  const markup = serializeSegments(segments);
  assert.equal(markup, 'Led <font color="#1d4ed8"><b>payments</b></font> and <a href="https://example.com"><font color="#b91c1c">a site</font></a>');
  assert.deepEqual(parseInline(markup), segments);
  assert.equal(plainText(markup), 'Led payments and a site');
  // Neighbours with the same colour join; different colours do not.
  assert.deepEqual(mergeSegments([{ text: 'a', color: '#1d4ed8' }, { text: 'b', color: '#1d4ed8' }, { text: 'c', color: '#b91c1c' }]),
    [{ text: 'ab', color: '#1d4ed8' }, { text: 'c', color: '#b91c1c' }]);
});

test('safeColor keeps only #rrggbb that can be read on white paper', () => {
  assert.equal(safeColor('#1D4ED8'), '#1d4ed8', 'lower-cased');
  assert.equal(safeColor('#a00'), '#aa0000', 'a short form is spelled out');
  assert.equal(safeColor(' #000000 '), '#000000');
  for (const refused of ['#ffffff', '#fff', '#eeeeee', '#cccccc', '#ffff00', 'red', 'rgb(0,0,0)', '#12345', '#1234567', 'url(x)', '"><b>', '', null, undefined]) {
    assert.equal(safeColor(refused), null, String(refused));
  }
});

test('every colour on offer is readable on white, and there are no repeats', () => {
  assert.equal(contrastOnWhite('#ffffff'), 1);
  assert.ok(Math.abs(contrastOnWhite('#000000') - 21) < 0.01);
  assert.equal(contrastOnWhite('blue'), 0);
  for (const { name, hex } of TEXT_COLORS) {
    assert.ok(contrastOnWhite(hex) >= MIN_TEXT_CONTRAST, `${name} ${hex} has contrast ${contrastOnWhite(hex).toFixed(2)}`);
    assert.equal(safeColor(hex), hex, name);
  }
  assert.equal(new Set(TEXT_COLORS.map((c) => c.hex)).size, TEXT_COLORS.length);
});

test('markup cannot hide text: a white or pale colour, or a colour that is not a hex, is dropped', () => {
  assert.deepEqual(parseInline('<font color="#ffffff">hidden</font>'), [{ text: 'hidden' }]);
  assert.deepEqual(parseInline('<font color="#fefefe"><b>pale</b></font>'), [{ text: 'pale', bold: true }]);
  assert.deepEqual(parseInline('<font color="red">named</font>'), [{ text: 'named' }]);
  assert.deepEqual(parseInline('<font color="#ffffff"><font color="#1d4ed8">x</font></font>'), [{ text: 'x', color: '#1d4ed8' }]);
  assert.equal(serializeSegments([{ text: 'x', color: '#ffffff' }]), 'x', 'saving drops an unreadable colour too');
  assert.equal(serializeSegments([{ text: 'x', color: 'javascript:1' }]), 'x');
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

test('resumeStats counts words and characters, ignoring formatting', () => {
  const resume = { name: 'Jane Doe', contact: 'a@b.co', summary: 'Built <b>fast</b> APIs.', experience: [], education: [], skills: ['Java', 'SQL'] };
  assert.deepEqual(resumeStats(resume), { words: 8, characters: 'Jane Doe a@b.co Built fast APIs. Java SQL'.length });
  assert.deepEqual(resumeStats({ ...resume, name: '', contact: '', summary: '', skills: [] }), { words: 0, characters: 0 });
});

test('the format keeps a font size in range and the new page settings, and drops junk', () => {
  assert.equal(normalizeFormat({ fontSize: 10.7 }).fontSize, 10.5);
  assert.equal(normalizeFormat({ fontSize: 99 }).fontSize, FONT_SIZE.max);
  assert.equal(normalizeFormat({ fontSize: 2 }).fontSize, FONT_SIZE.min);
  assert.equal(normalizeFormat({ fontSize: 'big' }).fontSize, FONT_SIZE.default);
  assert.equal(normalizeFormat({ fontSize: '' }).fontSize, FONT_SIZE.default);
  const set = normalizeFormat({ columns: 2, page: 'letter', unit: 'in', rules: true });
  assert.deepEqual([set.columns, set.page, set.unit, set.rules], [2, 'letter', 'in', true]);
  assert.deepEqual([normalizeFormat({ columns: 3 }).columns, normalizeFormat({ page: 'a0' }).page, normalizeFormat({ unit: 'furlong' }).unit], [1, 'a4', 'cm']);
  assert.equal(clampFontSize(8.2), 8);
});

// A stand-in for measuring the real editor: taller with bigger text, looser spacing, wider margins.
const fakeMeasure = (base) => (format) => {
  const spacing = { tight: 0.9, normal: 1, airy: 1.2 }[format.spacing];
  const average = (format.marginTop + format.marginBottom + format.marginLeft + format.marginRight) / 4;
  const margins = 0.88 + ((average - 12.7) / (19.1 - 12.7)) * 0.12; // 12.7 mm -> 0.88, 19.1 mm -> 1
  return base * (format.fontSize / 11) * spacing * margins;
};

test('fitToPages leaves a resume that already fits exactly as it is', () => {
  const result = fitToPages({}, 1, fakeMeasure(pageHeightPx('a4') * 0.8));
  assert.equal(result.fits, true);
  assert.deepEqual(result.changes, []);
  assert.equal(result.format.fontSize, 11);
});

test('fitToPages tightens spacing first, then margins, then text, and stops once it fits', () => {
  const page = pageHeightPx('a4');
  const spacingOnly = fitToPages({}, 1, fakeMeasure(page * 1.05));
  assert.equal(spacingOnly.fits, true);
  assert.deepEqual(spacingOnly.changes, ['tightened the line spacing']);
  assert.equal(spacingOnly.format.fontSize, 11);

  const withMargins = fitToPages({}, 1, fakeMeasure(page * 1.2));
  assert.equal(withMargins.fits, true);
  assert.ok(withMargins.format.marginTop < 19.1 && withMargins.format.marginLeft < 19.1, 'margins were narrowed');
  assert.equal(withMargins.format.fontSize, 11);

  const withText = fitToPages({}, 1, fakeMeasure(page * 1.35));
  assert.equal(withText.fits, true);
  assert.ok(withText.format.fontSize < 11 && withText.format.fontSize >= FONT_SIZE.fit);
  assert.match(withText.changes.join(' '), /reduced the text from 11 to/);
});

test('fitToPages never goes below the smallest readable size and says how far over it still is', () => {
  const result = fitToPages({}, 1, fakeMeasure(pageHeightPx('a4') * 2));
  assert.equal(result.fits, false);
  assert.equal(result.format.fontSize, FONT_SIZE.fit);
  assert.deepEqual([result.format.marginTop, result.format.marginBottom, result.format.marginLeft, result.format.marginRight], [12.7, 12.7, 12.7, 12.7]);
  assert.equal(result.format.spacing, 'tight');
  assert.ok(result.over > 0.3, `over ${result.over}`);
});

test('fitToPages never makes anything bigger, and a two-page limit gives twice the room', () => {
  const small = fitToPages({ fontSize: 9.5, spacing: 'tight', ...MARGIN_PRESETS.narrow }, 1, fakeMeasure(pageHeightPx('a4') * 1.5));
  assert.equal(small.fits, false);
  assert.equal(small.format.fontSize, 9.5);
  const two = fitToPages({}, 2, fakeMeasure(pageHeightPx('a4') * 1.5));
  assert.equal(two.fits, true);
  assert.deepEqual(two.changes, []);
});

test('fitToPages stops measuring after a handful of tries, whatever the content', () => {
  let calls = 0;
  fitToPages({ spacing: 'airy', ...MARGIN_PRESETS.wide, fontSize: 14 }, 1, (format) => { calls += 1; return fakeMeasure(1e9)(format); });
  assert.ok(calls <= 20, `${calls} measurements`);
});

test('pageUsage reports pages used and how far over the limit', () => {
  const page = pageHeightPx('letter');
  assert.deepEqual(pageUsage(page * 0.5, 'letter', 1), { used: 0.5, over: 0, fits: true });
  const over = pageUsage(page * 1.25, 'letter', 1);
  assert.equal(over.fits, false);
  assert.ok(Math.abs(over.over - 0.25) < 1e-9);
  assert.equal(pageUsage(page * 1.25, 'letter', 2).fits, true);
});

test('fitRequest spots "fit it on a page" but not "fit a role"', () => {
  assert.deepEqual(fitRequest('Fit my resume on one page'), { pages: 1 });
  assert.deepEqual(fitRequest('make it fit on 1 page please'), { pages: 1 });
  assert.deepEqual(fitRequest('squeeze everything into two pages'), { pages: 2 });
  assert.deepEqual(fitRequest('fit it to the page limit'), { pages: null });
  assert.deepEqual(fitRequest('fit all the contents in the resume'), { pages: null });
  assert.equal(fitRequest('Make it fit a DevOps role'), null);
  assert.equal(fitRequest('make my resume fit a senior backend job'), null);
  assert.equal(fitRequest('Add Docker to my skills'), null);
  assert.equal(fitRequest('Shorten my summary'), null);
  assert.equal(fitRequest(''), null);
});

test('margins are four separate values, kept in range, and an old single margin still loads', () => {
  const f = normalizeFormat({ marginTop: 10, marginBottom: 12.34, marginLeft: 99, marginRight: 1 });
  assert.deepEqual([f.marginTop, f.marginBottom, f.marginLeft, f.marginRight], [10, 12.3, 50, 5]);
  assert.deepEqual([normalizeFormat({}).marginTop, normalizeFormat({ marginTop: 'wide' }).marginTop], [19.1, 19.1]);
  const old = normalizeFormat({ margins: 'narrow' });
  assert.deepEqual([old.marginTop, old.marginLeft], [12.7, 12.7]);
  assert.equal(clampMargin(0), 5);
});

test('a margin set matches a preset, or is custom', () => {
  assert.equal(marginPreset(normalizeFormat({})), 'normal');
  assert.equal(marginPreset(normalizeFormat(MARGIN_PRESETS.wide)), 'wide');
  assert.equal(marginPreset(normalizeFormat(MARGIN_PRESETS.moderate)), 'moderate');
  assert.equal(marginPreset(normalizeFormat({ ...MARGIN_PRESETS.narrow, marginLeft: 15 })), 'custom');
});

test('lengths convert between millimetres, centimetres and inches', () => {
  assert.equal(fromMm(25.4, 'in'), 1);
  assert.equal(fromMm(25, 'cm'), 2.5);
  assert.equal(toMm(0.75, 'in'), 19.05);
  assert.equal(toMm(2, 'cm'), 20);
  assert.equal(formatLength(19.1, 'cm'), '1.9 cm');
  assert.equal(formatLength(19.05, 'in'), '0.75 in');
});

test('fitToPages only narrows margins that are wider than the step, never widens one', () => {
  const custom = { ...MARGIN_PRESETS.wide, marginLeft: 8, marginRight: 8 };
  const result = fitToPages(custom, 1, fakeMeasure(pageHeightPx('a4') * 1.1));
  assert.ok(result.format.marginLeft <= 8 && result.format.marginRight <= 8);
  assert.ok(result.format.marginTop <= 25.4);
});

test('hidden sections are kept to the ones that can be hidden, each once', () => {
  assert.deepEqual(normalizeFormat({}).hidden, []);
  assert.deepEqual(normalizeFormat({ hidden: ['skills', 'experience', 'skills', 'bogus', 'summary'] }).hidden, ['summary', 'skills']);
  assert.deepEqual(normalizeFormat({ hidden: 'skills' }).hidden, []);
  assert.notEqual(normalizeFormat({}).hidden, normalizeFormat({}).hidden, 'each format has its own list');
  assert.deepEqual(HIDEABLE_SECTIONS, ['summary', 'education', 'skills']);
});

test('every template says how many columns it has, and the two-column ones are offered', () => {
  const all = suggestTemplates(DEFAULT_ANSWERS, Infinity);
  assert.equal(all.length, TEMPLATES.length);
  assert.deepEqual(all.filter((t) => t.columns === 2).map((t) => t.id).sort(), ['executive', 'sidebar']);
  assert.ok(all.every((t) => [undefined, 1, 2].includes(t.columns) && t.margin >= 5 && t.fontSize >= 8));
  assert.equal(suggestTemplates(DEFAULT_ANSWERS).length, 3, 'the default is still three');
});

test('resumeStats counts the words in custom sections, tables included', () => {
  const resume = {
    name: 'A', contact: '', summary: '', experience: [], education: [], skills: [],
    extra: [{ title: 'Skills', body: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Java and SQL' }] }] }] }] }] }],
  };
  assert.equal(resumeStats(resume).words, 1 + 1 + 3);
});
