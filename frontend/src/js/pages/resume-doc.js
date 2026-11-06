import { mergeSegments, normalizeText, parseInline, safeHref, sentences, serializeSegments } from './resume-builder-rules.js';

// The resume as an editor document, and back. The Resume Builder keeps the resume as plain
// fields (name, contact, summary, jobs, schools, skills) and every version is one of those
// objects. The Tiptap editor works on a document tree, so this file is the only place that
// knows both shapes: resumeToDoc() builds the tree, resumeFromDoc() reads it back, and
// listFields() names every editable block with the same paths the rest of the page uses
// ("summary", "experience.0.role", "skills.2"). It has no editor imports, so Node tests it.
//
// The tree (node names are what the editor schema in resume-editor.js defines):
//   doc > header(name, contact)
//       > summarySection(summary)
//       > experienceSection(job(jobHead(role, dates), details | bullets(bullet+))+)
//       > educationSection(school(degree, dates)+)
//       > skillsSection(skillList(skill*))
// With two columns the four sections sit in `columns(mainColumn(summary, experience),
// sideColumn(education, skills))` instead of directly under the doc; the fields and their
// paths are the same either way.
// Custom sections (`resume.extra`: `[{ title, body }]`) come after the skills, or after the
// experience in the main column: `customSection(sectionTitle, (paragraph | bulletList | table)+)`.
// Their body is free-form (paragraphs, bullets, tables), kept as editor blocks.
// Text inside `contact`, `summary`, `role`, `details`, `bullet` and `degree` can be bold,
// italic, underlined or a link; everything else is plain text.

const MARK_FOR = { bold: 'bold', italic: 'italic', underline: 'underline' };

export const SECTION_TITLES = { summarySection: 'Summary', experienceSection: 'Experience', educationSection: 'Education', skillsSection: 'Skills' };

/** How the cells of a new table are headed: the usual resume split. */
const TABLE_HEADINGS = ['Technical skills', 'Soft skills', 'Tools', 'Languages'];

const textBlock = (type, text) => (text ? { type, content: [{ type: 'text', text }] } : { type });
const cellOf = (type, blocks) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: blocks });
const listOf = (...items) => ({ type: 'bulletList', content: items.map((text) => ({ type: 'listItem', content: [textBlock('paragraph', text)] })) });

/**
 * A new custom section: 'text' (a paragraph), 'bullets' (a list) or 'table' with `columns`
 * columns (2 to 4) and the borders hidden, the way people build side-by-side skills in Word
 * (a table with the borders set to none). Written the way the editor writes it back, so a
 * section nobody has touched never looks edited.
 */
export function newSection(kind, columns = 2) {
  if (kind === 'table') {
    const count = Math.min(4, Math.max(2, Math.round(columns)));
    const headings = TABLE_HEADINGS.slice(0, count);
    return {
      title: 'Skills',
      body: [{
        type: 'table',
        attrs: { borders: 'none' },
        content: [
          { type: 'tableRow', content: headings.map((text) => cellOf('tableHeader', [textBlock('paragraph', text)])) },
          { type: 'tableRow', content: headings.map(() => cellOf('tableCell', [listOf('')])) },
        ],
      }],
    };
  }
  return { title: 'New section', body: [kind === 'bullets' ? listOf('') : textBlock('paragraph', '')] };
}

/** The same blocks without the attributes that are only defaults, so two spellings of one table compare equal. */
function stripDefaults(node) {
  const out = { type: node.type };
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(([key, value]) => !((key === 'colspan' || key === 'rowspan') && value === 1) && !(key === 'colwidth' && value === null)),
  );
  if (Object.keys(attrs).length) {
    out.attrs = attrs;
  }
  if (node.text !== undefined) {
    out.text = node.text;
  }
  if (node.marks?.length) {
    out.marks = node.marks;
  }
  if (node.content?.length) {
    out.content = node.content.map(stripDefaults);
  }
  return out;
}

const sameBlocks = (a, b) => JSON.stringify((a ?? []).map(stripDefaults)) === JSON.stringify((b ?? []).map(stripDefaults));

