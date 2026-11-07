import { PAGE_SIZES, normalizeFormat } from './resume-builder-rules.js';
import { buildDocx, safeFileName } from './docx-writer.js';
import { normalizeTableAttrs, resumeToDoc } from './resume-doc.js';

// The resume as a Word file. It is built from the same editor document the page shows
// (resumeToDoc), so what the person sees is what is written: the header, the sections in their
// order, bullets, text colours, links, custom sections and tables with their line width, style and
// spacing, the page size and margins, and two real section columns. DOM-free, so
// tests/resume-docx.test.js can read what it writes. The PDF is the print dialog; Classic is
// PDF only (its look is typeset), so it has no Word file.

const MM_TO_PT = 72 / 25.4;
const FONT_NAME = { sans: 'Calibri', serif: 'Georgia', classic: 'Georgia' };
const LINE = { tight: 1.05, normal: 1.2, airy: 1.4 };
const COLUMN_GAP_MM = 10;
const kids = (node) => node?.content ?? [];
const first = (node, type) => kids(node).find((child) => child.type === type);

/** Inline text nodes as runs: bold, italic, underline, colour and links carried over. */
function runsOf(nodes, base = {}) {
  return kids({ content: nodes }).filter((node) => node.type === 'text' && node.text).map((node) => {
    const run = { text: node.text, ...base };
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') { run.bold = true; }
      if (mark.type === 'italic') { run.italic = true; }
      if (mark.type === 'underline') { run.underline = true; }
      if (mark.type === 'textColor' && mark.attrs?.color) { run.color = mark.attrs.color; }
      if (mark.type === 'link' && mark.attrs?.href) { run.href = mark.attrs.href; }
    }
    return run;
  });
}

const textOf = (node) => kids(node).map((child) => child.text ?? '').join('');

