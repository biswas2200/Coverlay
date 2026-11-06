import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffResume, sampleResume } from '../src/js/pages/resume-builder-rules.js';
import { docToPlainText, listFields, newSection, readingNotes, resumeFromDoc, resumeToDoc } from '../src/js/pages/resume-doc.js';

const roundTrip = (resume, options) => resumeFromDoc(resumeToDoc(resume, options), resume);

test('a resume survives the trip into the editor document and back unchanged', () => {
  const resume = sampleResume();
  assert.deepEqual(roundTrip(resume), resume);
  assert.deepEqual(roundTrip(resume, { bullets: true }), resume);
});

test('formatting becomes marks and comes back as the same markup', () => {
  const resume = sampleResume();
  resume.summary = 'Led <b>payments</b> work, see <a href="https://example.com/x">my notes</a> and <i><u>more</u></i>.';
  const doc = resumeToDoc(resume);
  const summary = doc.content[1].content[0];
  assert.deepEqual(summary.content[1], { type: 'text', text: 'payments', marks: [{ type: 'bold' }] });
  assert.deepEqual(summary.content[3].marks, [{ type: 'link', attrs: { href: 'https://example.com/x' } }]);
  assert.equal(resumeFromDoc(doc, resume).summary, resume.summary);
});

test('markup written in another tag order is not counted as an edit', () => {
  const resume = sampleResume();
  resume.summary = 'A <i><b>bold italic</b></i> word.';
  const back = roundTrip(resume);
  assert.equal(back.summary, resume.summary);
  assert.deepEqual(diffResume(resume, back), { fields: [], addedSkills: [], removedSkills: [] });
});

test('typing in the document shows up as a change to exactly that field', () => {
  const resume = sampleResume();
  const doc = resumeToDoc(resume);
  doc.content[0].content[0] = { type: 'name', content: [{ type: 'text', text: 'Jane  Q. Doe' }] };
  const after = resumeFromDoc(doc, resume);
  assert.equal(after.name, 'Jane Q. Doe');
  assert.deepEqual(diffResume(resume, after).fields, ['name']);
});

test('bullets turn the details into one item per sentence and join them back', () => {
  const resume = sampleResume();
  resume.experience[0].details = 'Built the payment APIs. Cut response time by 40%. Mentored two juniors.';
  const doc = resumeToDoc(resume, { bullets: true });
  const bullets = doc.content[2].content[0].content[1];
  assert.equal(bullets.type, 'bullets');
  assert.equal(bullets.content.length, 3);
  assert.deepEqual(roundTrip(resume, { bullets: true }), resume);
  // Adding a bullet in the editor adds a sentence to the field.
  bullets.content.push({ type: 'bullet', content: [{ type: 'text', text: 'Ran the on-call rota.' }] });
  assert.equal(resumeFromDoc(doc, resume).experience[0].details, `${resume.experience[0].details} Ran the on-call rota.`);
});

test('skills follow the list: new ones are added and emptied ones are dropped', () => {
  const resume = sampleResume();
  const doc = resumeToDoc(resume);
  const list = doc.content[4].content[0];
  list.content.push({ type: 'skill', content: [{ type: 'text', text: '  Docker ' }] }, { type: 'skill' });
  list.content.splice(1, 1); // "Spring Boot" removed
  assert.deepEqual(resumeFromDoc(doc, resume).skills, ['Java', 'SQL', 'Docker']);
});

test('a resume with no jobs or schools stays that way while the blank rows are untouched', () => {
  const resume = { ...sampleResume(), experience: [], education: [] };
  const doc = resumeToDoc(resume);
  assert.equal(doc.content[2].content.length, 1);
  const back = resumeFromDoc(doc, resume);
  assert.deepEqual(back.experience, []);
  assert.deepEqual(back.education, []);
});

