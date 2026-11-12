import type { CSSProperties } from 'react';
import type { BuilderFormat, BuilderState } from '@/types/builder';
import { DEFAULT_ANSWERS, DEFAULT_FORMAT, isSavedState, normalizeFormat, templateById } from '@legacy/pages/resume-builder-rules.js';

// What the Resume Builder keeps and how a paper is dressed (docs/prototype-spec.md, RB-VER, RB-FMT, RB-PAGE).

export const MAX_MESSAGES = 60;
export const PANEL_SIZE_KEY = 'coverlay.layPanelSize';
export const ZOOM_KEY = 'coverlay.resumeZoom';
export const ZOOMS = ['fit', '0.75', '1', '1.25', '1.5'] as const;
export type Zoom = (typeof ZOOMS)[number];
/** "Fit width" never draws the page bigger than 150%. */
export const MAX_FIT = 1.5;

export function freshState(): BuilderState {
  return { step: 'start', answers: { ...DEFAULT_ANSWERS }, fromUpload: false, templateId: null, history: null, messages: [], format: { ...DEFAULT_FORMAT, hidden: [] } };
}

/** What this browser saved, if it is a builder state the page can show; else a fresh start. */
export function loadBuilder(stored: unknown): BuilderState {
  if (!isSavedState(stored)) {
    return freshState();
  }
  const saved = stored as BuilderState;
  return { ...saved, format: normalizeFormat(saved.format) as BuilderFormat };
}

/** The classes that give the paper its template, font, spacing, header, page size, margins and columns. */
export function paperClasses(templateId: string | null, format: BuilderFormat, editable: boolean): string {
  const f = normalizeFormat(format) as BuilderFormat;
  return [
    'rb-paper',
    `rb-tpl-${templateById(templateId).id}`,
    `rb-font-${f.font}`,
    `rb-space-${f.spacing}`,
    `rb-align-${f.align}`,
    `rb-page-${f.page}`,
    `rb-cols-${f.columns}`,
    f.rules ? 'rb-rules' : '',
    ...f.hidden.map((name: string) => `rb-hide-${name}`),
    editable ? 'is-editable' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The text size in points and the four margins, as the custom properties the stylesheet reads. */
export function paperVars(format: BuilderFormat): CSSProperties {
  const f = normalizeFormat(format) as BuilderFormat;
  return {
    '--rb-fs': String(f.fontSize),
    '--mt': `${f.marginTop}mm`,
    '--mb': `${f.marginBottom}mm`,
    '--ml': `${f.marginLeft}mm`,
    '--mr': `${f.marginRight}mm`,
  } as CSSProperties;
}

/** `--tw: 1pt; border-spacing: 0pt` as a style object (the table attributes make this text from numbers and fixed words only). */
export function cssTextToStyle(text: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const part of text.split(';')) {
    const at = part.indexOf(':');
    if (at > 0) {
      const name = part.slice(0, at).trim();
      const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      style[key] = part.slice(at + 1).trim();
    }
  }
  return style as CSSProperties;
}
