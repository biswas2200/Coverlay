// What the Resume Builder needs from Tiptap, in one place. `npm run build` bundles this file
// into ../src/vendor/tiptap.js, which the page imports as a plain ES module.
export { Editor, Extension, Node, Mark, mergeAttributes } from '@tiptap/core';
export { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
export { Decoration, DecorationSet } from '@tiptap/pm/view';
export { default as Document } from '@tiptap/extension-document';
export { default as Text } from '@tiptap/extension-text';
export { default as Bold } from '@tiptap/extension-bold';
export { default as Italic } from '@tiptap/extension-italic';
export { default as Underline } from '@tiptap/extension-underline';
export { default as Link } from '@tiptap/extension-link';
export { UndoRedo, Gapcursor } from '@tiptap/extensions';
export { default as Paragraph } from '@tiptap/extension-paragraph';
export { BulletList, ListItem } from '@tiptap/extension-list';
export { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
export { CellSelection } from '@tiptap/pm/tables';
