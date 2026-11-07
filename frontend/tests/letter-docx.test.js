import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLetterDocx, letterDocxName } from '../src/js/pages/letter-docx.js';
import { assertWellFormed, readZip, text } from './helpers/zip.js';

const letter = {
  blocks: [
    'Dear Swiggy hiring team,',
    'I am writing to apply for the Backend Engineer role at Swiggy &amp; I like <b>R&amp;D</b>, see <a href="https://example.com/a?b=1&amp;c=2">my notes</a>.',
    'At Acme Corp, I built and ran <i>production</i> services.',
    'Sincerely,\nJane Doe\njane@email.com · +91 98765 43210',
  ],
};

test('a cover letter is written as the person edited it: each block a paragraph, formatting and line breaks kept', () => {
  const files = readZip(buildLetterDocx(letter, { title: 'Cover letter for Swiggy' }));
  for (const [name, data] of Object.entries(files)) {
    assertWellFormed(text(data), name);
  }
  const doc = text(files['word/document.xml']);
  const order = ['Dear Swiggy hiring team,', 'I am writing to apply', 'At Acme Corp', 'Sincerely,', 'Jane Doe', 'jane@email.com'];
  let at = -1;
  for (const piece of order) {
    const next = doc.indexOf(piece, at + 1);
    assert.ok(next > at, piece);
    at = next;
  }
  assert.match(doc, /Swiggy &amp; I like /, 'special characters are escaped');
  assert.match(doc, /<w:b\/>[^]*?<w:t xml:space="preserve">R&amp;D<\/w:t>/, 'bold survives');
  assert.match(doc, /<w:i\/>[^]*?<w:t xml:space="preserve">production<\/w:t>/, 'italic survives');
  assert.match(doc, /<w:hyperlink r:id="rId10"/, 'a link is a hyperlink');
  assert.match(text(files['word/_rels/document.xml.rels']), /Target="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.match(doc, /Sincerely,<\/w:t><w:br\/><w:t xml:space="preserve">Jane Doe<\/w:t><w:br\/>/, 'the sign-off lines are breaks inside one paragraph');
  assert.equal((doc.match(/<w:p>/g) ?? []).length, 4, 'one paragraph per block');
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"\/>/, 'A4');
  assert.match(doc, /<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/, 'one-inch margins');
  assert.match(text(files['word/styles.xml']), /w:ascii="Calibri"/);
  assert.match(text(files['docProps/core.xml']), /<dc:title>Cover letter for Swiggy<\/dc:title>/);
});

test('a block the person added or removed is a paragraph added or removed', () => {
  const more = text(readZip(buildLetterDocx({ blocks: [...letter.blocks, 'P.S. One more thing.'] }))['word/document.xml']);
  assert.equal((more.match(/<w:p>/g) ?? []).length, 5);
  assert.match(more, /P\.S\. One more thing\./);
  const less = text(readZip(buildLetterDocx({ blocks: letter.blocks.slice(1) }))['word/document.xml']);
  assert.doesNotMatch(less, /Dear Swiggy/);
  assert.equal((text(readZip(buildLetterDocx({ blocks: [] }))['word/document.xml']).match(/<w:p>/g) ?? []).length, 0, 'an empty letter has no paragraphs');
});

test('the file name has the person, the company and Cover-Letter', () => {
  assert.equal(letterDocxName('Jane Doe', 'Swiggy'), 'Jane-Doe-Swiggy-Cover-Letter.docx');
  assert.equal(letterDocxName('Jane Doe', 'Dr. Reddy\'s Labs'), 'Jane-Doe-Dr-Reddys-Labs-Cover-Letter.docx');
});
