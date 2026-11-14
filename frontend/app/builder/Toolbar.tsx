import { useEffect, useState, type FormEvent, type MouseEvent, type RefObject } from 'react';
import { Icon } from '@/components/Icon';
import type { BuilderFormat } from '@/types/builder';
import { FONT_SIZE, TEXT_COLORS } from '@legacy/pages/resume-builder-rules.js';

// The formatting toolbar above the page (text, then page and content), the section and table tools that appear when the
// caret is in a custom section, the link bar, and the small floating bar above selected text.

export interface ToolState {
  undo: boolean;
  redo: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** The colour of the text at the caret, shown as the bar under the A. */
  picked: string;
  /** The colour at the caret, for the picker's checkmarks (null is automatic). */
  color: string | null;
}

export const NO_TOOLS: ToolState = { undo: false, redo: false, bold: false, italic: false, underline: false, picked: '#000000', color: null };

/** Pressing a tool must not take the selection out of the field being edited. */
const keepSelection = (event: MouseEvent) => {
  if ((event.target as Element).closest('.rb-tool, .rb-swatch, .rb-colors-auto')) {
    event.preventDefault();
  }
};

interface ToolbarProps {
  format: BuilderFormat;
  pages: number;
  tools: ToolState;
  colorsOpen: boolean;
  colorNote: string;
  onToggleColors: () => void;
  onApplyColor: (hex: string | null) => void;
  onFormat: (key: string, value: string | number | boolean) => void;
  onCommand: (command: Command) => void;
  onLimit: (pages: number) => void;
  onAddSection: (value: string) => void;
  onFit: () => void;
  onOpenSetup: () => void;
  toolbarRef?: RefObject<HTMLDivElement | null>;
}

type Command = 'undo' | 'redo' | 'bold' | 'italic' | 'underline' | 'link' | 'color';

function ToolButton({ command, label, title, pressed, disabled, onCommand, children }: { command: Command; label: string; title: string; pressed?: boolean; disabled?: boolean; onCommand: (command: Command) => void; children: React.ReactNode }) {
  return (
    <button className="rb-tool" type="button" aria-label={label} title={title} aria-pressed={pressed} disabled={disabled} onClick={() => onCommand(command)}>
      {children}
    </button>
  );
}