/** All the text in some blocks, in reading order, for word counts. */
export function blocksText(nodes) {
  const parts = [];
  const walk = (node) => {
    if (node.text) {
      parts.push(node.text);
    }
    (node.content ?? []).forEach(walk);
  };
  (nodes ?? []).forEach(walk);
  return parts.join(' ');
}

// ---------- inline content ----------

/** The markup ("<b>text</b>") as editor text nodes. Plain fields keep their text as it is. */
function textNodes(value, rich) {
  if (!rich) {
    return value ? [{ type: 'text', text: value }] : [];
  }
  return parseInline(value).map((segment) => {
    const marks = [];
    for (const [key, type] of Object.entries(MARK_FOR)) {
      if (segment[key]) {
        marks.push({ type });
      }
    }
    if (segment.href) {
      marks.push({ type: 'link', attrs: { href: segment.href } });
    }
    return marks.length ? { type: 'text', text: segment.text, marks } : { type: 'text', text: segment.text };
  });
}

function block(type, value, rich) {
  const content = textNodes(value, rich);
  return content.length ? { type, content } : { type };
}

/** The text nodes of one block as segments, formatting kept. */
function segmentsOf(node) {
  return (node.content ?? [])
    .filter((child) => child.type === 'text' && child.text)
    .map((child) => {
      const segment = { text: child.text };
      for (const mark of child.marks ?? []) {
        if (mark.type === 'link') {
          const href = safeHref(mark.attrs?.href);
          if (href) {
            segment.href = href;
          }
        } else if (mark.type in MARK_FOR) {
          segment[mark.type] = true;
        }
      }
      return segment;
    });
}

const plainValue = (node) => normalizeText((node.content ?? []).map((child) => child.text ?? '').join(''));
const richValue = (node) => normalizeText(serializeSegments(mergeSegments(segmentsOf(node))));

/** The same markup written one canonical way, so "<i><b>x</b></i>" and "<b><i>x</i></b>" compare equal. */
function canonical(markup) {
  return normalizeText(serializeSegments(mergeSegments(parseInline(markup))));
}

// ---------- resume -> document ----------

/**
 * The editor document for a resume. With `bullets`, each job's details become one bullet per
 * sentence; with `columns: 2` the sections are laid out in a main and a side column.
 */
export function resumeToDoc(resume, { bullets = false, columns = 1 } = {}) {
  const job = (item) => {
    const details = bullets
      ? {
          type: 'bullets',
          content: (sentences(item.details).length ? sentences(item.details) : ['']).map((sentence) => block('bullet', sentence, true)),
        }
      : block('details', item.details, true);
    return {
      type: 'job',
      content: [{ type: 'jobHead', content: [block('role', item.role, true), block('dates', item.dates, false)] }, details],
    };
  };
  const school = (item) => ({ type: 'school', content: [block('degree', item.degree, true), block('dates', item.dates, false)] });
  const blank = (make) => make({ role: '', dates: '', details: '', degree: '' });

  const summary = { type: 'summarySection', content: [block('summary', resume.summary, true)] };
  const experience = { type: 'experienceSection', content: resume.experience.length ? resume.experience.map(job) : [blank(job)] };
  const education = { type: 'educationSection', content: resume.education.length ? resume.education.map(school) : [blank(school)] };
  const skills = { type: 'skillsSection', content: [{ type: 'skillList', content: resume.skills.map((skill) => block('skill', skill, false)) }] };
  const header = { type: 'header', content: [block('name', resume.name, false), block('contact', resume.contact, true)] };
  const custom = (resume.extra ?? []).map((section) => ({
    type: 'customSection',
    content: [block('sectionTitle', section.title, false), ...(section.body?.length ? structuredClone(section.body) : [{ type: 'paragraph' }])],
  }));

  const body = columns === 2
    ? [{ type: 'columns', content: [{ type: 'mainColumn', content: [summary, experience, ...custom] }, { type: 'sideColumn', content: [education, skills] }] }]
    : [summary, experience, education, skills, ...custom];
  return { type: 'doc', content: [header, ...body] };
}

// ---------- document -> resume ----------

const kids = (node) => node?.content ?? [];
const first = (node, type) => kids(node).find((child) => child.type === type);

