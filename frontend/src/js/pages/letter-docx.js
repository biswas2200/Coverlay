import { buildDocx, safeFileName } from './docx-writer.js';
import { mergeSegments, parseInline } from './resume-builder-rules.js';

// A cover letter as a Word file: the person's own text exactly as the page shows it (placeholders already
// filled in on their own screen), with its bold, italics, underline and links, a line break where the sign-off
// has one, on an A4 page with one-inch margins in a plain 11 pt font. DOM-free, so tests/letter-docx.test.js can
// read it.

/** `letter` is `{ blocks: [markup] }`: the greeting, the paragraphs and the sign-off, real values, no placeholders. */
export function buildLetterDocx(letter, { title = 'Cover letter' } = {}) {
  const blocks = (letter.blocks ?? []).map((markup) => ({
    type: 'p',
    after: 10,
    runs: mergeSegments(parseInline(markup)).map((segment) => ({
      text: segment.text, bold: segment.bold, italic: segment.italic, underline: segment.underline, href: segment.href,
    })),
  }));
  return buildDocx({
    blocks,
    page: { widthMm: 210, heightMm: 297, marginsMm: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } },
    font: 'Calibri',
    fontSize: 11,
    lineSpacing: 1.2,
    title,
  });
}

export const letterDocxName = (name, company) => safeFileName([name, company, 'Cover-Letter'], 'docx');