export function Toolbar({ format, pages, tools, colorsOpen, colorNote, onToggleColors, onApplyColor, onFormat, onCommand, onLimit, onAddSection, onFit, onOpenSetup, toolbarRef }: ToolbarProps) {
  // The text size box applies when it is left or Enter is pressed, not on every key (typing 10 passes through 1).
  const [size, setSize] = useState(String(format.fontSize));
  useEffect(() => setSize(String(format.fontSize)), [format.fontSize]);
  const applySize = () => size !== '' && onFormat('fontSize', Number(size));
  const [custom, setCustom] = useState('#1d4ed8');

  return (
    <div className="rb-toolbar" id="rb-toolbar" role="toolbar" aria-label="Formatting" aria-controls="rb-editor" ref={toolbarRef} onMouseDown={keepSelection}>
      <div className="rb-toolbar-row" role="group" aria-label="Text">
        <div className="rb-tool-group" role="group" aria-label="History">
          <ToolButton command="undo" label="Undo" title="Undo (Ctrl+Z)" disabled={!tools.undo} onCommand={onCommand}><Icon name="undo" /></ToolButton>
          <ToolButton command="redo" label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!tools.redo} onCommand={onCommand}><Icon name="redo" /></ToolButton>
        </div>
        <div className="rb-tool-group" role="group" aria-label="Font">
          <label className="sr-only" htmlFor="fmt-font">Font</label>
          <select className="select" id="fmt-font" value={format.font} onChange={(event) => onFormat('font', event.target.value)}>
            <option value="sans">Sans</option>
            <option value="serif">Serif</option>
            <option value="classic">LaTeX (CMU Serif)</option>
          </select>
          <button className="rb-tool" type="button" aria-label="Make the text smaller" title="Smaller text" onClick={() => onFormat('fontSize', format.fontSize - FONT_SIZE.step)}><span aria-hidden="true">&minus;</span></button>
          <label className="sr-only" htmlFor="fmt-fontsize">Text size in points</label>
          <input
            className="input rb-size-input"
            id="fmt-fontsize"
            type="number"
            inputMode="decimal"
            min={8}
            max={14}
            step={0.5}
            title="Text size (pt)"
            value={size}
            onChange={(event) => setSize(event.target.value)}
            onBlur={applySize}
            onKeyDown={(event) => event.key === 'Enter' && applySize()}
          />
          <button className="rb-tool" type="button" aria-label="Make the text bigger" title="Bigger text" onClick={() => onFormat('fontSize', format.fontSize + FONT_SIZE.step)}><span aria-hidden="true">+</span></button>
        </div>
        <div className="rb-tool-group" role="group" aria-label="Text style">
          <ToolButton command="bold" label="Bold" title="Bold (Ctrl+B)" pressed={tools.bold} onCommand={onCommand}><b>B</b></ToolButton>
          <ToolButton command="italic" label="Italic" title="Italic (Ctrl+I)" pressed={tools.italic} onCommand={onCommand}><i>I</i></ToolButton>
          <ToolButton command="underline" label="Underline" title="Underline (Ctrl+U)" pressed={tools.underline} onCommand={onCommand}><u>U</u></ToolButton>
          <div className="rb-color">
            <button
              className="rb-tool rb-tool-color"
              type="button"
              aria-label="Text colour"
              aria-haspopup="true"
              aria-expanded={colorsOpen}
              aria-controls="rb-colors"
              title="Text colour"
              style={{ '--picked': tools.picked } as React.CSSProperties}
              onClick={onToggleColors}
            >
              <span className="rb-color-a" aria-hidden="true">A</span>
              <span className="rb-color-bar" aria-hidden="true" />
            </button>
            <div className="rb-colors" id="rb-colors" role="group" aria-label="Text colour" hidden={!colorsOpen}>
              <button className="btn btn-secondary btn-sm rb-colors-auto" type="button" aria-pressed={tools.color === null} onClick={() => onApplyColor(null)}>Automatic (black)</button>
              <div className="rb-swatches">
                {(TEXT_COLORS as { name: string; hex: string }[]).map(({ name, hex }) => (
                  <button key={hex} className="rb-swatch" type="button" title={name} aria-label={name} aria-pressed={tools.color === hex} style={{ '--swatch': hex } as React.CSSProperties} onClick={() => onApplyColor(hex)} />
                ))}
              </div>
              <label className="rb-colors-custom" htmlFor="color-custom">
                <span>Custom colour</span>
                <input type="color" id="color-custom" value={custom} onChange={(event) => { setCustom(event.target.value); onApplyColor(event.target.value); }} />
              </label>
              <p className="rb-colors-note" role="status">{colorNote}</p>
            </div>
          </div>
          <ToolButton command="link" label="Add a link" title="Add a link" onCommand={onCommand}><Icon name="link" /></ToolButton>
        </div>
        <div className="rb-tool-group" role="group" aria-label="Paragraph">
          <button className="rb-tool" type="button" aria-pressed={format.bullets} aria-label="Experience as bullet points" title="Experience as bullet points" onClick={() => onFormat('bullets', !format.bullets)}><Icon name="list" /></button>
          <label className="sr-only" htmlFor="fmt-align">Header alignment</label>
          <select className="select" id="fmt-align" value={format.align} onChange={(event) => onFormat('align', event.target.value)}>
            <option value="left">Header left</option>
            <option value="center">Header centred</option>
          </select>
          <label className="sr-only" htmlFor="fmt-spacing">Line spacing</label>
          <select className="select" id="fmt-spacing" title="Line spacing" value={format.spacing} onChange={(event) => onFormat('spacing', event.target.value)}>
            <option value="tight">Tight</option>
            <option value="normal">Normal</option>
            <option value="airy">Airy</option>
          </select>
        </div>
      </div>
      <div className="rb-toolbar-row" role="group" aria-label="Page and content">
        <div className="rb-tool-group" role="group" aria-label="Insert">
          <label className="sr-only" htmlFor="add-section">Add a section</label>
          <select className="select" id="add-section" title="Add a section" value="" onChange={(event) => onAddSection(event.target.value)}>
            <option value="">+ Add section…</option>
            <option value="text">Text section</option>
            <option value="bullets">Bullet list section</option>
            <option value="table-2">Table: 2 columns</option>
            <option value="table-3">Table: 3 columns</option>
            <option value="table-4">Table: 4 columns</option>
          </select>
        </div>
        <div className="rb-tool-group" role="group" aria-label="Page setup">
          <label className="sr-only" htmlFor="fmt-columns">Columns</label>
          <select className="select" id="fmt-columns" title="One column is the safest for ATS" value={String(format.columns)} onChange={(event) => onFormat('columns', Number(event.target.value))}>
            <option value="1">One column</option>
            <option value="2">Two columns</option>
          </select>
          <label className="sr-only" htmlFor="fmt-limit">Page limit</label>
          <select className="select" id="fmt-limit" title="How many pages the resume may take" value={String(pages)} onChange={(event) => onLimit(Number(event.target.value))}>
            <option value="1">1 page</option>
            <option value="2">2 pages</option>
          </select>
          <button className="btn btn-secondary btn-sm" type="button" title="Paper size, margins on each side, units and more" onClick={onOpenSetup}>Page setup…</button>
          <button className="btn btn-secondary btn-sm" type="button" title="Tighten spacing, margins and text size until it fits the page limit. Nothing is deleted." onClick={onFit}>Fit to page</button>
        </div>
        <div className="rb-tool-group rb-tool-style">
          <label htmlFor="fmt-style">Writing style</label>
          <select className="select" id="fmt-style" value={format.style} onChange={(event) => onFormat('style', event.target.value)}>
            <option value="formal">Formal</option>
            <option value="concise">Concise</option>
            <option value="friendly">Friendly</option>
            <option value="beginner">Beginner</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ---------- the section and table tools ----------

export interface SectionState {
  index: number;
  count: number;
  title: string;
  inTable: boolean;
  table: { borders: string; borderStyle: string; borderWidth: number; cellPadding: number; cellGap: number } | null;
}

const TABLE_BUTTONS = [
  ['addColumnAfter', 'Column +', undefined],
  ['deleteColumn', 'Column −', undefined],
  ['addRowAfter', 'Row +', undefined],
  ['deleteRow', 'Row −', undefined],
  ['mergeCells', 'Merge', 'Select cells by dragging across them, then merge'],
  ['splitCell', 'Split', undefined],
  ['toggleHeaderRow', 'Header row', undefined],
  ['deleteTable', 'Delete table', undefined],
] as const;

const LOOK_FIELDS = [
  ['borderWidth', 'Width', 0, 6, 0.25, 'Line width in points. 0 hides the lines; the table stays.'],
  ['cellPadding', 'Padding', 0, 12, 0.5, 'Space inside each cell, in points'],
  ['cellGap', 'Gap', 0, 12, 0.5, 'Space between cells, in points. 0 joins the lines.'],
] as const;

function LookNumber({ id, label, min, max, step, title, value, onCommit }: { id: string; label: string; min: number; max: number; step: number; title: string; value: number; onCommit: (value: string) => number | null }) {
  const [text, setText] = useState(String(value));
  const [typing, setTyping] = useState(false);
  // Not while the person is typing in the box: that would rewrite what they have half typed.
  useEffect(() => {
    if (!typing) {
      setText(String(value));
    }
  }, [value, typing]);
  const commit = () => {
    setTyping(false);
    const kept = onCommit(text);
    setText(String(kept ?? value)); // show what was kept, e.g. 9 pt of width becomes 6
  };
  return (
    <label className="rb-num" htmlFor={id}>
      <span>{label}</span>
      <input className="input" id={id} type="number" inputMode="decimal" min={min} max={max} step={step} title={title} value={text} onFocus={() => setTyping(true)} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === 'Enter' && commit()} />
      <span>pt</span>
    </label>
  );
}

