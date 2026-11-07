import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blocksPlain, blocksText, blocksToDoc, docToBlocks } from '../src/js/pages/letter-doc.js';
import { addSuggestionToBlocks, draftLetter, letterSuggestions, SAMPLE_JOBS, toBlocks } from '../src/js/pages/letters-rules.js';
import { guardText, knownValues, resolveText } from '../src/js/pages/privacy-guard-rules.js';
import { sampleResume } from '../src/js/pages/resume-builder-rules.js';

const resume = sampleResume();
const job = SAMPLE_JOBS[0];
const vault = { ...knownValues(resume), 'other.person_1': 'Priya' };
const fill = (text) => resolveText(text, vault, (key) => `{${key}}`);
const guard = (text) => guardText(text, vault).stored;

test('a template draft becomes blocks: the greeting, the paragraphs, the sign-off as one block of lines', () => {
  const letter = draftLetter({ type: 'cover', templateId: 'standard', resume, job });
  const blocks = toBlocks(letter);
  assert.equal(blocks.length, 1 + 6 + 1);
  assert.equal(blocks[0], 'Dear Swiggy hiring team,');
  assert.match(blocks.at(-1), /^Sincerely,\n\{user\.name\}\n/);
  assert.equal(toBlocks(draftLetter({ type: 'email', templateId: 'referral', resume, job })).length, 3 + 1, 'an email has no greeting block');
  // Characters that mean something in the markup are escaped, so a company called "AT&T <x>" cannot become a tag.
  assert.deepEqual(toBlocks({ greeting: 'Dear AT&T <b>,', paragraphs: [], signOff: '' }), ['Dear AT&amp;T &lt;b&gt;,']);
});

test('blocks become an editor document with the real values filled in, and come back with placeholders', () => {
  const blocks = ['Dear {other.person_1},', 'I am <b>{user.name}</b> from {user.college}.', 'Best,\n{user.name}'];
  const doc = blocksToDoc(blocks, fill);
  assert.deepEqual(doc.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'Dear Priya,' }] });
  assert.deepEqual(doc.content[1].content, [
    { type: 'text', text: 'I am ' },
    { type: 'text', text: 'Jane Doe', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' from VIT.' },
  ]);
  assert.deepEqual(doc.content[2].content, [{ type: 'text', text: 'Best,' }, { type: 'hardBreak' }, { type: 'text', text: 'Jane Doe' }]);
  assert.deepEqual(docToBlocks(doc, guard), blocks, 'what the person sees goes back to what Gemini would see');
});

test('formatting the person adds is kept: bold, italic, underline and a link', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'See ' },
    { type: 'text', text: 'my work', marks: [{ type: 'link', attrs: { href: 'https://example.com/a?b=1&c=2' } }] },
    { type: 'text', text: ' now', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] },
  ] }] };
  const [block] = docToBlocks(doc);
  assert.equal(block, 'See <a href="https://example.com/a?b=1&amp;c=2">my work</a><u><b><i> now</i></b></u>');
  assert.deepEqual(docToBlocks(blocksToDoc([block])), [block], 'the same block after another trip');
});

test('typing a name, a college or a phone number puts a placeholder in the kept text', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'I am Jane Doe from VIT, call +91 98765 43210, thanks Priya.' }] }] };
  const [block] = docToBlocks(doc, guard);
  assert.equal(block, 'I am {user.name} from {user.college}, call {user.phone}, thanks {other.person_1}.');
  assert.doesNotMatch(block, /Jane|VIT|98765|Priya/);
});

test('blank paragraphs are not kept, spaces are tidied, and a colour mark is not part of a letter', () => {
  const doc = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First   paragraph  here' }] },
    { type: 'paragraph' },
    { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'coloured', marks: [{ type: 'textColor', attrs: { color: '#b91c1c' } }] }] },
  ] };
  assert.deepEqual(docToBlocks(doc), ['First paragraph here', 'coloured']);
  assert.deepEqual(blocksToDoc([]).content, [{ type: 'paragraph' }], 'an empty letter is one empty paragraph to type in');
  assert.deepEqual(docToBlocks(blocksToDoc(['<font color="#b91c1c">red</font> text'])), ['red text']);
});

test('the plain text and the text with a subject, for copying and counting', () => {
  const blocks = ['Hi <b>Priya</b>,', 'Thanks &amp; best,\nJane'];
  assert.equal(blocksPlain(blocks), 'Hi Priya,\n\nThanks & best,\nJane');
  assert.equal(blocksText(blocks, 'Backend Engineer'), 'Subject: Backend Engineer\n\nHi Priya,\n\nThanks & best,\nJane');
  assert.equal(blocksText(blocks), 'Hi Priya,\n\nThanks & best,\nJane');
});

test('a suggestion goes into the edited text: the right paragraph, once, escaped', () => {
  const letter = draftLetter({ type: 'cover', templateId: 'standard', resume, job });
  const blocks = toBlocks(letter);
  const [result, learning] = letterSuggestions({ type: 'cover', resume, job });
  const withResult = addSuggestionToBlocks(blocks, result, true);
  assert.ok(withResult[2].endsWith(result.text), 'the result goes after the experience paragraph (block 2: the greeting is block 0)');
  assert.deepEqual(addSuggestionToBlocks(withResult, result, true), withResult, 'adding it twice changes nothing');
  assert.match(addSuggestionToBlocks(blocks, learning, true)[3], /haven't used Kafka at work yet/, 'honesty goes in the skills paragraph');
  const tricky = { text: 'I like R&D <fast>.', paragraph: 0 };
  assert.match(addSuggestionToBlocks(['a', 'b'], tricky, false)[0], /R&amp;D &lt;fast&gt;\.$/);
  assert.equal(addSuggestionToBlocks(['a', 'b'], tricky, false)[1], 'b');
  // Greeting-less emails use the paragraph index as it is.
  assert.match(addSuggestionToBlocks(['a', 'b'], { text: 'X', paragraph: 1 }, false)[1], /b X$/);
});