/** The document as blocks for the Word writer. */
function blocksFor(doc, { format, templateId, hiddenNames }) {
  const f = format;
  const page = PAGE_SIZES[f.page] ?? PAGE_SIZES.a4;
  const textWidth = (page.widthMm - f.marginLeft - f.marginRight) * MM_TO_PT;
  const twoColumns = kids(doc).some((node) => node.type === 'columns');
  const columnWidth = (textWidth - COLUMN_GAP_MM * MM_TO_PT) / 2;
  const accent = templateId === 'modern' ? '#3b5bdb' : null;
  const headingColor = accent ?? '#4b5263';
  const size = f.fontSize;
  const align = f.align === 'center' ? 'center' : 'left';

  const paragraph = (nodes, ctx, extra = {}) => ({ type: 'p', runs: runsOf(nodes, ctx.base), ...extra });
  const heading = (text, ctx) => ({
    type: 'p', keepNext: true, before: size * 1.25, after: size * 0.4,
    runs: [{ text, bold: true, caps: true, size: size * 0.9, spacing: 1, color: headingColor }],
    rule: f.rules ? { size: 4, color: '#111111' } : undefined,
    ...ctx.headingExtra,
  });
  const bullets = (list, ctx) => kids(list).map((item) => ({
    type: 'p', bullet: true, before: 1,
    runs: runsOf(kids(item).flatMap((child) => kids(child)), ctx.base),
  }));

  const customBlocks = (nodes, ctx) => nodes.flatMap((node) => {
    if (node.type === 'bulletList') {
      return bullets(node, ctx);
    }
    if (node.type === 'table') {
      const look = normalizeTableAttrs(node.attrs);
      return [{
        type: 'table',
        width: ctx.width,
        look: { borders: look.borders, width: look.borderWidth, style: look.borderStyle, padding: look.cellPadding, gap: look.cellGap },
        rows: kids(node).map((row) => kids(row).map((cell) => ({
          span: cell.attrs?.colspan ?? 1,
          rowspan: cell.attrs?.rowspan ?? 1,
          blocks: customBlocks(kids(cell), { ...ctx, base: cell.type === 'tableHeader' ? { ...ctx.base, bold: true } : ctx.base }),
        }))),
      }];
    }
    return [paragraph(kids(node), ctx, { before: 2 })];
  });

  const sectionBlocks = (node, ctx) => {
    const hidden = { summarySection: 'summary', educationSection: 'education', skillsSection: 'skills' }[node.type];
    if (hidden && hiddenNames.has(hidden)) {
      return [];
    }
    const title = node.type === 'customSection' ? textOf(first(node, 'sectionTitle')) : { summarySection: 'Summary', experienceSection: 'Experience', educationSection: 'Education', skillsSection: 'Skills' }[node.type];
    const out = [heading(title, ctx)];
    switch (node.type) {
      case 'summarySection':
        out.push(paragraph(kids(first(node, 'summary')), ctx));
        break;
      case 'experienceSection':
        kids(node).forEach((job, index) => {
          const head = first(job, 'jobHead');
          out.push({
            type: 'p', keepNext: true, before: index ? size * 0.5 : 0, tabRight: ctx.width,
            runs: [...runsOf(kids(first(head, 'role')), { ...ctx.base, bold: true }), { tab: true }, { text: textOf(first(head, 'dates')), color: '#6b7280' }],
          });
          const list = first(job, 'bullets');
          if (list) {
            out.push(...kids(list).map((item) => ({ type: 'p', bullet: true, before: 1, runs: runsOf(kids(item), ctx.base) })));
          } else {
            out.push(paragraph(kids(first(job, 'details')), ctx, { before: 2 }));
          }
        });
        break;
      case 'educationSection':
        kids(node).forEach((school) => {
          out.push({
            type: 'p', tabRight: ctx.width,
            runs: [...runsOf(kids(first(school, 'degree')), { ...ctx.base, bold: true }), { tab: true }, { text: textOf(first(school, 'dates')), color: '#6b7280' }],
          });
        });
        break;
      case 'skillsSection':
        out.push({ type: 'p', runs: [{ text: kids(first(node, 'skillList')).map(textOf).filter(Boolean).join(', ') }] });
        break;
      case 'customSection':
        out.push(...customBlocks(kids(node).filter((child) => child.type !== 'sectionTitle'), ctx));
        break;
      default:
        return [];
    }
    return out;
  };

  const header = first(doc, 'header');
  const blocks = [
    {
      type: 'p', align, after: 2,
      runs: [{ text: textOf(first(header, 'name')), bold: true, size: Math.round(size * 1.9 * 2) / 2, color: accent ?? '#111111' }],
    },
    {
      type: 'p', align, after: 6, rule: { size: 12, color: accent ?? '#1b1f27' },
      runs: runsOf(kids(first(header, 'contact')), { color: '#4b5263' }),
      endsSection: twoColumns ? { columns: 1 } : undefined,
    },
  ];

  if (twoColumns) {
    const [main, side] = kids(first(doc, 'columns'));
    const mainCtx = { width: columnWidth, base: {}, headingExtra: {} };
    const sideCtx = { width: columnWidth, base: {}, headingExtra: {} };
    blocks.push(...kids(main).flatMap((node) => sectionBlocks(node, mainCtx)));
    const sideBlocks = kids(side).flatMap((node) => sectionBlocks(node, sideCtx));
    if (sideBlocks[0]) {
      sideBlocks[0] = { ...sideBlocks[0], columnBreakBefore: true, before: 0 };
    }
    blocks.push(...sideBlocks);
  } else {
    const ctx = { width: textWidth, base: {}, headingExtra: {} };
    blocks.push(...kids(doc).filter((node) => node.type !== 'header').flatMap((node) => sectionBlocks(node, ctx)));
  }
  return { blocks, twoColumns };
}

/**
 * The resume as a .docx (bytes). `format` is the page format (page size, margins, font, size,
 * columns, section lines, header alignment, hidden sections); `templateId` colours the Modern look.
 */
export function buildResumeDocx(resume, { format, templateId } = {}) {
  const f = normalizeFormat(format);
  const doc = resumeToDoc(resume, { bullets: f.bullets, columns: f.columns });
  const { blocks, twoColumns } = blocksFor(doc, { format: f, templateId, hiddenNames: new Set(f.hidden) });
  const page = PAGE_SIZES[f.page] ?? PAGE_SIZES.a4;
  return buildDocx({
    blocks,
    page: { widthMm: page.widthMm, heightMm: page.heightMm, marginsMm: { top: f.marginTop, right: f.marginRight, bottom: f.marginBottom, left: f.marginLeft } },
    font: FONT_NAME[f.font] ?? FONT_NAME.sans,
    fontSize: f.fontSize,
    lineSpacing: LINE[f.spacing] ?? LINE.normal,
    columns: twoColumns ? 2 : 1,
    title: `${resume.name} resume`,
  });
}

export const resumeDocxName = (resume) => safeFileName([resume.name, 'Resume'], 'docx');
