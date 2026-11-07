import {
  Bold, BulletList, Decoration, DecorationSet, Document, Editor, Extension, Gapcursor, Italic, Link, ListItem, Mark, Node, Paragraph,
  Plugin, PluginKey, Table, TableCell, TableHeader, TableRow, Text, TextSelection, Underline, UndoRedo, mergeAttributes,
} from '../../vendor/tiptap.js';
import { getAt, normalizeText, safeColor, safeHref } from './resume-builder-rules.js';
import {
  SECTION_TITLES, TABLE_DEFAULTS, listFields, newSection, normalizeTableAttrs, resumeFromDoc, resumeToDoc, tableClass, tableStyle,
} from './resume-doc.js';

// The editable resume: a Tiptap (ProseMirror) editor whose document is shaped like a resume,
// so a person can only type into the fields, never break the layout. resume-doc.js converts
// between this document and the plain resume object the rest of the Resume Builder keeps
// (versions, Lay AI, the tests); this file adds the editor, its schema, and the few things
// Lay AI needs from it: which field the caret is in, where the caret is on screen, a
// highlight on the fields Lay AI just changed, and focus on a given field. Tiptap itself is
// bundled once into ../../vendor/tiptap.js (see frontend/vendor-build), so the page keeps
// its no-build-step setup.

const RICH_MARKS = 'bold italic underline link textColor';

/**
 * Text colour: one `#rrggbb` per run of text, only ever one that safeColor() accepts (dark enough to
 * read on white paper). Stored in the resume as <font color="#rrggbb">, in a custom section as this mark.
 */
const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => safeColor(element.getAttribute('data-text-color')),
        renderHTML: (attributes) => (attributes.color ? { 'data-text-color': attributes.color, style: `color: ${attributes.color}` } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: 'span[data-text-color]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});
const RICH_TYPES = new Set(['contact', 'summary', 'role', 'details', 'bullets', 'degree', 'customSection']);

// ---------- the schema ----------

/** A block of text that is one field of the resume. */
function fieldNode(name, tag, className, { rich }) {
  return Node.create({
    name,
    content: 'text*',
    marks: rich ? RICH_MARKS : '',
    parseHTML: () => [{ tag: `${tag}[data-node="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [
      tag,
      mergeAttributes(HTMLAttributes, { class: `rb-field ${className}`.trim(), 'data-node': name }),
      0,
    ],
  });
}

/** A container that only gives structure: header, a section, a job. */
function groupNode(name, content, tag, className, extra = {}) {
  return Node.create({
    name,
    content,
    isolating: true,
    parseHTML: () => [{ tag: `${tag}[data-node="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [
      tag,
      mergeAttributes(HTMLAttributes, { class: className, 'data-node': name, ...extra }),
      0,
    ],
  });
}

const section = (name, content) =>
  groupNode(name, content, 'section', 'rb-section', { 'data-title': SECTION_TITLES[name], role: 'group', 'aria-label': SECTION_TITLES[name] });

// One column: the four sections in a row under the header. Two columns: the same sections in a
// main and a side column (see resume-doc.js).
const ResumeDocument = Document.extend({
  content: 'header (summarySection experienceSection educationSection skillsSection customSection* | columns)',
});

// A custom section's blocks: paragraphs, bullet lists and tables. A table here starts as a plain grid
// with visible lines; its line width (0 hides the lines, like the "table with no borders" people
// build in Word to put skills side by side), style and spacing can be changed, and the cells are
// only ever paragraphs and bullets. The look is five attributes, normalized in resume-doc.js.
const CUSTOM_BLOCKS = '(paragraph | bulletList | table)+';
const CELL_BLOCKS = '(paragraph | bulletList)+';

/** One table attribute: its default, and how it reads from and writes to `data-*` (the look itself is classes and style). */
const tableAttribute = (key, name, number) => ({
  default: TABLE_DEFAULTS[key],
  parseHTML: (element) => (number ? Number(element.getAttribute(name)) : element.getAttribute(name)) ?? TABLE_DEFAULTS[key],
  renderHTML: (attributes) => ({ [name]: String(attributes[key]) }),
});

const ResumeTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borders: tableAttribute('borders', 'data-borders', false),
      borderWidth: tableAttribute('borderWidth', 'data-border-width', true),
      borderStyle: tableAttribute('borderStyle', 'data-border-style', false),
      cellPadding: tableAttribute('cellPadding', 'data-cell-padding', true),
      cellGap: tableAttribute('cellGap', 'data-cell-gap', true),
    };
  },
  // The look is drawn by the same two functions as the finished page uses, so they cannot disagree.
  renderHTML({ node, HTMLAttributes }) {
    return ['table', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: tableClass(node.attrs), style: tableStyle(node.attrs) }), ['tbody', 0]];
  },
  // Tiptap's own table view never redraws the table when an attribute such as `borderWidth` changes, and
  // column dragging is off here anyway, so the table is drawn from the schema like any other node.
  addNodeView() {
    return null;
  },
}).configure({ resizable: false });