test('listFields names every block with the path the page uses', () => {
  const resume = sampleResume();
  resume.experience.push({ role: 'Intern, Beta Ltd', dates: '2020', details: 'Wrote tests.' });
  const paths = listFields(resumeToDoc(resume)).map((field) => field.path);
  assert.deepEqual(paths, [
    'name', 'contact', 'summary',
    'experience.0.role', 'experience.0.dates', 'experience.0.details',
    'experience.1.role', 'experience.1.dates', 'experience.1.details',
    'education.0.degree', 'education.0.dates',
    'skills.0', 'skills.1', 'skills.2',
  ]);
  const withBullets = listFields(resumeToDoc(resume, { bullets: true })).map((field) => field.path);
  assert.deepEqual(withBullets, paths);
});

test('pasted or odd link marks are cleaned: only safe addresses are kept', () => {
  const resume = sampleResume();
  const doc = resumeToDoc(resume);
  doc.content[1].content[0] = {
    type: 'summary',
    content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
  };
  assert.equal(resumeFromDoc(doc, resume).summary, 'click');
});

test('two columns put the same fields in a main and a side column, with the same paths', () => {
  const resume = sampleResume();
  resume.experience.push({ role: 'Intern, Beta Ltd', dates: '2020', details: 'Wrote tests.' });
  const doc = resumeToDoc(resume, { columns: 2 });
  assert.deepEqual(doc.content.map((node) => node.type), ['header', 'columns']);
  const [main, side] = doc.content[1].content;
  assert.deepEqual(main.content.map((node) => node.type), ['summarySection', 'experienceSection']);
  assert.deepEqual(side.content.map((node) => node.type), ['educationSection', 'skillsSection']);
  assert.deepEqual(listFields(doc).map((field) => field.path), listFields(resumeToDoc(resume)).map((field) => field.path));
  assert.deepEqual(resumeFromDoc(doc, resume), resume);
  assert.deepEqual(resumeFromDoc(resumeToDoc(resume, { columns: 2, bullets: true }), resume), resume);
});

const withSection = (kind, columns) => ({ ...sampleResume(), extra: [newSection(kind, columns)] });

test('a custom table section goes into the document after the skills, and comes back untouched', () => {
  const resume = withSection('table', 2);
  const doc = resumeToDoc(resume);
  assert.deepEqual(doc.content.map((node) => node.type), ['header', 'summarySection', 'experienceSection', 'educationSection', 'skillsSection', 'customSection']);
  const [title, table] = doc.content[5].content;
  assert.equal(title.type, 'sectionTitle');
  assert.equal(table.type, 'table');
  assert.equal(table.attrs.borders, 'none', 'new tables hide their borders, like a Word table set to no borders');
  assert.equal(table.content[0].content[0].type, 'tableHeader');
  assert.deepEqual(resumeFromDoc(doc, resume), resume);
  assert.equal(resumeFromDoc(doc, resume).extra[0], resume.extra[0], 'an untouched section is the same object, so it is not an edit');
});

test('two columns keep the custom sections in the main column', () => {
  const resume = withSection('bullets');
  const doc = resumeToDoc(resume, { columns: 2 });
  const [main, side] = doc.content[1].content;
  assert.deepEqual(main.content.map((node) => node.type), ['summarySection', 'experienceSection', 'customSection']);
  assert.deepEqual(side.content.map((node) => node.type), ['educationSection', 'skillsSection']);
  assert.deepEqual(resumeFromDoc(doc, resume), resume);
});