interface ContextProps {
  at: SectionState;
  canTable: (name: string) => boolean;
  onSection: (kind: 'up' | 'down' | 'delete' | 'insert-table') => void;
  onTable: (name: string) => void;
  onLook: (key: string, value: string) => number | string | null;
}

export function ContextBar({ at, canTable, onSection, onTable, onLook }: ContextProps) {
  return (
    <div className="rb-toolbar rb-context" id="rb-context" role="toolbar" aria-label="Section and table tools" onMouseDown={(event) => (event.target as Element).closest('button') && event.preventDefault()}>
      <div className="rb-tool-group" role="group" aria-label="Section">
        <span className="rb-tool-label">{`Section: ${at.title || 'untitled'}`}</span>
        <button className="btn btn-secondary btn-sm" type="button" disabled={at.index <= 0} onClick={() => onSection('up')}>Move up</button>
        <button className="btn btn-secondary btn-sm" type="button" disabled={at.index >= at.count - 1} onClick={() => onSection('down')}>Move down</button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => onSection('delete')}>Delete section</button>
        {!at.inTable ? (
          <span><button className="btn btn-secondary btn-sm" type="button" title="Put a table in this section" onClick={() => onSection('insert-table')}>Insert table</button></span>
        ) : null}
      </div>
      {at.inTable && at.table ? (
        <>
          <div className="rb-tool-group" role="group" aria-label="Table">
            {TABLE_BUTTONS.map(([name, label, title]) => (
              <button key={name} className="btn btn-secondary btn-sm" type="button" title={title} disabled={!canTable(name)} onClick={() => onTable(name)}>{label}</button>
            ))}
          </div>
          <div className="rb-tool-group" role="group" aria-label="Table lines and spacing">
            <label className="sr-only" htmlFor="ctx-borders">Which lines</label>
            <select className="select" id="ctx-borders" title="Which lines are drawn" value={at.table.borders} onChange={(event) => onLook('borders', event.target.value)}>
              <option value="all">Lines: full grid</option>
              <option value="light">Lines: light grid</option>
              <option value="rows">Lines: row lines</option>
            </select>
            <label className="sr-only" htmlFor="ctx-style">Line style</label>
            <select className="select" id="ctx-style" title="Line style" value={at.table.borderStyle} onChange={(event) => onLook('borderStyle', event.target.value)}>
              <option value="solid">Solid line</option>
              <option value="dashed">Dashed line</option>
              <option value="dotted">Dotted line</option>
            </select>
            {LOOK_FIELDS.map(([key, label, min, max, step, title]) => (
              <LookNumber key={key} id={`ctx-${key === 'borderWidth' ? 'width' : key === 'cellPadding' ? 'padding' : 'gap'}`} label={label} min={min} max={max} step={step} title={title} value={at.table![key]} onCommit={(value) => onLook(key, value) as number | null} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------- the link bar and the bubble ----------

export function LinkBar({ onSubmit, onCancel, error }: { onSubmit: (url: string) => void; onCancel: () => void; error: string }) {
  const [url, setUrl] = useState('');
  return (
    <form
      className="rb-linkbar"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit(url);
      }}
    >
      <label htmlFor="link-url">Link for the selected text</label>
      <input className="input" id="link-url" placeholder="linkedin.com/in/your-name or you@email.com" autoComplete="off" value={url} onChange={(event) => setUrl(event.target.value)} autoFocus />
      <button className="btn btn-primary btn-sm" type="submit">Add link</button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>Cancel</button>
      <p className="field-error">{error}</p>
    </form>
  );
}

export function Bubble({ tools, position, onCommand, ref }: { tools: ToolState; position: { x: number; y: number } | null; onCommand: ToolbarProps['onCommand']; ref?: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="rb-bubble" ref={ref} role="toolbar" aria-label="Format the selected text" hidden={!position} style={position ? { transform: `translate(${position.x}px, ${position.y}px)` } : undefined} onMouseDown={(event) => event.preventDefault()}>
      <ToolButton command="bold" label="Bold" title="Bold (Ctrl+B)" pressed={tools.bold} onCommand={onCommand}><b>B</b></ToolButton>
      <ToolButton command="italic" label="Italic" title="Italic (Ctrl+I)" pressed={tools.italic} onCommand={onCommand}><i>I</i></ToolButton>
      <ToolButton command="underline" label="Underline" title="Underline (Ctrl+U)" pressed={tools.underline} onCommand={onCommand}><u>U</u></ToolButton>
      <ToolButton command="link" label="Add a link" title="Add a link" onCommand={onCommand}><Icon name="link" /></ToolButton>
    </div>
  );
}
