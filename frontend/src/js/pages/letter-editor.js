import {
  Bold, Document, Editor, Gapcursor, Italic, Link, Node, Paragraph, Text, Underline, UndoRedo,
} from '../../vendor/tiptap.js';
import { safeHref } from './resume-builder-rules.js';

// The editor for a cover letter or a cold email: the draft itself is the editing surface (click anywhere
// and type), with undo and redo, bold, italic, underline and links, new paragraphs with Enter and a line
// break with Shift+Enter. Tiptap is bundled once into ../../vendor/tiptap.js, like the Builder's editor.
// Pasting keeps the words only. The converter between blocks and the document is letter-doc.js.

/** A line break inside a paragraph (the sign-off is one paragraph of lines). */
const HardBreak = Node.create({
  name: 'hardBreak',
  inline: true,
  group: 'inline',
  selectable: false,
  parseHTML: () => [{ tag: 'br' }],
  renderHTML: () => ['br'],
  addKeyboardShortcuts() {
    const lineBreak = () => this.editor.commands.insertContent({ type: 'hardBreak' });
    return { 'Shift-Enter': lineBreak, 'Mod-Enter': lineBreak };
  },
});

const lines = (text) => text.split('\n').flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]);

/**
 * Mounts the editor on `host` with `doc`. Callbacks: `onChange()` after an edit, `onSelection()` when the
 * caret or the document changes (to refresh the toolbar), `onBlur(relatedTarget)` when focus leaves.
 * @param {HTMLElement} host
 * @param {{ doc?: object, label?: string, onChange?: () => void, onSelection?: () => void, onBlur?: (to: Element | null) => void }} [options]
 */
export function createLetterEditor(host, { doc, label = 'Your draft', onChange, onSelection, onBlur } = {}) {
  const editor = new Editor({
    element: host,
    extensions: [
      Document, Paragraph, Text, HardBreak, Bold, Italic, Underline,
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: (url) => Boolean(safeHref(url)),
        HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      }),
      Gapcursor,
      UndoRedo.configure({ depth: 100 }),
    ],
    content: doc,
    editorProps: {
      attributes: { class: 'letters-doc-editor', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'true' },
      // Pasting keeps the words only: a blank line starts a new paragraph, a single line break stays a break.
      handlePaste: (view, event) => {
        const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r/g, '');
        const parts = text.split(/\n{2,}/).map((part) => part.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
        if (parts.length) {
          editor.commands.insertContent(parts.length === 1 ? lines(parts[0]) : parts.map((part) => ({ type: 'paragraph', content: lines(part) })));
        }
        return true;
      },
      handleDrop: () => true,
    },
    onUpdate: () => onChange?.(),
    onTransaction: () => onSelection?.(),
    onBlur: ({ event }) => onBlur?.(event?.relatedTarget ?? null),
  });

  return {
    getJSON: () => editor.getJSON(),
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    canUndo: () => editor.can().undo(),
    canRedo: () => editor.can().redo(),
    toggle: (mark) => editor.chain().focus().toggleMark(mark).run(),
    isActive: (mark) => editor.isActive(mark),
    hasSelection: () => !editor.state.selection.empty,
    hasFocus: () => editor.isFocused,
    /** Links the selected text, or inserts `label` as the link when nothing is selected. */
    setLink(href, text) {
      const chain = editor.chain().focus();
      if (editor.state.selection.empty) {
        chain.insertContent([{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }, { type: 'text', text: ' ' }]).run();
      } else {
        chain.extendMarkRange('link').setLink({ href }).run();
      }
    },
    focus: () => editor.view.focus(),
    destroy: () => editor.destroy(),
  };
}
