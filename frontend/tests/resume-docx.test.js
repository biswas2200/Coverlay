import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_FORMAT, sampleResume } from '../src/js/pages/resume-builder-rules.js';
import { newSection } from '../src/js/pages/resume-doc.js';
import { buildResumeDocx, resumeDocxName } from '../src/js/pages/resume-docx.js';
import { assertWellFormed, readZip, text } from './helpers/zip.js';

const open = (resume, options) => {
  const files = readZip(buildResumeDocx(resume, options));
  for (const [name, data] of Object.entries(files)) {
    assertWellFormed(text(data), name);
  }
  return { doc: text(files['word/document.xml']), rels: text(files['word/_rels/document.xml.rels']), styles: text(files['word/styles.xml']) };
};

const withTable = () => {
  const resume = sampleResume();
  const section = newSection('table', 2);
  section.title = 'Skills table';
  section.body[0].content[0].content[0].content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Technical' }] }];
  section.body[0].content[1].content[0].content = [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Java' }] }] }] }];
  resume.extra = [section];
  return { resume, table: section.body[0] };
};

test('the resume is written in the order it is shown, with the person\'s own words', () => {
  const { doc } = open(sampleResume(), { format: DEFAULT_FORMAT });
  const order = ['Jane Doe', 'jane@email.com', 'Summary', 'Backend developer', 'Experience', 'Software Engineer, Acme Corp', '2021 - now', 'Education', 'B.Tech Computer Science, VIT', 'Skills', 'Java, Spring Boot, SQL'];
  let at = -1;
  for (const piece of order) {
    const next = doc.indexOf(piece, at + 1);
    assert.ok(next > at, `"${piece}" comes after the one before it`);
    at = next;
  }
  assert.match(doc, /w:caps/, 'headings are small capitals');
  assert.match(doc, /<w:tab w:val="right" w:pos="\d+"\/>/, 'dates sit at the right edge');
  assert.doesNotMatch(doc, /<w:tbl>|<w:cols /, 'one column, no table');
});

test('bold, colour and links in the resume text survive', () => {
  const resume = sampleResume();
  resume.summary = 'Led <font color="#1d4ed8">payments</font> with <b>Java</b> and <a href="https://example.com/x?a=1&b=2">my notes</a>.';
  const { doc, rels } = open(resume, { format: DEFAULT_FORMAT });
  assert.match(doc, /<w:color w:val="1D4ED8"\/>[^]*?<w:t xml:space="preserve">payments<\/w:t>/);
  assert.match(doc, /<w:b\/>[^]*?<w:t xml:space="preserve">Java<\/w:t>/);
  assert.match(rels, /Target="https:\/\/example\.com\/x\?a=1&amp;b=2"/);
});

test('experience as bullets becomes real bullet items, one per sentence', () => {
  const resume = sampleResume();
  resume.experience[0].details = 'Built the payment APIs. Cut response time by 40%. Mentored two juniors.';
  const { doc } = open(resume, { format: { ...DEFAULT_FORMAT, bullets: true } });
  assert.equal((doc.match(/<w:numPr>/g) ?? []).length, 3);
  assert.doesNotMatch(open(resume, { format: DEFAULT_FORMAT }).doc, /<w:numPr>/);
});

test('hidden sections are left out, a section line and the header alignment follow the format', () => {
  const { doc } = open(sampleResume(), { format: { ...DEFAULT_FORMAT, hidden: ['skills', 'education'], align: 'center', rules: true } });
  assert.doesNotMatch(doc, /Education|B\.Tech|Skills|Spring Boot, SQL/);
  assert.match(doc, /<w:jc w:val="center"\/>/);
  assert.ok((doc.match(/<w:pBdr>/g) ?? []).length >= 3, 'the header rule and a line under each heading');
});

test('page size, margins, font and size come from the format', () => {
  const { doc, styles } = open(sampleResume(), { format: { ...DEFAULT_FORMAT, page: 'letter', font: 'serif', fontSize: 10, marginTop: 12.7, marginBottom: 12.7, marginLeft: 25.4, marginRight: 25.4 } });
  assert.match(doc, /<w:pgSz w:w="12240" w:h="15840"\/>/, 'Letter');
  assert.match(doc, /<w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1440"/);
  assert.match(styles, /w:ascii="Georgia"/);
  assert.match(styles, /<w:sz w:val="20"\/>/);
  assert.match(open(sampleResume(), { format: DEFAULT_FORMAT }).styles, /w:ascii="Calibri"/, 'sans is Calibri in Word');
});

test('two columns are real section columns: the header on its own, the main column, a break, the side column', () => {
  const { doc } = open(sampleResume(), { format: { ...DEFAULT_FORMAT, columns: 2 } });
  assert.match(doc, /<w:cols w:num="2" w:space="567"\/>/);
  assert.equal((doc.match(/<w:sectPr>/g) ?? []).length, 2);
  assert.ok(doc.indexOf('Experience') < doc.indexOf('w:type="column"'), 'experience is in the main column');
  assert.ok(doc.indexOf('w:type="column"') < doc.indexOf('Education'), 'education starts the side column');
});

test('a table in a custom section keeps its cells, its line width and style, its padding and its gap', () => {
  const { resume, table } = withTable();
  table.attrs = { ...table.attrs, borders: 'all', borderWidth: 2, borderStyle: 'dotted', cellPadding: 6, cellGap: 3 };
  const { doc } = open(resume, { format: DEFAULT_FORMAT });
  assert.match(doc, /Skills table/);
  assert.match(doc, /Technical/);
  assert.match(doc, /<w:tcBorders><w:top w:val="dotted" w:sz="16" /, '2 pt dotted lines on spaced cells');
  assert.match(doc, /<w:tblCellSpacing w:w="60" w:type="dxa"\/>/);
  assert.match(doc, /<w:tblCellMar><w:top w:w="120"/);
  assert.match(doc, /<w:numPr>/, 'a bullet inside a cell stays a bullet');
});

test('a hidden-border table (width 0) is still a table in the Word file, with no lines', () => {
  const { resume, table } = withTable();
  table.attrs = { borders: 'none' }; // saved by an earlier version of the builder
  const { doc } = open(resume, { format: DEFAULT_FORMAT });
  const xml = /<w:tbl>[^]*<\/w:tbl>/.exec(doc)?.[0];
  assert.ok(xml, 'the table is there');
  assert.match(xml, /<w:top w:val="nil"\/>/);
  assert.doesNotMatch(xml, /w:val="(?:single|dashed|dotted)"/, 'and none of its lines is drawn');
});

test('a table in the main column of a two-column resume is as wide as the column', () => {
  const { resume } = withTable();
  const { doc } = open(resume, { format: { ...DEFAULT_FORMAT, columns: 2 } });
  const width = Number(/<w:tblW w:w="(\d+)"/.exec(doc)[1]);
  assert.ok(width > 4000 && width < 5400, `the table is ${width} twips wide, about half of the 9,700 of the page`);
});

test('the file name is the person\'s name and Resume', () => {
  assert.equal(resumeDocxName(sampleResume()), 'Jane-Doe-Resume.docx');
  assert.equal(resumeDocxName({ ...sampleResume(), name: '' }), 'Resume.docx');
});
