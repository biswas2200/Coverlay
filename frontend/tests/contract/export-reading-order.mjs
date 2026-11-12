// Writes backend/src/test/resources/contract/reading-order.json: resumes, the format that matters for how a parser reads
// them, and the text and notes the PROTOTYPE produces for each (docs/prototype-spec.md section 11, RB-ATS-01, RB-ATS-02).
// The backend's ReadingOrderTest loads that file and must produce the same text and notes. The expected values are never
// written by hand: change the prototype, run this again, and the backend test shows what it must now do.
//
//   node frontend/tests/contract/export-reading-order.mjs
//
// Every resume here is in the canonical form the backend stores (rich text in canonical order, a custom section's blocks as
// the editor writes them), so the backend can read it as it is.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sampleResume } from '../../src/js/pages/resume-builder-rules.js';
import { docToPlainText, newSection, readingNotes, resumeToDoc } from '../../src/js/pages/resume-doc.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../../../backend/src/test/resources/contract/reading-order.json');

// ---------- small builders for the editor's blocks ----------

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const paragraph = (value, marks) => (value === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [text(value, marks)] });
const bullets = (...items) => ({ type: 'bulletList', content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })) });
const cell = (...blocks) => ({ type: 'tableCell', content: blocks.length ? blocks : [paragraph('')] });
const table = (...rows) => ({
  type: 'table',
  attrs: { borders: 'all', borderWidth: 1, borderStyle: 'solid', cellPadding: 4, cellGap: 0 },
  content: rows.map((cells) => ({ type: 'tableRow', content: cells })),
});

const resumeWith = (changes) => ({ ...sampleResume(), ...changes });
const blank = { name: '', contact: '', summary: '', experience: [], education: [], skills: [] };

const tableSection = () => {
  const section = newSection('table', 2);
  section.body[0].content[1].content[0].content = [bullets('Java', 'SQL')];
  section.body[0].content[1].content[1].content = [bullets('Teamwork')];
  return section;
};

// ---------- the cases ----------

const cases = [
  { name: 'the sample resume, one column', resume: sampleResume(), format: {} },
  { name: 'the sample resume, two columns', resume: sampleResume(), format: { columns: 2 } },
  {
    name: 'details as bullets, one per sentence',
    resume: resumeWith({
      experience: [
        { role: 'Software Engineer, Acme Corp', dates: '2021 - now', details: 'Built the payment APIs. Cut latency by 40%! Why? Because 2 teams. lowercase stays in the same bullet. Led 3 engineers.' },
        { role: 'Intern, Beta', dates: '2020', details: '' },
        { role: '', dates: '', details: 'Only details.' },
      ],
    }),
    format: { bullets: true },
  },
  {
    name: 'a sentence break before a tag and none inside one',
    resume: resumeWith({ experience: [{ role: 'Engineer', dates: '2021', details: 'Shipped <b>Done.</b> Next step. <b>Then</b> more.' }] }),
    format: { bullets: true },
  },
  { name: 'every hideable section hidden', resume: resumeWith({ extra: [{ title: 'Projects', body: [paragraph('Built a thing.')] }] }), format: { hidden: ['summary', 'education', 'skills'] } },
  { name: 'two columns with skills hidden', resume: sampleResume(), format: { columns: 2, hidden: ['skills'] } },
  {
    name: 'formatting is not in the text',
    resume: resumeWith({
      contact: '<a href="https://example.com/jane">jane@email.com</a> | +91 98765 43210',
      summary: 'Led <b>payments</b> &amp; <a href="https://example.com">notes</a> and <u><i>more</i></u>, a &lt; b.',
      experience: [{ role: '<b>Software Engineer</b>, <font color="#1d4ed8">Acme</font>', dates: '2021 - now', details: 'Cut <i>latency</i> by 40%.' }],
      education: [{ degree: '<b>B.Tech</b> Computer Science, VIT', dates: '2021' }],
    }),
    format: {},
  },
  {
    name: 'custom text and bullet sections, one column',
    resume: resumeWith({ extra: [{ title: 'Projects', body: [paragraph('Built a thing.'), bullets('One', 'Two')] }, { title: 'Languages', body: [paragraph('English, '), paragraph('Hindi')] }] }),
    format: {},
  },
  {
    name: 'custom sections stay in the main column in two columns',
    resume: resumeWith({ extra: [{ title: 'Projects', body: [paragraph('Built a thing.')] }] }),
    format: { columns: 2 },
  },
  {
    name: 'a custom section with no body and a title that changes case',
    resume: resumeWith({ extra: [{ title: 'Awards', body: [] }, { title: 'Straße & Co', body: [paragraph('x')] }] }),
    format: {},
  },
  { name: 'a table section, one column', resume: resumeWith({ extra: [tableSection()] }), format: {} },
  { name: 'a table section, two columns', resume: resumeWith({ extra: [tableSection()] }), format: { columns: 2 } },
  {
    name: 'two tables, one of them empty',
    resume: resumeWith({ extra: [newSection('table', 3), { title: 'Skills by area', body: [table([cell(paragraph('Backend')), cell(paragraph('Java, SQL'))], [cell(paragraph('Cloud')), cell()])] }] }),
    format: {},
  },
  {
    name: 'a table cell holds paragraphs and bullets',
    resume: resumeWith({
      extra: [{
        title: 'Grid',
        body: [table(
          [cell(paragraph('A'), paragraph(''), paragraph('B'), bullets('x', 'y')), cell(paragraph('C'))],
          [cell(), cell()],
          [cell(), cell(paragraph('last'))],
        )],
      }],
    }),
    format: {},
  },
  {
    name: 'two tables in one section give one note',
    resume: resumeWith({
      extra: [{ title: 'Two grids', body: [table([cell(paragraph('a')), cell(paragraph('b'))]), paragraph('between'), table([cell(paragraph('c')), cell(paragraph('d'))])] }],
    }),
    format: {},
  },
  { name: 'a text section holding a table and a paragraph', resume: resumeWith({ extra: [{ title: 'Mixed', body: [paragraph('Before'), table([cell(paragraph('a')), cell(paragraph('b'))]), paragraph('After')] }] }), format: {} },
  { name: 'no jobs and no schools', resume: resumeWith({ experience: [], education: [] }), format: {} },
  { name: 'no jobs and no schools, details as bullets', resume: resumeWith({ experience: [], education: [] }), format: { bullets: true } },
  { name: 'nothing written yet', resume: blank, format: {} },
  { name: 'nothing written yet, two columns, bullets', resume: blank, format: { columns: 2, bullets: true } },
];

const out = cases.map(({ name, resume, format }) => {
  const doc = resumeToDoc(resume, { bullets: format.bullets === true, columns: format.columns === 2 ? 2 : 1 });
  return {
    name,
    resume,
    format,
    text: docToPlainText(doc, { hidden: format.hidden ?? [] }),
    notes: readingNotes(doc),
  };
});

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify({ generatedBy: 'frontend/tests/contract/export-reading-order.mjs', cases: out }, null, 2)}\n`);
console.log(`${out.length} cases written to ${target}`);