const schemaExtensions = [
  ResumeDocument,
  Text,
  groupNode('header', 'name contact', 'header', 'rb-head'),
  groupNode('columns', 'mainColumn sideColumn', 'div', 'rb-columns'),
  groupNode('mainColumn', 'summarySection experienceSection customSection*', 'div', 'rb-col-main'),
  groupNode('sideColumn', 'educationSection skillsSection', 'div', 'rb-col-side'),
  fieldNode('name', 'h2', 'rb-name', { rich: false }),
  fieldNode('contact', 'p', 'rb-contact', { rich: true }),
  section('summarySection', 'summary'),
  fieldNode('summary', 'p', '', { rich: true }),
  section('experienceSection', 'job+'),
  groupNode('job', 'jobHead (details | bullets)', 'div', 'rb-item'),
  groupNode('jobHead', 'role dates', 'div', 'rb-item-head'),
  fieldNode('role', 'p', 'rb-strong', { rich: true }),
  fieldNode('dates', 'p', 'rb-dates', { rich: false }),
  fieldNode('details', 'p', '', { rich: true }),
  Node.create({
    name: 'bullets',
    content: 'bullet+',
    isolating: true,
    parseHTML: () => [{ tag: 'ul[data-node="bullets"]' }],
    renderHTML: ({ HTMLAttributes }) => ['ul', mergeAttributes(HTMLAttributes, { class: 'rb-field rb-bullets', 'data-node': 'bullets' }), 0],
  }),
  Node.create({
    name: 'bullet',
    content: 'text*',
    marks: RICH_MARKS,
    defining: true,
    parseHTML: () => [{ tag: 'li[data-node="bullet"]' }],
    renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes, { 'data-node': 'bullet' }), 0],
  }),
  section('educationSection', 'school+'),
  groupNode('school', 'degree dates', 'div', 'rb-item-head'),
  fieldNode('degree', 'p', 'rb-strong', { rich: true }),
  section('skillsSection', 'skillList'),
  Node.create({
    name: 'skillList',
    content: 'skill*',
    isolating: true,
    parseHTML: () => [{ tag: 'ul[data-node="skillList"]' }],
    renderHTML: ({ HTMLAttributes }) => ['ul', mergeAttributes(HTMLAttributes, { class: 'rb-skills', 'data-node': 'skillList' }), 0],
  }),
  Node.create({
    name: 'skill',
    content: 'text*',
    marks: '',
    defining: true,
    parseHTML: () => [{ tag: 'li[data-node="skill"]' }],
    renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes, { class: 'rb-field', 'data-node': 'skill' }), 0],
  }),
  groupNode('customSection', `sectionTitle ${CUSTOM_BLOCKS}`, 'section', 'rb-section rb-custom', { role: 'group' }),
  fieldNode('sectionTitle', 'h3', 'rb-section-title', { rich: false }),
  Paragraph,
  BulletList.configure({ HTMLAttributes: { class: 'rb-bullets' } }),
  ListItem.extend({ content: 'paragraph' }),
  ResumeTable,
  TableRow,
  TableHeader.extend({ content: CELL_BLOCKS }),
  TableCell.extend({ content: CELL_BLOCKS }),
  Gapcursor,
  Bold,
  Italic,
  Underline,
  TextColor,
  Link.configure({
    openOnClick: false,
    autolink: false,
    linkOnPaste: false,
    isAllowedUri: (url) => Boolean(safeHref(url)),
    HTMLAttributes: { rel: 'noopener noreferrer', target: null },
  }),
  UndoRedo.configure({ depth: 100 }),
];