/**
 * The resume an edited document stands for. `before` is the resume the document was built
 * from: a rich field whose text is unchanged keeps the exact markup it had (so merely
 * opening a version never counts as an edit just because the tags were written in another
 * order), and a resume that had no jobs or no schools stays that way while their blank row
 * is untouched.
 */
export function resumeFromDoc(doc, before = null) {
  // The sections, wherever they sit: under the doc, or inside the two columns.
  const sections = {};
  const customSections = [];
  const collect = (node) => {
    if (node.type === 'columns' || node.type === 'mainColumn' || node.type === 'sideColumn') {
      kids(node).forEach(collect);
    } else if (node.type === 'customSection') {
      customSections.push(node);
    } else {
      sections[node.type] = node;
    }
  };
  kids(doc).forEach(collect);
  const header = sections.header;

  const keep = (value, original) => (typeof original === 'string' && canonical(original) === value ? original : value);
  const rich = (node, original) => keep(node ? richValue(node) : '', original);
  const plain = (node) => (node ? plainValue(node) : '');

  const jobs = kids(sections.experienceSection).map((job, index) => {
    const head = first(job, 'jobHead');
    const original = before?.experience?.[index];
    const bullets = first(job, 'bullets');
    const details = bullets
      ? normalizeText(kids(bullets).map(richValue).filter(Boolean).join(' '))
      : first(job, 'details') ? richValue(first(job, 'details')) : '';
    return {
      role: rich(first(head, 'role'), original?.role),
      dates: plain(first(head, 'dates')),
      details: keep(details, original?.details),
    };
  });
  const schools = kids(sections.educationSection).map((school, index) => ({
    degree: rich(first(school, 'degree'), before?.education?.[index]?.degree),
    dates: plain(first(school, 'dates')),
  }));

  const extra = customSections.map((node, index) => {
    const body = kids(node).filter((child) => child.type !== 'sectionTitle');
    const original = before?.extra?.[index];
    const title = plainValue(first(node, 'sectionTitle') ?? {});
    // Untouched, it is the very same object: the version history sees no edit.
    return original && original.title === title && sameBlocks(original.body, body) ? original : { title, body };
  });

  const empty = (item) => Object.values(item).every((value) => !value);
  const result = {
    ...(before ?? {}),
    name: plain(first(header, 'name')),
    contact: rich(first(header, 'contact'), before?.contact),
    summary: rich(first(sections.summarySection, 'summary'), before?.summary),
    experience: before && before.experience.length === 0 && jobs.every(empty) ? [] : jobs,
    education: before && before.education.length === 0 && schools.every(empty) ? [] : schools,
    skills: kids(first(sections.skillsSection, 'skillList')).map(plainValue).filter(Boolean),
  };
  if (extra.length || before?.extra) {
    result.extra = extra;
  }
  return result;
}

// ---------- naming the editable blocks ----------

/**
 * Every editable block of the document with the path the page knows it by, in reading order:
 * `{ path, type, pos, size, node }`. Works on the JSON tree and on a ProseMirror document;
 * `pos` and `size` are only filled for the latter (they are positions inside the editor).
 * A job's bullets count as one block, the "experience.N.details" field.
 */
export function listFields(doc) {
  const out = [];
  const typeOf = (node) => (typeof node.type === 'string' ? node.type : node.type.name);
  const childrenOf = (node) => (Array.isArray(node.content) ? node.content : node.content?.content ?? []);
  const counters = { job: -1, school: -1, skill: -1, custom: -1 };

  const visit = (node, pos, scope) => {
    const type = typeOf(node);
    const size = node.nodeSize ?? null;
    const add = (path) => out.push({ path, type, pos: size === null ? null : pos, size, node });
    let inner = scope;

    switch (type) {
      case 'job': counters.job += 1; inner = { kind: 'experience', index: counters.job }; break;
      case 'school': counters.school += 1; inner = { kind: 'education', index: counters.school }; break;
      case 'name': case 'contact': case 'summary': add(type); return;
      case 'role': add(`experience.${scope.index}.role`); return;
      case 'dates': add(`${scope.kind}.${scope.index}.dates`); return;
      case 'details': case 'bullets': add(`experience.${scope.index}.details`); return;
      case 'degree': add(`education.${scope.index}.degree`); return;
      case 'skill': counters.skill += 1; add(`skills.${counters.skill}`); return;
      case 'customSection': counters.custom += 1; add(`custom.${counters.custom}`); return;
      default: break;
    }

    let offset = pos + 1;
    for (const child of childrenOf(node)) {
      visit(child, offset, inner);
      offset += child.nodeSize ?? 0;
    }
  };
  visit(doc, -1, null); // the document's own content starts at position 0
  return out;
}

