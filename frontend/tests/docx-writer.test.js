import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DOCX_MIME, buildDocx, crc32, safeFileName, xmlEscape, zipStore } from '../src/js/pages/docx-writer.js';
import { assertWellFormed, readZip, text } from './helpers/zip.js';

const PAGE = { widthMm: 210, heightMm: 297, marginsMm: { top: 20, right: 20, bottom: 20, left: 20 } };
const make = (blocks, extra = {}) => {
  const files = readZip(buildDocx({ blocks, page: PAGE, ...extra }));
  return { files, doc: text(files['word/document.xml']), rels: text(files['word/_rels/document.xml.rels']) };
};

test('the zip is a valid stored zip: signatures, names, checksums', () => {
  const zip = zipStore([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const files = readZip(zip);
  assert.deepEqual(Object.keys(files), ['a.txt', 'dir/b.bin']);
  assert.equal(text(files['a.txt']), 'hello');
  assert.deepEqual([...files['dir/b.bin']], [1, 2, 3]);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
  assert.deepEqual([...zipStore([{ name: 'a', data: 'x' }])], [...zipStore([{ name: 'a', data: 'x' }])], 'the same input is the same bytes');
});

test('a document has every part Word needs, and each part is well-formed XML', () => {
  const { files } = make([{ type: 'p', runs: [{ text: 'Hello & <welcome> "quoted"' }] }]);
  assert.deepEqual(Object.keys(files), ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml']);
  for (const [name, data] of Object.entries(files)) {
    assertWellFormed(text(data), name);
  }
  assert.match(text(files['word/document.xml']), /Hello &amp; &lt;welcome&gt; &quot;quoted&quot;/);
  assert.match(DOCX_MIME, /wordprocessingml\.document$/);
});

test('text is escaped and characters XML cannot hold are dropped', () => {
  assert.equal(xmlEscape('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;');
  assert.equal(xmlEscape('bell\u0007 tab\t newline\n'), 'bell tab\t newline\n');
  assert.equal(xmlEscape(null), '');
  const { doc } = make([{ type: 'p', runs: [{ text: 'one\u0000two' }] }]);
  assertWellFormed(doc);
  assert.match(doc, />onetwo</);
});

test('formatting: bold, italic, underline, colour, size, caps, tabs, rules, alignment', () => {
  const { doc } = make([{
    type: 'p', align: 'center', before: 6, after: 3, tabRight: 100, rule: { size: 12, color: '#1b1f27' },
    runs: [{ text: 'A', bold: true, italic: true, underline: true, color: '#1d4ed8', size: 12, caps: true }, { tab: true }, { text: 'B' }],
  }]);
  assert.match(doc, /<w:jc w:val="center"\/>/);
  assert.match(doc, /<w:tab w:val="right" w:pos="2000"\/>/, '100 pt is 2000 twips');
  assert.match(doc, /<w:spacing w:before="120" w:after="60"\/>/);
  assert.match(doc, /<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="2" w:color="1B1F27"\/><\/w:pBdr>/);
  assert.match(doc, /<w:b\/><w:i\/><w:caps\/><w:color w:val="1D4ED8"\/><w:sz w:val="24"\/><w:szCs w:val="24"\/><w:u w:val="single"\/>/);
  assert.match(doc, /<w:r><w:tab\/><\/w:r>/);
  assert.doesNotMatch(make([{ type: 'p', runs: [{ text: 'x', color: 'red; background:url(x)' }] }]).doc, /w:color/, 'only a #rrggbb is a colour');
});

test('a link becomes a hyperlink with its own relationship, and the address is escaped', () => {
  const { doc, rels } = make([{ type: 'p', runs: [{ text: 'my notes', href: 'https://example.com/a?b=1&c=2' }] }]);
  assertWellFormed(rels);
  assert.match(doc, /<w:hyperlink r:id="rId10" w:history="1">/);
  assert.match(rels, /Id="rId10" Type="[^"]+\/hyperlink" Target="https:\/\/example\.com\/a\?b=1&amp;c=2" TargetMode="External"/);
});

test('bullets are real list items, and a line break inside a run is a break', () => {
  const { doc, files } = make([{ type: 'p', bullet: true, runs: [{ text: 'one' }] }, { type: 'p', runs: [{ text: 'a\nb' }] }]);
  assert.match(doc, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr>/);
  assert.match(text(files['word/numbering.xml']), /<w:numFmt w:val="bullet"\/>/);
  assert.match(doc, /a<\/w:t><w:br\/><w:t xml:space="preserve">b/);
});

test('page size, margins, default font and size', () => {
  const { doc, files } = make([{ type: 'p', runs: [{ text: 'x' }] }], { font: 'Georgia', fontSize: 10.5, lineSpacing: 1.4 });
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"\/>/, 'A4');
  assert.match(doc, /<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/, '20 mm is 1134 twips');
  const styles = text(files['word/styles.xml']);
  assert.match(styles, /w:ascii="Georgia"/);
  assert.match(styles, /<w:sz w:val="21"\/>/);
  assert.match(styles, /w:line="336"/);
});

test('two columns: a section ends after the header, then the rest sits in two real columns with a column break', () => {
  const { doc } = make([
    { type: 'p', runs: [{ text: 'Header' }], endsSection: { columns: 1 } },
    { type: 'p', runs: [{ text: 'Main' }] },
    { type: 'p', columnBreakBefore: true, runs: [{ text: 'Side' }] },
  ], { columns: 2 });
  assert.equal((doc.match(/<w:sectPr>/g) ?? []).length, 2);
  assert.match(doc, /<w:r><w:br w:type="column"\/><\/w:r><w:r><w:t xml:space="preserve">Side<\/w:t>/, 'the column break comes right before the side column');
  assert.match(doc, /<w:type w:val="continuous"\/><w:pgSz[^>]*\/><w:pgMar[^>]*\/><w:cols w:num="2" w:space="567"\/>/);
  assert.equal((doc.match(/<w:cols /g) ?? []).length, 1, 'the header section has one column and says nothing');
  assertWellFormed(doc);
});

test('a table: the width, style and spacing of its lines, a hidden one, spanning cells', () => {
  const cell = (label) => ({ blocks: [{ type: 'p', runs: [{ text: label }] }] });
  const rows = [[cell('a'), cell('b')], [cell('c'), cell('d')]];
  const solid = make([{ type: 'table', rows, look: { borders: 'all', width: 1.5, style: 'dashed', padding: 4, gap: 0 } }]).doc;
  assertWellFormed(solid);
  assert.match(solid, /<w:top w:val="dashed" w:sz="12" w:space="0" w:color="111111"\/>/, '1.5 pt is 12 eighths');
  assert.match(solid, /<w:insideV w:val="dashed" w:sz="12"/);
  assert.match(solid, /<w:tblCellMar><w:top w:w="80" w:type="dxa"\/>/, '4 pt is 80 twips');
  assert.doesNotMatch(solid, /tblCellSpacing/);
  assert.equal((solid.match(/<w:gridCol /g) ?? []).length, 2);

  const hidden = make([{ type: 'table', rows, look: { borders: 'all', width: 0, style: 'solid', padding: 4, gap: 0 } }]).doc;
  assert.doesNotMatch(hidden, /w:val="single"|w:val="dashed"/, 'a width of 0 draws no line');
  assert.match(hidden, /<w:top w:val="nil"\/>/);
  assert.match(hidden, /<w:tbl>/, 'but the table is there');

  const rowsOnly = make([{ type: 'table', rows, look: { borders: 'rows', width: 1, style: 'dotted', padding: 4, gap: 0 } }]).doc;
  assert.match(rowsOnly, /<w:left w:val="nil"\/>/);
  assert.match(rowsOnly, /<w:insideH w:val="dotted" w:sz="8" w:space="0" w:color="8A8A8A"\/>/);

  const spaced = make([{ type: 'table', rows, look: { borders: 'light', width: 1, style: 'solid', padding: 2, gap: 6 } }]).doc;
  assert.match(spaced, /<w:tblCellSpacing w:w="120" w:type="dxa"\/>/, '6 pt between cells');
  assert.match(spaced, /<w:tcBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="BDBDBD"\/>/, 'spaced cells carry their own lines');

  const merged = make([{ type: 'table', width: 300, look: {}, rows: [[{ ...cell('wide'), span: 2 }], [{ ...cell('tall'), rowspan: 2 }, cell('x')], [cell('y')]] }]).doc;
  assertWellFormed(merged);
  assert.match(merged, /<w:gridSpan w:val="2"\/>/);
  assert.match(merged, /<w:vMerge w:val="restart"\/>/);
  assert.equal((merged.match(/<w:vMerge\/>/g) ?? []).length, 1, 'the row under a tall cell gets its continuation');
  assert.match(merged, /<w:tblW w:w="6000" w:type="dxa"\/>/, 'a table in a column is as wide as the column');
});

test('file names are safe on every system', () => {
  assert.equal(safeFileName(['Jane Doe', 'Resume'], 'docx'), 'Jane-Doe-Resume.docx');
  assert.equal(safeFileName(['Renée / Müller', 'Swiggy: Backend', 'Cover-Letter'], 'pdf'), 'Renee-Muller-Swiggy-Backend-Cover-Letter.pdf');
  assert.equal(safeFileName(['../../etc', ''], 'docx'), 'etc.docx');
  assert.equal(safeFileName([], 'docx'), 'document.docx');
});