// ---------- behaviour ----------

/** Keys that would otherwise break the fixed layout: Enter, and Backspace or Delete at a block's edge. */
const LayoutKeys = Extension.create({
  name: 'layoutKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const parentInfo = (editor) => {
      const { selection } = editor.state;
      const { $from } = selection;
      return { selection, $from, type: $from.parent.type.name, index: $from.index(-1), siblings: $from.node(-1).childCount };
    };
    const listItem = (type) => type === 'skill' || type === 'bullet';
    // Paragraphs (in a custom section, a list or a table cell) are ordinary text: Enter, Backspace and Delete work as usual.
    const ordinary = (type) => type === 'paragraph';
    return {
      // Enter ends the edit in a one-line field, and adds a skill or a bullet in a list.
      Enter: ({ editor }) => {
        const { type } = parentInfo(editor);
        if (listItem(type) || ordinary(type)) {
          return false;
        }
        editor.view.dom.blur();
        return true;
      },
      Backspace: ({ editor }) => {
        const { selection, $from, type, index } = parentInfo(editor);
        if (!selection.empty || $from.parentOffset !== 0) {
          return false;
        }
        if (ordinary(type)) {
          // The first paragraph under a section title must not be merged into the title.
          return $from.node(-1).type.name === 'customSection' && index === 1;
        }
        return !(listItem(type) && index > 0);
      },
      Delete: ({ editor }) => {
        const { selection, $from, type, index, siblings } = parentInfo(editor);
        if (!selection.empty || $from.parentOffset !== $from.parent.content.size) {
          return false;
        }
        if (ordinary(type)) {
          return false;
        }
        return !(listItem(type) && index < siblings - 1);
      },
    };
  },
});

const TABLE_COMMANDS = ['addColumnBefore', 'addColumnAfter', 'deleteColumn', 'addRowBefore', 'addRowAfter', 'deleteRow', 'mergeCells', 'splitCell', 'toggleHeaderRow', 'deleteTable'];

const highlightKey = new PluginKey('rbHighlight');