// ---------- how a parser reads the resume ----------

const textOf = (node) => (node?.content ?? []).map((child) => child.text ?? '').join('');
const listItemText = (item) => kids(item).map(textOf).join(' ');

/** One table cell as a single line of text: its paragraphs, and its bullets one after another. */
function cellText(cell) {
  return kids(cell)
    .flatMap((block) => (block.type === 'bulletList' ? kids(block).map(listItemText) : [textOf(block)]))
    .filter(Boolean)
    .join('; ');
}

/**
 * The resume as plain text in the order a parser reading the PDF's text would meet it: the
 * header, then the sections as they sit in the page (the main column before the side column
 * in a two-column layout), a table row by row and cell by cell. People test a resume for ATS
 * by pasting it into a plain-text editor, and this is that text.
 */
export function docToPlainText(doc, { hidden = [] } = {}) {
  const skip = new Set(hidden.map((name) => `${name}Section`));
  const lines = [];
  const heading = (text) => lines.push('', text.toUpperCase());
  const body = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'paragraph') {
        lines.push(textOf(node));
      } else if (node.type === 'bulletList') {
        kids(node).forEach((item) => lines.push(`- ${listItemText(item)}`));
      } else if (node.type === 'table') {
        kids(node).forEach((row) => lines.push(kids(row).map(cellText).join(' | ')));
      }
    }
  };
  const walk = (node) => {
    switch (node.type) {
      case 'name': case 'contact': case 'summary':
        lines.push(textOf(node));
        break;
      case 'summarySection': case 'experienceSection': case 'educationSection': case 'skillsSection':
        if (!skip.has(node.type)) {
          heading(SECTION_TITLES[node.type]);
          kids(node).forEach(walk);
        }
        break;
      case 'job': {
        const head = first(node, 'jobHead');
        lines.push([textOf(first(head, 'role')), textOf(first(head, 'dates'))].filter(Boolean).join(' | '));
        const bullets = first(node, 'bullets');
        if (bullets) {
          kids(bullets).forEach((item) => lines.push(`- ${textOf(item)}`));
        } else {
          lines.push(textOf(first(node, 'details')));
        }
        break;
      }
      case 'school':
        lines.push([textOf(first(node, 'degree')), textOf(first(node, 'dates'))].filter(Boolean).join(' | '));
        break;
      case 'skillList':
        lines.push(kids(node).map(textOf).filter(Boolean).join(', '));
        break;
      case 'customSection':
        heading(textOf(first(node, 'sectionTitle')));
        body(kids(node).filter((child) => child.type !== 'sectionTitle'));
        break;
      default:
        kids(node).forEach(walk);
    }
  };
  walk(doc);
  return lines.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** What to check in that reading order: one plain sentence per layout choice that parsers can trip over. */
export function readingNotes(doc) {
  const notes = [];
  const sections = [];
  const collect = (node) => {
    if (node.type === 'customSection') {
      sections.push(node);
    }
    kids(node).forEach(collect);
  };
  collect(doc);
  if (kids(doc).some((node) => node.type === 'columns')) {
    notes.push('Two columns: the main column (summary, experience) is read first, then the side column (education, skills). Some parsers read straight across both columns instead and mix them up.');
  }
  for (const section of sections) {
    if (kids(section).some((node) => node.type === 'table')) {
      notes.push(`The table in "${textOf(first(section, 'sectionTitle'))}" is read cell by cell, row by row. Some parsers scramble tables, so keep job titles, dates and employers out of them.`);
    }
  }
  if (!notes.length) {
    notes.push('One column and no tables: the safest layout for applicant tracking systems.');
  }
  return notes;
}
