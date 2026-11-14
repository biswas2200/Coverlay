import { useEffect, useRef } from 'react';
import type { BuilderFormat } from '@/types/builder';
import { HIDEABLE_SECTIONS, MARGIN_LIMITS_MM, MARGIN_PRESETS, fromMm, marginPreset, toMm } from '@legacy/pages/resume-builder-rules.js';

// The two dialogs of the Builder: Page setup (paper, units, the four margins, columns, the page limit, heading lines, which
// sections show) and "How an ATS reads this" (the resume as plain text, in the order a parser meets it).

function useModal(open: boolean, onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);
  return { ref: dialog, onClose };
}

const MARGINS = [['marginTop', 'Top', 'ps-top'], ['marginBottom', 'Bottom', 'ps-bottom'], ['marginLeft', 'Left', 'ps-left'], ['marginRight', 'Right', 'ps-right']] as const;

interface SetupProps {
  open: boolean;
  onClose: () => void;
  format: BuilderFormat;
  pages: number;
  onFormat: (key: string, value: string | number | boolean | string[]) => void;
  onLimit: (pages: number) => void;
  onPreset: (name: string) => void;
  onMargin: (key: string, mm: number) => void;
}

export function PageSetupDialog({ open, onClose, format: f, pages, onFormat, onLimit, onPreset, onMargin }: SetupProps) {
  const modal = useModal(open, onClose);
  const step = f.unit === 'in' ? 0.05 : 0.1;
  const digits = f.unit === 'in' ? 2 : 1;
  const unitName = f.unit === 'in' ? 'inches' : 'centimetres';
  return (
    <dialog className="rb-dialog" ref={modal.ref} aria-labelledby="page-setup-title" onClose={onClose}>
      <form method="dialog" className="rb-dialog-form">
        <h2 id="page-setup-title">Page setup</h2>
        <p className="muted">Changes apply as you make them. The rulers above and beside the page do the same job: drag a margin marker.</p>
        <fieldset>
          <legend>Paper</legend>
          <label htmlFor="ps-page">Paper size</label>
          <select className="select" id="ps-page" value={f.page} onChange={(event) => onFormat('page', event.target.value)}>
            <option value="a4">A4 (21 × 29.7 cm)</option>
            <option value="letter">Letter (8.5 × 11 in)</option>
          </select>
          <label htmlFor="ps-unit">Units</label>
          <select className="select" id="ps-unit" value={f.unit} onChange={(event) => onFormat('unit', event.target.value)}>
            <option value="cm">Centimetres</option>
            <option value="in">Inches</option>
          </select>
        </fieldset>
        <fieldset>
          <legend>Margins</legend>
          <label htmlFor="ps-preset">Preset</label>
          <select className="select" id="ps-preset" value={marginPreset(f)} onChange={(event) => MARGIN_PRESETS[event.target.value as keyof typeof MARGIN_PRESETS] && onPreset(event.target.value)}>
            <option value="narrow">Narrow (0.5 in all round)</option>
            <option value="moderate">Moderate (narrow top and bottom)</option>
            <option value="normal">Normal (0.75 in all round)</option>
            <option value="wide">Wide (1 in all round)</option>
            <option value="custom" disabled>Custom</option>
          </select>
          <div className="rb-margin-grid">
            {MARGINS.map(([key, label, id]) => (
              <MarginInput key={key} id={id} label={label} unitName={unitName} step={step} min={fromMm(MARGIN_LIMITS_MM.min, f.unit).toFixed(2)} max={fromMm(MARGIN_LIMITS_MM.max, f.unit).toFixed(2)} value={String(Number(fromMm(f[key], f.unit).toFixed(digits)))} onCommit={(value) => onMargin(key, toMm(value, f.unit))} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Layout</legend>
          <label htmlFor="ps-columns">Columns</label>
          <select className="select" id="ps-columns" value={String(f.columns)} onChange={(event) => onFormat('columns', Number(event.target.value))}>
            <option value="1">One column (safest for ATS)</option>
            <option value="2">Two columns</option>
          </select>
          <label htmlFor="ps-limit">Page limit</label>
          <select className="select" id="ps-limit" value={String(pages)} onChange={(event) => onLimit(Number(event.target.value))}>
            <option value="1">1 page</option>
            <option value="2">2 pages</option>
          </select>
          <label className="rb-check"><input type="checkbox" checked={f.rules} onChange={(event) => onFormat('rules', event.target.checked)} /> Draw a line under section headings</label>
        </fieldset>
        <fieldset>
          <legend>Sections shown</legend>
          {([['summary', 'Summary'], ['education', 'Education'], ['skills', 'Skills (hide it when your skills are in a table)']] as const).map(([name, label]) => (
            <label className="rb-check" key={name}>
              <input
                type="checkbox"
                checked={!f.hidden.includes(name)}
                onChange={(event) => {
                  const shown = new Set(HIDEABLE_SECTIONS.filter((section: string) => !f.hidden.includes(section)));
                  if (event.target.checked) {
                    shown.add(name);
                  } else {
                    shown.delete(name);
                  }
                  onFormat('hidden', HIDEABLE_SECTIONS.filter((section: string) => !shown.has(section)));
                }}
              />{' '}
              {label}
            </label>
          ))}
          <p className="field-hint" style={{ gridColumn: '1 / -1' }}>Hidden sections keep their text. Show them again to edit them.</p>
        </fieldset>
        <div className="rb-dialog-actions"><button className="btn btn-primary" value="done">Done</button></div>
      </form>
    </dialog>
  );
}

/** A margin box applies when it is left or Enter is pressed, so typing 2.5 does not pass through 2 and 25 mm margins. */
function MarginInput({ id, label, unitName, step, min, max, value, onCommit }: { id: string; label: string; unitName: string; step: number; min: string; max: string; value: string; onCommit: (value: number) => void }) {
  const text = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (text.current && document.activeElement !== text.current) {
      text.current.value = value;
    }
  }, [value]);
  const commit = () => text.current && text.current.value !== '' && onCommit(Number(text.current.value));
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input ref={text} className="input" id={id} type="number" step={step} min={min} max={max} defaultValue={value} aria-label={`${label} margin in ${unitName}`} onBlur={commit} onChange={(event) => event.target.value !== '' && event.nativeEvent instanceof Event && (event.nativeEvent as InputEvent).inputType === undefined && commit()} onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), commit())} />
    </>
  );
}

export function ReadingOrderDialog({ open, onClose, text, notes }: { open: boolean; onClose: () => void; text: string; notes: string[] }) {
  const modal = useModal(open, onClose);
  return (
    <dialog className="rb-dialog" ref={modal.ref} aria-labelledby="reading-order-title" onClose={onClose}>
      <form method="dialog" className="rb-dialog-form">
        <h2 id="reading-order-title">How an ATS reads this</h2>
        <p className="muted">Your resume as plain text, in the order a parser meets it: the usual test of pasting it into a text editor.</p>
        <ul className="rb-reading-notes">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        <pre className="rb-reading-text" tabIndex={0}>{text}</pre>
        <div className="rb-dialog-actions"><button className="btn btn-primary" value="done">Done</button></div>
      </form>
    </dialog>
  );
}