/** Marks the fields Lay AI just changed (`diffResume()` of its change) and draws the "+ Skill" button. */
const ResumeDecorations = Extension.create({
  name: 'resumeDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: highlightKey,
        state: {
          init: () => null,
          apply: (tr, value) => (tr.getMeta(highlightKey) !== undefined ? tr.getMeta(highlightKey).changes : value),
        },
        props: {
          decorations(state) {
            const changes = highlightKey.getState(state);
            const decorations = [];
            // The field the caret is in: its outline shows while the editor has focus.
            const { head } = state.selection;
            for (const field of listFields(state.doc)) {
              if (head > field.pos && head < field.pos + field.size) {
                decorations.push(Decoration.node(field.pos, field.pos + field.size, { class: 'is-current' }));
              }
            }
            if (changes) {
              const added = new Set(changes.addedSkills.map((skill) => skill.toLowerCase()));
              for (const field of listFields(state.doc)) {
                const changed = changes.fields.includes(field.path)
                  || (field.type === 'skill' && added.has(field.node.textContent.toLowerCase()));
                if (changed) {
                  decorations.push(Decoration.node(field.pos, field.pos + field.size, { class: 'is-changed' }));
                }
              }
            }
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'skillList') {
                decorations.push(Decoration.widget(pos + node.nodeSize - 1, addSkillButton, { side: 1, key: 'add-skill', stopEvent: () => true, ignoreSelection: true }));
                return false;
              }
              return true;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

function addSkillButton() {
  const item = document.createElement('li');
  item.className = 'rb-add';
  item.contentEditable = 'false';
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'rb-add-skill';
  button.className = 'btn btn-ghost btn-sm';
  button.textContent = '+ Skill';
  item.append(button);
  return item;
}

// ---------- the editor for the page ----------

/**
 * Creates the resume editor inside `host`. `handlers` are called as the person works:
 * `onTyping()` after an edit, `onSelection()` when the caret moves, `onFocus()`, and
 * `onBlur(relatedTarget)` when focus leaves the editor (the target says where it went).
 */
export function createResumeEditor(host, { onTyping, onSelection, onFocus, onBlur } = {}) {
  let dirty = false;
  let fieldCache = { doc: null, fields: [] };

  const fields = () => {
    const { doc } = editor.state;
    if (fieldCache.doc !== doc) {
      fieldCache = { doc, fields: listFields(doc) };
    }
    return fieldCache.fields;
  };

  const editor = new Editor({
    element: host,
    extensions: [...schemaExtensions, LayoutKeys, ResumeDecorations],
    content: resumeToDoc({ name: '', contact: '', summary: '', experience: [], education: [], skills: [] }),
    editorProps: {
      attributes: { class: 'rb-doc', 'aria-label': 'Your resume', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
      // Pasting keeps the words only: no styles, fonts or line breaks from Word or a web page.
      handlePaste: (view, event) => {
        const text = normalizeText(event.clipboardData?.getData('text/plain'));
        if (text) {
          view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        }
        return true;
      },
      handleDrop: () => true,
    },
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged && !transaction.getMeta('rbSync')) {
        dirty = true;
        onTyping?.();
      }
    },
    onSelectionUpdate: () => onSelection?.(),
    onFocus: () => onFocus?.(),
    onBlur: ({ event }) => onBlur?.(event?.relatedTarget ?? null),
  });

  const currentField = () => {
    const { head } = editor.state.selection;
    const found = fields().find((field) => head > field.pos && head < field.pos + field.size);
    return found ? { path: found.path, type: found.type, rich: RICH_TYPES.has(found.type), pos: found.pos, size: found.size } : null;
  };

  const fieldByPath = (path) => fields().find((field) => field.path === path) ?? null;

  const skillListEnd = () => {
    let end = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'skillList') {
        end = pos + node.nodeSize - 1;
        return false;
      }
      return true;
    });
    return end;
  };

  /** Every custom section in the document, with its position. */
  const customSections = () => {
    const found = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'customSection') {
        found.push({ node, pos });
        return false;
      }
      return true;
    });
    return found;
  };

  /** The custom section around the caret (and the table, if the caret is in one), or null. */
  const currentSection = () => {
    const { $head } = editor.state.selection;
    let table = null;
    for (let depth = $head.depth; depth > 0; depth -= 1) {
      const node = $head.node(depth);
      if (node.type.name === 'table' && !table) {
        table = node;
      }
      if (node.type.name === 'customSection') {
        return { node, pos: $head.before(depth), table };
      }
    }
    return null;
  };

  return {
    /** Shows `resume` in the editor without adding to the undo history. */
    setResume(resume, { bullets = false, columns = 1 } = {}) {
      const doc = editor.schema.nodeFromJSON(resumeToDoc(resume, { bullets, columns }));
      const { state, view } = editor;
      view.dispatch(state.tr.replaceWith(0, state.doc.content.size, doc.content).setMeta('addToHistory', false).setMeta('rbSync', true));
      dirty = false;
    },
    /** The resume the document holds now; `before` keeps untouched fields exactly as they were. */
    getResume: (before) => resumeFromDoc(editor.getJSON(), before),
    isDirty: () => dirty,
    markClean() {
      dirty = false;
    },
    setHighlight(changes) {
      editor.view.dispatch(editor.state.tr.setMeta(highlightKey, { changes }).setMeta('rbSync', true).setMeta('addToHistory', false));
    },
    currentField,
    /** The text of the field the caret is in, as the resume would store it. */
    currentValue(before) {
      const field = currentField();
      return field ? getAt(resumeFromDoc(editor.getJSON(), before), field.path) ?? '' : '';
    },
    hasFocus: () => editor.isFocused,
    focus: () => editor.view.focus(),
    /**
     * Removes skill chips that were left empty (not the one the caret is in), so the editor
     * and the saved resume list the same skills. A small edit, so the caret stays where it is.
     */
    dropEmptySkills() {
      const { head } = editor.state.selection;
      const empty = fields().filter((field) => field.type === 'skill' && !field.node.textContent.trim() && !(head > field.pos && head < field.pos + field.size));
      if (!empty.length) {
        return;
      }
      const tr = editor.state.tr;
      for (const field of empty.reverse()) {
        tr.delete(field.pos, field.pos + field.size);
      }
      editor.view.dispatch(tr.setMeta('rbSync', true).setMeta('addToHistory', false));
    },
    blur: () => editor.view.dom.blur(),
    /** Where the caret is on screen (a viewport rectangle), or null when there is none. */
    caretRect() {
      if (!editor.isFocused && !currentField()) {
        return null;
      }
      try {
        const rect = editor.view.coordsAtPos(editor.state.selection.head);
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      } catch {
        return null;
      }
    },
    /** Where the selected text starts on screen (a viewport rectangle), or null with no selection. */
    selectionRect() {
      const { from, empty } = editor.state.selection;
      if (empty) {
        return null;
      }
      try {
        const rect = editor.view.coordsAtPos(from);
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      } catch {
        return null;
      }
    },
    fieldRect(path) {
      const field = fieldByPath(path);
      const dom = field ? editor.view.nodeDOM(field.pos) : null;
      return dom instanceof Element ? dom.getBoundingClientRect() : null;
    },
    focusField(path) {
      const field = fieldByPath(path);
      if (!field) {
        return false;
      }
      const end = editor.state.doc.resolve(field.pos + field.size - 1);
      editor.chain().setTextSelection(TextSelection.near(end, -1).head).run();
      editor.view.focus();
      return true;
    },
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    canUndo: () => editor.can().undo(),
    canRedo: () => editor.can().redo(),
    toggle: (mark) => editor.chain().focus().toggleMark(mark).run(),
    isActive: (mark) => editor.isActive(mark),
    /** The colour of the text at the caret as `#rrggbb`, or null when it has none (automatic, black). */
    currentColor: () => safeColor(editor.getAttributes('textColor').color),
    /**
     * Colours the selected text (or the next text typed, with only a caret). `null` clears the colour.
     * Returns false, and changes nothing, for a colour that safeColor() refuses.
     */
    setColor(hex) {
      const color = hex === null ? null : safeColor(hex);
      if (hex !== null && !color) {
        return false;
      }
      const chain = editor.chain().focus();
      (color ? chain.setMark('textColor', { color }) : chain.unsetMark('textColor')).run();
      return true;
    },
    hasSelection: () => !editor.state.selection.empty,
    /** Links the selected text, or inserts `label` as the link when nothing is selected. */
    setLink(href, label) {
      const chain = editor.chain().focus();
      if (editor.state.selection.empty) {
        chain.insertContent([{ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] }, { type: 'text', text: ' ' }]).run();
      } else {
        chain.extendMarkRange('link').setLink({ href }).run();
      }
    },
    /** A new empty skill at the end of the list, with the caret in it. */
    addSkill() {
      const at = skillListEnd();
      if (at !== null) {
        editor.chain().insertContentAt(at, { type: 'skill' }).setTextSelection(at + 1).run();
        editor.view.focus();
      }
    },
    onSkillButton(handler) {
      editor.view.dom.addEventListener('click', (event) => {
        if (event.target.closest?.('#rb-add-skill')) {
          handler();
        }
      });
    },
    // ----- custom sections and their tables -----

    /** Where the caret is among the custom sections: `{ index, count, title, inTable, table }` (`table` is the table's look, or null), or null outside one. */
    sectionState() {
      const found = currentSection();
      if (!found) {
        return null;
      }
      const all = customSections();
      return {
        index: all.findIndex((candidate) => candidate.pos === found.pos),
        count: all.length,
        title: found.node.firstChild.textContent,
        inTable: Boolean(found.table),
        table: found.table ? normalizeTableAttrs(found.table.attrs) : null,
      };
    },
    /**
     * Adds a custom section ('text', 'bullets' or 'table' with `columns` columns) after the
     * others, and selects its title so typing renames it. Tables start as a plain grid with visible lines.
     */
    addSection(kind, columns) {
      const { doc } = editor.state;
      let at = doc.content.size;
      doc.forEach((node, offset) => {
        if (node.type.name === 'columns') {
          at = offset + node.firstChild.nodeSize; // the end of the main column
        }
      });
      const made = newSection(kind, columns);
      const section = editor.schema.nodeFromJSON({
        type: 'customSection',
        content: [{ type: 'sectionTitle', content: [{ type: 'text', text: made.title }] }, ...made.body],
      });
      const tr = editor.state.tr.insert(at, section);
      tr.setSelection(TextSelection.create(tr.doc, at + 2, at + 2 + made.title.length));
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
    },
    /** Moves the section the caret is in up (-1) or down (1) past its neighbour. */
    moveSection(delta) {
      const found = currentSection();
      const all = customSections();
      const i = all.findIndex((candidate) => found && candidate.pos === found.pos);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= all.length) {
        return false;
      }
      const [first, second] = i < j ? [all[i], all[j]] : [all[j], all[i]];
      if (second.pos !== first.pos + first.node.nodeSize) {
        return false;
      }
      const tr = editor.state.tr.replaceWith(first.pos, second.pos + second.node.nodeSize, [second.node, first.node]);
      const movedAt = delta < 0 ? first.pos : first.pos + second.node.nodeSize;
      tr.setSelection(TextSelection.near(tr.doc.resolve(movedAt + 2)));
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    },
    deleteSection() {
      const found = currentSection();
      if (!found) {
        return false;
      }
      const tr = editor.state.tr.delete(found.pos, found.pos + found.node.nodeSize);
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found.pos, tr.doc.content.size)), -1));
      editor.view.dispatch(tr);
      return true;
    },
    /** A table command by name (add or delete a column or row, merge, split, header row, delete table). */
    tableCommand(name) {
      return TABLE_COMMANDS.includes(name) ? editor.chain().focus()[name]().run() : false;
    },
    canTable: (name) => TABLE_COMMANDS.includes(name) && editor.can()[name](),
    /**
     * Changes the look of the table the caret is in: any of `borders`, `borderWidth`, `borderStyle`, `cellPadding`,
     * `cellGap`. Values outside the limits are brought inside them; what changed is returned as the table now is.
     */
    setTableLook(changes) {
      const table = currentSection()?.table;
      if (!table) {
        return null;
      }
      const look = normalizeTableAttrs({ ...table.attrs, ...changes });
      // No focus() here: the person may be stepping a number box with the arrow keys, and focus must stay in it.
      editor.chain().updateAttributes('table', look).run();
      return look;
    },
    /** A plain grid with no header row, like the one Word inserts, with visible lines. */
    insertTable: (rows, columns) => editor.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: false }).run(),
    destroy: () => editor.destroy(),
  };
}