test('editing a table cell changes the section; the other fields stay put', () => {
  const resume = withSection('table', 3);
  const doc = resumeToDoc(resume);
  const cell = doc.content[5].content[1].content[1].content[0]; // the first body cell
  cell.content = [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Java' }] }] }] }];
  const after = resumeFromDoc(doc, resume);
  assert.notDeepEqual(after.extra, resume.extra);
  assert.equal(diffResume(resume, after).extraChanged, true);
  assert.deepEqual(diffResume(resume, after).fields, []);
  assert.equal(diffResume(resume, resume).extraChanged, undefined);
});

test('a cell written with or without the default attributes counts as the same', () => {
  const resume = withSection('table', 2);
  const doc = resumeToDoc(resume);
  for (const row of doc.content[5].content[1].content) {
    for (const cell of row.content) {
      delete cell.attrs; // the editor may leave out colspan 1, rowspan 1, colwidth null
    }
  }
  assert.equal(resumeFromDoc(doc, resume).extra[0], resume.extra[0]);
});

test('the section title is a field of its own and sections can be renamed or removed', () => {
  const resume = withSection('text');
  const doc = resumeToDoc(resume);
  assert.deepEqual(listFields(doc).map((field) => field.path).slice(-2), ['skills.2', 'custom.0']);
  doc.content[5].content[0] = { type: 'sectionTitle', content: [{ type: 'text', text: '  Projects ' }] };
  assert.equal(resumeFromDoc(doc, resume).extra[0].title, 'Projects');
  doc.content.pop();
  assert.deepEqual(resumeFromDoc(doc, resume).extra, []);
  assert.equal(resumeFromDoc(resumeToDoc(sampleResume()), sampleResume()).extra, undefined, 'a resume without sections gets no extra key');
});

test('the plain-text reading order lists the header, sections, bullets and tables the way a parser meets them', () => {
  const resume = withSection('table', 2);
  const body = resume.extra[0].body[0];
  body.content[1].content[0].content = [{ type: 'bulletList', content: [
    { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Java' }] }] },
    { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SQL' }] }] },
  ] }];
  body.content[1].content[1].content = [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Teamwork' }] }] }] }];
  const text = docToPlainText(resumeToDoc(resume));
  assert.match(text, /^Jane Doe\njane@email\.com/);
  assert.match(text, /\nSUMMARY\nBackend developer/);
  assert.match(text, /Software Engineer, Acme Corp \| 2021 - now\nBuilt and ran/);
  assert.match(text, /\nSKILLS\n(?:Java, Spring Boot, SQL)\n/);
  assert.match(text, /\nSKILLS\nTechnical skills \| Soft skills\nJava; SQL \| Teamwork$/);
  const two = docToPlainText(resumeToDoc(resume, { columns: 2 }));
  assert.ok(two.indexOf('EXPERIENCE') < two.indexOf('EDUCATION'), 'the main column comes before the side column');
  assert.ok(two.indexOf('TECHNICAL SKILLS') === -1);
});

test('reading notes warn about columns and tables, and bless a plain one-column resume', () => {
  assert.match(readingNotes(resumeToDoc(sampleResume()))[0], /safest layout/);
  assert.match(readingNotes(resumeToDoc(sampleResume(), { columns: 2 }))[0], /Two columns/);
  const notes = readingNotes(resumeToDoc(withSection('table', 2)));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /table in "Skills"/);
});

test('a new table section has the number of columns asked for, between two and four', () => {
  const columns = (n) => newSection('table', n).body[0].content[0].content.length;
  assert.deepEqual([columns(2), columns(3), columns(4), columns(1), columns(9)], [2, 3, 4, 2, 4]);
  const headings = newSection('table', 3).body[0].content[0].content.map((cell) => cell.content[0].content[0].text);
  assert.deepEqual(headings, ['Technical skills', 'Soft skills', 'Tools']);
  assert.equal(newSection('text').body[0].type, 'paragraph');
  assert.equal(newSection('bullets').body[0].type, 'bulletList');
});

test('the reading order leaves out the sections that are hidden', () => {
  const doc = resumeToDoc(sampleResume());
  const text = docToPlainText(doc, { hidden: ['skills', 'education'] });
  assert.ok(text.includes('SUMMARY') && text.includes('EXPERIENCE'));
  assert.ok(!text.includes('SKILLS') && !text.includes('EDUCATION') && !text.includes('B.Tech'));
});
