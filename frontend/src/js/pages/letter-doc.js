import { mergeSegments, parseInline, plainText, serializeSegments } from './resume-builder-rules.js';

// A cover letter or a cold email as the person edits it: a list of BLOCKS, each one paragraph of rich
// text in the same small markup as the resume (RB-DATA-03: <b>, <i>, <u>, <a href>; no colour here), with
// "\n" for a line break inside a block (the sign-off is one block of lines). The greeting, if there is one,
// is the first block and the sign-off the last. Stored with placeholders ({user.name}) so what Gemini would
// see is never the real name; filled in on the person's own screen. DOM-free, so tests/letter-doc.test.js
// can run it in Node; letter-editor.js puts the editor on top of it.

const FORMATS = ['bold', 'italic', 'underline'];

function textNode(text, segment) {
  const marks = [];
  for (const format of FORMATS) {
    if (segment[format]) {
      marks.push({ type: format });
    }
  }
  if (segment.href) {
    marks.push({ type: 'link', attrs: { href: segment.href } });
  }
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
}

/**
 * The blocks as an editor document. `fill` turns the placeholders in a piece of text into the person's
 * real values (identity when you want the stored form).
 */
export function blocksToDoc(blocks, fill = (text) => text) {
  const paragraphs = (blocks.length ? blocks : ['']).map((markup) => {
    const content = [];
    for (const segment of parseInline(markup)) {
      fill(segment.text).split('\n').forEach((line, index) => {
        if (index) {
          content.push({ type: 'hardBreak' });
        }
        if (line) {
          content.push(textNode(line, segment));
        }
      });
    }
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
  });
  return { type: 'doc', content: paragraphs };
}

/**
 * The editor document back as blocks. `guard` runs on each piece of text before it is kept (it turns the
 * person's name, college and contacts back into placeholders). Blank paragraphs are not kept, and runs of
 * spaces become one.
 */
export function docToBlocks(doc, guard = (text) => text) {
  const blocks = [];
  for (const paragraph of doc?.content ?? []) {
    const segments = [];
    for (const node of paragraph.content ?? []) {
      if (node.type === 'hardBreak') {
        segments.push({ text: '\n' });
      } else if (node.type === 'text' && node.text) {
        const segment = { text: guard(node.text.replace(/[ \t ]+/g, ' ')) };
        for (const mark of node.marks ?? []) {
          if (FORMATS.includes(mark.type)) {
            segment[mark.type] = true;
          } else if (mark.type === 'link' && mark.attrs?.href) {
            segment.href = mark.attrs.href;
          }
        }
        segments.push(segment);
      }
    }
    const markup = serializeSegments(mergeSegments(segments)).replace(/^[ \n]+|[ \n]+$/g, '');
    if (plainText(markup).trim()) {
      blocks.push(markup);
    }
  }
  return blocks;
}

/** The blocks as plain text, a blank line between blocks (a line break inside a block stays one). */
export function blocksPlain(blocks) {
  return blocks.map((markup) => plainText(markup)).join('\n\n');
}

/** What the person is writing as one text: the subject first when there is one. */
export function blocksText(blocks, subject = '') {
  return [subject ? `Subject: ${subject}` : null, blocksPlain(blocks)].filter(Boolean).join('\n\n');
}
