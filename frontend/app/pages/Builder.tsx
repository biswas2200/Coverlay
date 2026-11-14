import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { LayMark } from '@/components/LayMark';
import { PageHeader, PreviewBadge } from '@/components/PageHeader';
import { VersionMenu } from '@/components/VersionMenu';
import { Bubble, ContextBar, LinkBar, NO_TOOLS, Toolbar, type SectionState, type ToolState } from '@/builder/Toolbar';
import { PageSetupDialog, ReadingOrderDialog } from '@/builder/Dialogs';
import { LayPanel } from '@/builder/LayPanel';
import { MAX_FIT, MAX_MESSAGES, ZOOMS, ZOOM_KEY, loadBuilder, paperClasses, paperVars, type Zoom } from '@/builder/model';
import { Paper } from '@/builder/Paper';
import { StartStep, TemplatesStep } from '@/builder/Steps';
import { useResumeEditor } from '@/builder/useResumeEditor';
import { agentStep, agentTurn, builderHandoff, fillFor, gmailConnected, leaveHandoff, rememberJd, rememberedJd } from '@/lay/rules';
import { shortened } from '@/lay/text';
import { builderKey } from '@/lib/builderStore';
import { usePageTitle } from '@/lib/hooks';
import { toRoute } from '@/lib/routes';
import { useUser } from '@/lib/session';
import { readJson, writeJson } from '@/lib/storage';
import type { BuilderAnswers, BuilderFormat, BuilderMessage, BuilderState, BuilderStep, SuggestionItem } from '@/types/builder';
import type { Resume } from '@/types/resume';
import { useNavigate } from 'react-router';
import { downloadBytes } from '@legacy/core/download.js';
import { DOCX_MIME } from '@legacy/pages/docx-writer.js';
import { guardText, knownValues } from '@legacy/pages/privacy-guard-rules.js';
import { buildResumeDocx, resumeDocxName } from '@legacy/pages/resume-docx.js';
import { docToPlainText, readingNotes, resumeToDoc } from '@legacy/pages/resume-doc.js';
import { createRuler, RULER_THICKNESS } from '@legacy/pages/resume-ruler.js';
import {
  MARGIN_KEYS,
  MARGIN_PRESETS,
  PAGE_SIZES,
  WRITING_STYLE_LABELS,
  addVersion,
  applySuggestion,
  clampMargin,
  createHistory,
  currentResume,
  diffResume,
  findVersion,
  fitRequest,
  fitToPages,
  joinList,
  mmToPx,
  normalizeFormat,
  normalizeText,
  pageUsage,
  resumeStats,
  restoreVersion,
  safeHref,
  sampleLayReply,
  sampleResume,
  sectionLabel,
  templateById,
  watchHint,
} from '@legacy/pages/resume-builder-rules.js';

// The Resume Builder preview: a clickable prototype with sample data. Steps: start questions -> templates -> editor ->
// finished. In the editor the resume sits on the left and is edited by typing (every committed change becomes a version),
// with a toolbar for fonts, sizes, bold, italic, underline, links, bullets and the writing style Lay AI uses. The floating
// Lay AI button opens a right-side panel with Chat and Versions. The Lay AI cursor follows the person's typing ("watching",
// with a short tip) and moves to what Lay AI changes ("editing"). Asked to fit a role, Lay AI suggests changes the person
// adds one by one: it never rewrites the whole resume. What the person types in the chat goes through the personal-data
// guard: the stored text has placeholders, the person's screen shows the real values. Nothing calls the backend or an AI:
// the replies come from sampleLayReply() and Lay AI's own rules, and the state lives in this browser only.
//
// The page keeps its state in `model` (a ref that is always current) and mirrors it into React state to draw it, so an
// event handler that changes something and reads it a line later sees the change, as the older page did.

const TYPING_DELAY_MS = 650;
const HINT_DELAY_MS = 900;
const EDITING_MS = 2800; // how long the Lay AI cursor stays on what it changed
const OPENING_MS = 900;

type Change = ReturnType<typeof diffResume>;
type Pointer = { visible: boolean; editing: boolean; label: string; hint: string; x: number; y: number };
const HIDDEN_POINTER: Pointer = { visible: false, editing: false, label: 'Lay AI', hint: '', x: 0, y: 0 };

let counter = 0;
const messageId = () => `${Date.now().toString(36)}-${(counter += 1)}`;

/** The paper size the browser prints at, when the resume is saved as a PDF. */
function setPrintPage(page: string) {
  let style = document.getElementById('rb-page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'rb-page-style';
    document.head.append(style);
  }
  style.textContent = `@page { size: ${page === 'letter' ? 'letter' : 'A4'}; margin: 0; }`;
}

/** The height the resume's content takes on the page: its text, plus the margins and the border. */
function pageContentHeight(paper: HTMLElement): number {
  const inner = paper.firstElementChild as HTMLElement | null;
  if (!inner) {
    return 0;
  }
  const style = getComputedStyle(paper);
  return inner.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2;
}

/** Puts the format on a paper element directly (to measure a format the page does not show yet). */
function dressPaper(paper: HTMLElement, templateId: string | null, format: BuilderFormat) {
  paper.className = `${paperClasses(templateId, format, true)} rb-editor`;
  for (const [name, value] of Object.entries(paperVars(format))) {
    paper.style.setProperty(name, String(value));
  }
}

export default function Builder() {
  usePageTitle('Builder');
  const user = useUser();
  const navigate = useNavigate();
  const key = builderKey(user?.id);

  // ---------- state ----------
  const [state, setState] = useState<BuilderState>(() => loadBuilder(readJson(key)));
  const model = useRef(state);
  /** Replaces the state: at once for the code that follows, on screen for React, and in this browser's storage. */
  const update = useCallback(
    (next: BuilderState, { save = true } = {}) => {
      const trimmed = next.messages.length > MAX_MESSAGES ? { ...next, messages: next.messages.slice(-MAX_MESSAGES) } : next;
      model.current = trimmed;
      setState(trimmed);
      if (save) {
        writeJson(key, trimmed);
      }
    },
    [key],
  );

  const [viewing, setViewingState] = useState<number | null>(null);
  const viewingRef = useRef<number | null>(null);
  const setViewing = useCallback((value: number | null) => {
    viewingRef.current = value;
    setViewingState(value);
  }, []);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<'chat' | 'versions'>('chat');
  const [highlight, setHighlight] = useState<Change | null>(null);
  const [replying, setReplyingState] = useState(false);
  const replyingRef = useRef(false);
  const setReplying = (value: boolean) => {
    replyingRef.current = value;
    setReplyingState(value);
  };
  const [zoom, setZoom] = useState<Zoom>(() => {
    const saved = readJson(ZOOM_KEY) as Zoom;
    return ZOOMS.includes(saved) ? saved : 'fit';
  });
  const [status, setStatus] = useState('');
  const [fitNote, setFitNote] = useState('');
  const [tools, setTools] = useState<ToolState>(NO_TOOLS);
  const [counts, setCounts] = useState({ words: 0, characters: 0, saved: '' });
  const [pageFigure, setPageFigure] = useState<{ text: string; over: boolean; multi: boolean }>({ text: '', over: false, multi: false });
  const [context, setContext] = useState<SectionState | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const [pointer, setPointer] = useState<Pointer>(HIDDEN_POINTER);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [colorsOpen, setColorsOpen] = useState(false);
  const [colorNote, setColorNote] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [reading, setReading] = useState<{ open: boolean; text: string; notes: string[] }>({ open: false, text: '', notes: [] });
  const [docxNote, setDocxNote] = useState(false);
  const [holding, setHolding] = useState(false);

  const announce = (message: string) => setStatus(message);

  // ---------- elements and what the editor was last shown ----------
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const editorHost = useRef<HTMLElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const finalWrap = useRef<HTMLDivElement>(null);
  const finalPaper = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rulers = useRef<{ x: ReturnType<typeof createRuler>; y: ReturnType<typeof createRuler> } | null>(null);
  const shownResume = useRef<Resume | null>(null);
  const shownBullets = useRef(false);
  const shownColumns = useRef(1);
  const activePath = useRef<string | null>(null);
  const pointerDown = useRef(false);
  const dropPending = useRef(false);
  const editingPath = useRef<string | null>(null);
  const pointerFrame = useRef(0);
  const hintTimer = useRef(0);
  const editingTimer = useRef(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const step: BuilderStep = state.step;
  const inEditor = step === 'editor' && Boolean(state.history);
  const resumeNow = (state.history ? currentResume(state.history) : sampleResume()) as Resume;
  const shownVersion = viewing !== null && state.history ? findVersion(state.history, viewing) : null;
  const editable = shownVersion === null;

  // ---------- the editor ----------

  const handlers = {
    onTyping: () => onTyping(),
    onSelection: () => onCaretMoved(),
    onFocus: () => schedulePointer(),
    onBlur: (to: Element | null) => onEditorBlur(to),
  };
  const { editor, editorRef } = useResumeEditor(editorHost, inEditor, handlers);

  /** Turns what was typed into a version, if anything changed: one version per field. The editor already shows the new text. */
  const commitEditor = useCallback(() => {
    const live = editorRef.current;
    const s = model.current;
    if (!live?.isDirty() || viewingRef.current !== null || !s.history || shownResume.current === null) {
      return false;
    }
    const before = currentResume(s.history) as Resume;
    const after = live.getResume(before) as Resume;
    live.markClean();
    const change = diffResume(before, after);
    const same = !change.fields.length && !change.addedSkills.length && !change.removedSkills.length && !change.extraChanged
      && after.skills.length === before.skills.length && after.skills.every((skill, i) => skill === before.skills[i]);
    if (same) {
      return false;
    }
    const where = change.fields[0] ?? (change.extraChanged && !change.addedSkills.length && !change.removedSkills.length ? 'custom' : 'skills');
    update({ ...s, history: addVersion(s.history, after, { source: 'you', summary: `You edited ${sectionLabel(where)}`, at: Date.now() }) });
    setHighlight(null);
    live.setHighlight(null);
    shownResume.current = after;
    updateStatus();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, editorRef]);

  /** Word and character counts, and whether the last edit has been kept as a version. */
  function updateStatus() {
    const live = editorRef.current;
    const s = model.current;
    if (!live || !s.history || viewingRef.current !== null) {
      return;
    }
    const before = currentResume(s.history) as Resume;
    const { words, characters } = resumeStats(live.isDirty() ? live.getResume(before) : before);
    setCounts({ words, characters, saved: live.isDirty() ? 'Editing: kept as a version when you leave the field' : `All changes kept · v${s.history.current}` });
  }

  function updateToolState() {
    const live = editorRef.current;
    if (!live) {
      return;
    }
    const rich = Boolean(live.currentField()?.rich);
    const color = rich ? live.currentColor() : null;
    const next: ToolState = {
      undo: live.canUndo(),
      redo: live.canRedo(),
      bold: rich && live.isActive('bold'),
      italic: rich && live.isActive('italic'),
      underline: rich && live.isActive('underline'),
      picked: color || '#000000',
      color,
    };
    setTools((current) => (Object.keys(next).every((k) => current[k as keyof ToolState] === next[k as keyof ToolState]) ? current : next));
  }

  /** The small floating toolbar above selected text in a field that takes formatting. */
  function updateBubble() {
    const live = editorRef.current;
    const rect = viewingRef.current === null && live?.hasFocus() && live.currentField()?.rich ? live.selectionRect() : null;
    const stage = stageRef.current?.getBoundingClientRect();
    if (!rect || !stage) {
      setBubble(null);
      return;
    }
    const width = bubbleRef.current?.offsetWidth ?? 130;
    const height = bubbleRef.current?.offsetHeight ?? 36;
    const x = Math.min(Math.max(rect.left - stage.left, 0), stage.width - width);
    const y = rect.top - stage.top - height - 8;
    setBubble({ x: Math.round(x), y: Math.round(Math.max(y, 0)) });
  }

  /** Shows the section and table tools when the caret is in a custom section. */
  function updateContext() {
    const at = viewingRef.current === null ? (editorRef.current?.sectionState() as SectionState | null | undefined) : null;
    setContext(at ?? null);
  }

  /**
   * Removing an emptied skill makes the page shorter. With the mouse still down that would move the text under the
   * pointer mid-click and turn the click into a drag, so it waits for the button to come up.
   */
  function dropEmptySkillsSoon() {
    if (pointerDown.current) {
      dropPending.current = true;
    } else {
      editorRef.current?.dropEmptySkills();
    }
  }

  /** The caret moved: leaving a field with an edit in it commits that edit. */
  function onCaretMoved() {
    const live = editorRef.current;
    if (!live) {
      return;
    }
    const path = live.currentField()?.path ?? null;
    if (path !== activePath.current) {
      commitEditor();
      dropEmptySkillsSoon();
      activePath.current = path;
    }
    schedulePointer();
    updateToolState();
    updateBubble();
    updateStatus();
    updateContext();
  }

  function onEditorBlur(to: Element | null) {
    // Focus moving to the toolbar or the link bar is still editing.
    if (to?.closest?.('#rb-toolbar, #rb-linkbar, #rb-context')) {
      return;
    }
    commitEditor();
    dropEmptySkillsSoon();
    activePath.current = null;
    hidePointer();
    updateBubble();
    updateStatus();
    setContext(null);
  }

  // ---------- the Lay AI cursor (animation only, no AI call) ----------

  function setHint(text: string | null) {
    setPointer((current) => ({ ...current, hint: text ?? '' }));
  }

  function onTyping() {
    setFitNote('');
    schedulePointer();
    updateToolState();
    updateBubble();
    updateStatus();
    window.clearTimeout(hintTimer.current);
    setHint(null);
    // After a short pause, Lay AI "notices" what you typed and offers one tip.
    hintTimer.current = window.setTimeout(() => {
      const live = editorRef.current;
      const field = live?.currentField();
      if (live && field && live.hasFocus() && model.current.history) {
        setHint(watchHint(field.path, live.currentValue(currentResume(model.current.history))));
      }
    }, HINT_DELAY_MS);
  }

  function flashHint(text: string) {
    const rect = editorRef.current?.fieldRect('summary');
    if (!rect) {
      return;
    }
    editingPath.current = 'summary';
    setPointer((current) => ({ ...current, label: 'Lay AI', hint: text }));
    placePointer(rect, true);
    window.clearTimeout(editingTimer.current);
    editingTimer.current = window.setTimeout(() => {
      editingPath.current = null;
      setHint(null);
      hidePointer();
    }, 3200);
  }

  function schedulePointer() {
    cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = requestAnimationFrame(movePointer);
  }

  function movePointer() {
    const live = editorRef.current;
    if (!live) {
      return;
    }
    if (editingPath.current) {
      const rect = live.fieldRect(editingPath.current);
      if (rect && (rect.width > 0 || rect.height > 0)) { // a hidden section has no size: nothing to point at
        placePointer(rect, true);
        return;
      }
    }
    const field = live.currentField();
    if (!field || !live.hasFocus()) {
      hidePointer();
      return;
    }
    const caret = live.caretRect();
    setPointer((current) => ({ ...current, label: 'Lay AI · watching', editing: false }));
    placePointer(caret ?? live.fieldRect(field.path), !caret);
  }

  /** Beside the caret on the same line (never over the next line of text), or at a field's end. */
  function placePointer(rect: { left: number; right: number; top: number } | null, atFieldEnd: boolean) {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!rect || !stage) {
      return;
    }
    const anchorX = atFieldEnd ? Math.min(rect.right, rect.left + 260) : rect.right;
    // Room for the tip bubble (max 230px) to the right, inside the stage.
    const x = Math.min(anchorX - stage.left + 8, stage.width - 250);
    const y = rect.top - stage.top - 2;
    setPointer((current) => ({ ...current, visible: true, x: Math.round(Math.max(x, 0)), y: Math.round(y) }));
  }

  function hidePointer() {
    if (editingPath.current) {
      return;
    }
    window.clearTimeout(hintTimer.current);
    setPointer((current) => ({ ...current, visible: false, editing: false, hint: '' }));
  }

  /**
   * Brings what Lay AI just changed into view: if its field is off screen (or hugging an edge), the page scrolls to put it
   * in the middle, so the person sees the edit and the cursor on it instead of changes happening below the fold.
   */
  function scrollToEdit(path: string) {
    const rect = editorRef.current?.fieldRect(path);
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return; // a hidden section has nothing to show
    }
    const edge = 110;
    if (rect.top >= edge && rect.bottom <= window.innerHeight - edge) {
      return; // already well inside the window
    }
    const top = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: calm ? 'auto' : 'smooth' });
  }

  function skillPath(change: Change) {
    const skills = (currentResume(model.current.history!) as Resume).skills;
    const added = change.addedSkills.at(-1);
    const index = added ? skills.findIndex((s) => s.toLowerCase() === added.toLowerCase()) : skills.length - 1;
    return `skills.${Math.max(index, 0)}`;
  }

  /** After Lay AI changes the resume, its cursor goes to the change, as if it typed it. */
  function pointToChange(change: Change) {
    const path = change.fields[0] ?? (change.addedSkills.length || change.removedSkills.length ? skillPath(change) : null);
    if (!path) {
      return;
    }
    editingPath.current = path;
    // The editor shows the new resume in the next effect: scroll and point once it does.
    requestAnimationFrame(() => {
      scrollToEdit(path);
      setPointer((current) => ({ ...current, hint: '', label: 'Lay AI is editing…', editing: true }));
      schedulePointer();
      window.clearTimeout(editingTimer.current);
      editingTimer.current = window.setTimeout(() => {
        editingPath.current = null;
        setPointer((current) => ({ ...current, editing: false }));
        hidePointer();
      }, EDITING_MS);
    });
  }

  // ---------- the editor shows the resume ----------

  // Redraw the document only when the resume, the bullets or the columns are not what it shows.
  useEffect(() => {
    if (!editor || !editable || !inEditor) {
      return;
    }
    if (shownResume.current !== resumeNow || shownBullets.current !== state.format.bullets || shownColumns.current !== state.format.columns) {
      editor.setResume(resumeNow, { bullets: state.format.bullets, columns: state.format.columns });
      shownResume.current = resumeNow;
      shownBullets.current = state.format.bullets;
      shownColumns.current = state.format.columns;
    }
    editor.setHighlight(highlight);
    updateStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editable, inEditor, resumeNow, state.format.bullets, state.format.columns, highlight]);

  // A new editor starts from nothing: forget what the last one showed.
  useEffect(() => {
    if (!editor) {
      shownResume.current = null;
    }
  }, [editor]);

  // ---------- the page: size, scaling, how full it is, and fitting ----------

  const layoutPages = useCallback(() => {
    const pairs: [HTMLElement | null, HTMLElement | null][] = [
      [wrapRef.current, editorHost.current],
      [wrapRef.current, paperRef.current],
      [finalWrap.current, finalPaper.current],
    ];
    for (const [wrap, paper] of pairs) {
      if (!wrap || !paper || paper.hidden || !wrap.offsetParent) {
        continue;
      }
      // The rulers hug the editable page only: a strip along its top and one down its left side.
      const rulersOn = paper === editorHost.current && Boolean(rulers.current);
      const gutter = rulersOn ? RULER_THICKNESS + 3 : 0;
      const available = wrap.clientWidth - gutter - 10; // a little room for the page's shadow
      const width = paper.offsetWidth;
      if (available <= 0 || !width) {
        continue;
      }
      // Fit width fills the space (up to 150%); a fixed zoom applies to the page being edited and scrolls sideways if it is wider.
      const fixed = wrap === wrapRef.current && zoomRef.current !== 'fit' ? Number(zoomRef.current) : null;
      const scale = fixed ?? Math.min(MAX_FIT, available / width);
      const left = gutter + Math.max(0, (available - width * scale) / 2);
      paper.style.transform = Math.abs(scale - 1) > 0.001 ? `scale(${scale})` : '';
      paper.style.left = `${left}px`;
      paper.style.top = `${gutter}px`;
      wrap.style.height = `${gutter + Math.ceil(paper.offsetHeight * scale) + 14}px`;
      if (wrap === wrapRef.current && rulers.current) {
        for (const ruler of [rulers.current.x, rulers.current.y]) {
          ruler.element.hidden = !rulersOn;
        }
      }
      if (rulersOn && rulers.current) {
        const f = model.current.format;
        const page = PAGE_SIZES[f.page as keyof typeof PAGE_SIZES];
        const pxPerMm = mmToPx(1) * scale;
        rulers.current.x.element.style.left = `${left}px`;
        rulers.current.x.element.style.top = '0px';
        rulers.current.x.update({ lengthMm: page.widthMm, pxPerMm, startMm: f.marginLeft, endMm: f.marginRight, unit: f.unit });
        rulers.current.y.element.style.left = `${Math.max(0, left - gutter)}px`;
        rulers.current.y.element.style.top = `${gutter}px`;
        rulers.current.y.update({ lengthMm: page.heightMm, pxPerMm, startMm: f.marginTop, endMm: f.marginBottom, unit: f.unit });
      }
    }
  }, []);

  /** The status bar's page figure: how much of the page limit the resume uses, and a line where each page ends. */
  const updatePageStatus = useCallback(() => {
    const paper = [editorHost.current, paperRef.current].find((candidate) => candidate && !candidate.hidden && candidate.offsetParent);
    if (!paper) {
      return;
    }
    const s = model.current;
    const limit = s.answers.pages === 2 ? 2 : 1;
    const usage = pageUsage(pageContentHeight(paper), s.format.page, limit);
    const pages = limit === 1 ? 'page' : 'pages';
    paper.classList.toggle('is-multipage', usage.used > 1.003);
    const next = {
      text: usage.fits ? `Fits ${limit} ${pages} · ${Math.round((usage.used / limit) * 100)}% full` : `Over the ${limit}-page limit by ${Math.max(1, Math.round(usage.over * 100))}%`,
      over: !usage.fits,
      multi: usage.used > 1.003,
    };
    // This runs after every render: an answer that did not change must not draw again.
    setPageFigure((current) => (current.text === next.text && current.over === next.over && current.multi === next.multi ? current : next));
  }, []);

  // The page is redrawn to size after every change that could move it, and when the window, the panel or the text resizes.
  useLayoutEffect(() => {
    layoutPages();
    updatePageStatus();
  });
  useEffect(() => {
    const refresh = () => {
      layoutPages();
      updatePageStatus();
    };
    const observer = new ResizeObserver(refresh);
    for (const element of [stageRef.current, editorHost.current, paperRef.current, finalWrap.current]) {
      if (element) {
        observer.observe(element);
      }
    }
    window.addEventListener('resize', refresh, { passive: true });
    document.fonts?.ready.then(refresh);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refresh);
    };
  }, [step, viewing, layoutPages, updatePageStatus]);

  /** The rulers along the top and left of the editable page, with a handle on each margin to drag. */
  useEffect(() => {
    if (!inEditor || !wrapRef.current) {
      return undefined;
    }
    const made = {
      x: createRuler('x', { start: 'marginLeft', end: 'marginRight' }, setMargin),
      y: createRuler('y', { start: 'marginTop', end: 'marginBottom' }, setMargin),
    };
    rulers.current = made;
    wrapRef.current.append(made.x.element, made.y.element);
    return () => {
      made.x.element.remove();
      made.y.element.remove();
      rulers.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inEditor]);

  /**
   * Sets one margin (in millimetres) from a ruler handle, the Page setup dialog, or a key press. The text always keeps at
   * least 60 mm of width and 80 mm of height. While a handle is still being dragged (`commit` false) nothing is saved yet.
   */
  function setMargin(marginKey: string, mm: number, { commit = true } = {}) {
    const s = model.current;
    const f = s.format;
    const page = PAGE_SIZES[f.page as keyof typeof PAGE_SIZES];
    const pair = ({ marginTop: 'marginBottom', marginBottom: 'marginTop', marginLeft: 'marginRight', marginRight: 'marginLeft' } as Record<string, string>)[marginKey];
    const horizontal = marginKey === 'marginLeft' || marginKey === 'marginRight';
    const room = (horizontal ? page.widthMm - 60 : page.heightMm - 80) - (f as unknown as Record<string, number>)[pair];
    update({ ...s, format: normalizeFormat({ ...f, [marginKey]: Math.min(clampMargin(mm), room) }) as BuilderFormat }, { save: commit });
  }

  /** Content height of the editor if the resume were set with `format`: used to try fits without redrawing. */
  function measureFormat(format: BuilderFormat) {
    const host = editorHost.current;
    if (!host) {
      return 0;
    }
    dressPaper(host, model.current.templateId, format);
    return pageContentHeight(host);
  }

  /**
   * Fits the resume to `pages` pages (the page limit when null) by changing only how it is set. See fitToPages(): bounded,
   * never deletes text, never goes below the smallest readable size.
   */
  function fitResume(pages: number | null) {
    commitEditor();
    setViewing(null);
    const s = model.current;
    const limit = pages ?? (s.answers.pages === 2 ? 2 : 1);
    const result = fitToPages(s.format, limit, measureFormat);
    update({ ...s, answers: { ...s.answers, pages: limit }, format: result.format as BuilderFormat });
    // Trying a format dressed the page directly: put the page back to the format that was kept.
    if (editorHost.current) {
      dressPaper(editorHost.current, s.templateId, result.format as BuilderFormat);
    }
    return { ...result, limit };
  }

  /** What happened, in words: it fit, it already fit, or it still does not and what to do. */
  function fitSentence(result: ReturnType<typeof fitResume>) {
    const pages = `${result.limit} ${result.limit === 1 ? 'page' : 'pages'}`;
    if (result.fits && !result.changes.length) {
      return `It already fits on ${pages}: ${Math.round((result.used / result.limit) * 100)}% of the space is used. I changed nothing.`;
    }
    if (result.fits) {
      return `Done: it fits on ${pages} now. I ${joinList(result.changes)}. Every word is still there.`;
    }
    const way = result.limit === 1 ? 'or allow 2 pages' : 'or trim your oldest role';
    const format = result.format as unknown as Record<string, number>;
    return `It is still ${Math.max(1, Math.round(result.over * 100))}% too long for ${pages}, even at the smallest setting I use `
      + `(${result.format.fontSize} pt, ${Number(Math.max(...MARGIN_KEYS.map((marginKey: string) => format[marginKey])).toFixed(1))} mm margins, tight spacing). I have not deleted anything. `
      + `To make room, try "Shorten my summary", ${way}.`;
  }

  // ---------- steps and formats ----------

  function goTo(next: BuilderStep) {
    setViewing(null);
    update({ ...model.current, step: next });
    window.scrollTo({ top: 0 });
  }

  function submitAnswers(answers: BuilderAnswers, fromUpload: boolean) {
    update({ ...model.current, answers, fromUpload, step: 'templates' });
    window.scrollTo({ top: 0 });
  }

  function chooseTemplate(id: string) {
    const template = templateById(id) as { id: string; name: string; font?: string; columns?: number; fontSize: number; margin: number };
    const s = model.current;
    const at = Date.now();
    let history = s.history;
    if (!history) {
      const summary = s.fromUpload ? `Imported from upload, template ${template.name}` : `Started from template ${template.name}`;
      history = createHistory(sampleResume(), { source: s.fromUpload ? 'import' : 'template', summary, at });
    } else if (s.templateId !== template.id) {
      history = addVersion(history, currentResume(history), { source: 'template', summary: `Switched to template ${template.name}`, at });
    }
    let format = s.format;
    if (s.templateId !== template.id) {
      // A template brings its typeface (Classic is the LaTeX look), its columns, its text size and its margins.
      const font = template.id === 'classic' ? 'classic' : template.font ?? (format.font === 'classic' ? 'sans' : format.font);
      format = normalizeFormat({ ...format, font, columns: template.columns ?? 1 }) as BuilderFormat;
      format = normalizeFormat({ ...format, fontSize: template.fontSize, ...Object.fromEntries(MARGIN_KEYS.map((marginKey: string) => [marginKey, template.margin])) }) as BuilderFormat;
    }
    update({ ...s, history, format, templateId: template.id, step: 'editor' });
    setViewing(null);
    window.scrollTo({ top: 0 });
    announce(`Template ${template.name} chosen.`);
  }

  function setFormat(formatKey: string, value: string | number | boolean | string[]) {
    commitEditor();
    const s = model.current;
    update({ ...s, format: normalizeFormat({ ...s.format, [formatKey]: value }) as BuilderFormat });
    if (formatKey === 'style') {
      announce(`Lay AI now writes in a ${WRITING_STYLE_LABELS[(value as keyof typeof WRITING_STYLE_LABELS)].toLowerCase()} style.`);
    }
  }

  function setLimit(pages: number) {
    const s = model.current;
    update({ ...s, answers: { ...s.answers, pages: pages === 2 ? 2 : 1 } });
  }

  function startOver() {
    update({ ...loadBuilder(null) });
    setPanelOpen(false);
    setHighlight(null);
    setViewing(null);
    window.scrollTo({ top: 0 });
    announce('Started over.');
  }

  // ---------- the toolbar ----------

  function runCommand(command: 'undo' | 'redo' | 'bold' | 'italic' | 'underline' | 'link' | 'color') {
    const live = editorRef.current;
    if (!live) {
      return;
    }
    if (command === 'undo' || command === 'redo') {
      live[command]();
      updateToolState();
      return;
    }
    const field = live.currentField();
    if (!field?.rich) {
      announce('Click into your summary, experience or contact line first, then use the toolbar.');
      flashHint('Click into a field first, then pick bold, italic, underline, a colour or a link.');
      return;
    }
    if (command === 'link') {
      setLinkError('');
      setLinkOpen(true);
      return;
    }
    if (command === 'color') {
      toggleColors();
      return;
    }
    live.toggle(command);
    updateToolState();
  }

  function toggleColors() {
    setColorNote('');
    if (!colorsOpen) {
      updateToolState();
    }
    setColorsOpen((open) => !open);
  }

  /** Colours the selected text; `null` is "Automatic". A colour too pale to read on white paper is refused. */
  function applyColor(hex: string | null) {
    if (!editorRef.current?.setColor(hex)) {
      setColorNote('That colour is too light to read on white paper. Pick a darker one.');
      return;
    }
    setColorsOpen(false);
    updateToolState();
    announce(hex === null ? 'Text colour removed. Click outside the field to keep it.' : 'Text colour changed. Click outside the field to keep it.');
  }

  function addLink(typed: string) {
    const text = typed.trim();
    const href = safeHref(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `mailto:${text}` : text);
    if (!href) {
      setLinkError('Use a web address like linkedin.com/in/your-name, or an email address.');
      return;
    }
    setLinkOpen(false);
    // With nothing selected, the address itself becomes the link text.
    editorRef.current?.setLink(href, text.replace(/^mailto:/, ''));
    announce('Link added. Click outside the field to keep it.');
  }

  function addSection(value: string) {
    const [kind, columns] = value.split('-');
    if (!kind || !editorRef.current) {
      return;
    }
    commitEditor();
    editorRef.current.addSection(kind, Number(columns) || 2);
    commitEditor();
    updateContext();
    updateStatus();
    announce('Section added. Type its name, then fill it in.');
  }

  function onSection(kind: 'up' | 'down' | 'delete' | 'insert-table') {
    const live = editorRef.current;
    if (!live) {
      return;
    }
    const done = { up: () => live.moveSection(-1), down: () => live.moveSection(1), delete: () => live.deleteSection(), 'insert-table': () => live.insertTable(2, 2) }[kind]();
    if (!done && kind !== 'insert-table') {
      return;
    }
    commitEditor();
    updateContext();
    updateStatus();
  }

  function onTable(name: string) {
    editorRef.current?.tableCommand(name);
    commitEditor();
    updateContext();
    updateStatus();
  }

  /** The table's lines and spacing: each control sets one attribute; the editor brings a value into its limits. */
  function onLook(lookKey: string, value: string) {
    const look = editorRef.current?.setTableLook({ [lookKey]: value }) as Record<string, number | string> | null | undefined;
    commitEditor();
    updateContext();
    return look ? (look[lookKey] as number) : null;
  }

  function openReadingOrder() {
    commitEditor();
    const s = model.current;
    const doc = resumeToDoc(currentResume(s.history!), { bullets: s.format.bullets, columns: s.format.columns });
    setReading({ open: true, text: docToPlainText(doc, { hidden: s.format.hidden }), notes: readingNotes(doc) });
  }

  // ---------- the Lay AI panel ----------

  function openPanel() {
    setPanelOpen(true);
    requestAnimationFrame(() => (tab === 'chat' ? inputRef.current : document.getElementById('tab-versions'))?.focus());
  }

  function closePanel() {
    setPanelOpen(false);
  }

  function restoreTo(number: number) {
    const s = model.current;
    if (!s.history) {
      return;
    }
    const next = restoreVersion(s.history, number, Date.now());
    if (next === s.history) {
      return;
    }
    update({ ...s, history: next });
    setHighlight(null);
    setViewing(null);
    announce(`Restored version ${number}.`);
  }

  /** Add or Skip one suggestion: only an Add changes the resume, as its own version. */
  function decide(messageKey: string, itemId: string, action: 'add' | 'skip') {
    const s = model.current;
    const message = s.messages.find((m) => m.id === messageKey);
    const item = message?.items?.find((i) => i.id === itemId);
    if (!s.history || !message || !item || item.status !== 'open') {
      return;
    }
    commitEditor();
    let next = model.current;
    let change: Change | null = null;
    const items = message.items!.map((i): SuggestionItem => (i.id === itemId ? { ...i, status: action === 'add' ? 'added' : 'skipped' } : i));
    if (action === 'add') {
      const before = currentResume(next.history!) as Resume;
      const after = applySuggestion(before, item) as Resume;
      if (after !== before) {
        const summary = item.kind === 'skill' ? `Lay AI: added ${item.skill} (you accepted)` : 'Lay AI: new Summary (you accepted)';
        next = { ...next, history: addVersion(next.history!, after, { source: 'ai', summary, at: Date.now() }) };
        change = diffResume(before, after);
      }
    }
    update({ ...next, messages: next.messages.map((m) => (m.id === messageKey ? { ...m, items } : m)) });
    if (change) {
      setHighlight(change);
      pointToChange(change);
    }
    announce(action === 'add' ? (item.kind === 'skill' ? `Added ${item.skill}.` : 'Summary updated.') : 'Skipped.');
  }

  /** A Lay AI message with buttons: what the rules answered, kept in the chat (placeholders only, no real values). */
  function agentMessage(result: { reply: string; actions?: { id: string; label: string; primary?: boolean }[]; card?: { subject: string; body: string } | null; payload?: unknown }): BuilderMessage {
    return {
      id: messageId(),
      from: 'lay',
      kind: 'agent',
      text: result.reply,
      card: result.card ?? null,
      actions: (result.actions ?? []).map((item) => ({ id: item.id, label: item.label, primary: Boolean(item.primary) })),
      payload: result.payload ?? {},
      chosen: null,
    };
  }

  /**
   * What a step makes real on this page: a new resume becomes one version (green, with the Lay AI cursor on it), a line goes
   * into the chat, and a step that opens another page leaves its request there first.
   */
  function finishStep(step: ReturnType<typeof agentStep>, intro = '', base: BuilderState = model.current) {
    const before = currentResume(base.history!) as Resume;
    let change: Change | null = null;
    let history = base.history!;
    if (step.payload?.jd) {
      rememberJd(step.payload.jd);
    }
    if (step.resume && step.resume !== before) {
      history = addVersion(history, step.resume, { source: 'ai', summary: step.summary ?? 'Lay AI', at: Date.now() });
      change = diffResume(before, step.resume);
    }
    update({ ...base, history, messages: [...base.messages, agentMessage({ reply: `${intro}${step.reply}`, actions: step.actions, card: step.card, payload: step.payload })] });
    if (change) {
      setHighlight(change);
      pointToChange(change);
    }
    if (step.effect?.type === 'navigate') {
      const { href, handoff } = step.effect;
      leaveHandoff(handoff);
      // A moment to read the line first.
      window.setTimeout(() => navigate(toRoute(href)), OPENING_MS);
    }
  }

  function agentContext() {
    const s = model.current;
    const resume = currentResume(s.history!) as Resume;
    return { resume, style: s.format.style, jd: rememberedJd(), gmail: gmailConnected(), onBuilder: true, fill: fillFor(resume) };
  }

  /** One press on a button of a Lay AI message: it can be pressed once, and then the whole message is settled. */
  function runAgent(messageKey: string, actionId: string) {
    const s = model.current;
    const message = s.messages.find((m) => m.id === messageKey);
    if (!s.history || !message || message.kind !== 'agent' || message.chosen || !message.actions?.some((a) => a.id === actionId)) {
      return;
    }
    commitEditor();
    setViewing(null);
    const settled = { ...model.current, messages: model.current.messages.map((m) => (m.id === messageKey ? { ...m, chosen: actionId } : m)) };
    finishStep(agentStep(actionId, message.payload as never, agentContext(), Date.now()), '', settled);
  }

  /**
   * A request Lay AI left on another page ("yes, open the Builder"): the person agreed there, so it is carried out now as one
   * new version, and the chat opens on the answer. Waits for a resume if there is none yet.
   */
  const handoffTaken = useRef(false);
  function applyHandoff() {
    const s = model.current;
    if (!s.history || (s.step !== 'editor' && s.step !== 'finished') || handoffTaken.current) {
      return;
    }
    const handoff = builderHandoff({ take: true });
    if (!handoff) {
      return;
    }
    handoffTaken.current = true;
    // The resume was finished: reopen it, so the change is where the person can see it.
    const base: BuilderState = s.step === 'editor' ? s : { ...s, step: 'editor' };
    setTab('chat');
    setPanelOpen(true);
    finishStep(agentStep('update', { skills: handoff.skills, jd: handoff.jd }, agentContext(), Date.now()), 'Picking up what you agreed to. ', base);
    announce('Lay AI made the change you agreed to.');
  }

  // A request waiting for a resume is said so on the start page; one waiting for the editor is carried out.
  useEffect(() => {
    setHolding(builderHandoff() !== null);
    if (state.history && (state.step === 'editor' || state.step === 'finished')) {
      applyHandoff();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, Boolean(state.history)]);

  function send(text: string) {
    // Line breaks stay for Lay AI (a pasted job description is read line by line); the canned replies below work on the one-line form.
    const raw = String(text ?? '').replace(/\r/g, '').trim();
    const typed = normalizeText(raw);
    const s0 = model.current;
    if (!typed || replyingRef.current || !s0.history) {
      return;
    }
    commitEditor();
    setViewing(null);
    setReplying(true);
    // The guard: what is stored (and what Lay AI would send to Gemini) has placeholders; the vault with the real values is
    // the account's own and only fills this screen.
    const s1 = model.current;
    const guard = guardText(raw, knownValues(currentResume(s1.history!)));
    const oneLine = normalizeText(guard.stored);
    // A long paste is kept only as its first lines: the job description itself is never stored.
    update({ ...s1, messages: [...s1.messages, { id: messageId(), from: 'you', text: shortened(guard.stored), vault: guard.vault, found: guard.found }] });

    window.setTimeout(() => {
      const s = model.current;
      const before = currentResume(s.history!) as Resume;
      // Lay AI's own work (a job description, new skills, a match, an email) proposes first and waits for a yes.
      const turn = fitRequest(oneLine) ? null : agentTurn(guard.stored, { resume: before, style: s.format.style, jd: rememberedJd(), gmail: gmailConnected(), claim: 'builder', onBuilder: true, fill: fillFor(before) });
      if (turn) {
        if (turn.payload?.jd) {
          rememberJd(turn.payload.jd);
        }
        update({ ...s, messages: [...s.messages, agentMessage(turn)] });
        setReplying(false);
        if (tab === 'chat') {
          inputRef.current?.focus({ preventScroll: true });
        }
        return;
      }
      // "Fit it on one page" changes how the resume is set (spacing, margins, text size), never the words.
      const fit = fitRequest(oneLine);
      const result = fit
        ? { reply: fitSentence(fitResume(fit.pages)), resume: before, summary: null, suggestion: undefined }
        : (sampleLayReply(oneLine, before, s.format.style) as { reply: string; resume: Resume; summary: string | null; suggestion?: { role: string; items: SuggestionItem[] } });
      let base = model.current;
      let change: Change | null = null;
      if (result.resume !== before) {
        base = { ...base, history: addVersion(base.history!, result.resume, { source: 'ai', summary: result.summary ?? 'Lay AI', at: Date.now() }) };
        change = diffResume(before, result.resume);
      }
      const reply: BuilderMessage = result.suggestion
        ? { id: messageId(), from: 'lay', kind: 'suggest', text: result.reply, role: result.suggestion.role, items: result.suggestion.items }
        : { id: messageId(), from: 'lay', text: result.reply };
      update({ ...base, messages: [...base.messages, reply] });
      setReplying(false);
      if (change) {
        setHighlight(change);
        pointToChange(change);
      }
      if (tab === 'chat') {
        // preventScroll: the page is scrolling to what Lay AI changed, and focusing the box must not cancel that.
        inputRef.current?.focus({ preventScroll: true });
      }
    }, TYPING_DELAY_MS);
  }

  // ---------- page-level events ----------

  useEffect(() => {
    const down = () => { pointerDown.current = true; };
    const up = () => {
      pointerDown.current = false;
      if (dropPending.current) {
        dropPending.current = false;
        editorRef.current?.dropEmptySkills();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
    };
  }, [editorRef]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && linkOpen) {
        setLinkOpen(false);
        editorRef.current?.focus();
      } else if (event.key === 'Escape' && colorsOpen) {
        setColorsOpen(false);
        editorRef.current?.focus();
      } else if (event.key === 'Escape' && panelOpen && !document.body.classList.contains('nav-open') && !document.querySelector('dialog[open]')) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [linkOpen, colorsOpen, panelOpen, editorRef]);

  useEffect(() => {
    if (!colorsOpen) {
      return undefined;
    }
    const onPointer = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.rb-color')) {
        setColorsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [colorsOpen]);

  // Leaving the editor, or opening a version to look at, closes what was open over the page.
  useEffect(() => {
    if (!inEditor || viewing !== null) {
      setBubble(null);
      setContext(null);
      setLinkOpen(false);
      hidePointer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inEditor, viewing]);

  useEffect(() => {
    if (step === 'finished') {
      setPrintPage(state.format.page);
      setDocxNote(false);
    }
  }, [step, state.format.page]);

  const templateName = (templateById(state.templateId) as { name: string; pdfOnly?: boolean });
  const bannerText = shownVersion ? `You're looking at v${shownVersion.number}: ${shownVersion.summary}.` : '';

  return (
    <>
      <PageHeader
        crumb="Resume"
        title="Builder"
        actions={
          <>
            <VersionMenu label="Uploaded" />
            <PreviewBadge />
            {step !== 'start' ? (
              <button className="btn btn-ghost" type="button" onClick={startOver}>
                <Icon name="refresh" />Start over
              </button>
            ) : null}
            {step === 'editor' ? <button className="btn btn-secondary" type="button" onClick={() => goTo('templates')}>Change template</button> : null}
            {step === 'editor' ? (
              <button className="btn btn-primary" type="button" onClick={() => { commitEditor(); goTo('finished'); }}>
                <Icon name="check" />Done
              </button>
            ) : null}
          </>
        }
      />
      <div className="content content-wide">
        <p className="alert alert-info" role="note">Preview with sample data: nothing here is saved to your account, and Lay AI&apos;s replies are samples. No AI is called yet.</p>
        <p className="sr-only" role="status">{status}</p>

        {step === 'start' ? <StartStep answers={state.answers} holdingRequest={holding} onSubmit={submitAnswers} /> : null}
        {step === 'templates' ? <TemplatesStep answers={state.answers} templateId={state.templateId} onBack={() => goTo('start')} onChoose={chooseTemplate} /> : null}

        {inEditor ? (
          <section className={`rb-editor${panelOpen ? ' panel-open' : ''}`} ref={rootRef} aria-label="Resume editor">
            <div className="rb-stage" ref={stageRef}>
              {shownVersion ? (
                <div className="alert alert-info rb-viewing">
                  <span>{bannerText}</span>
                  <span className="rb-viewing-actions">
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => restoreTo(shownVersion.number)}>Restore this version</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setViewing(null)}>Back to current</button>
                  </span>
                </div>
              ) : null}
              {editable ? (
                <Toolbar
                  format={state.format}
                  pages={state.answers.pages}
                  tools={tools}
                  colorsOpen={colorsOpen}
                  colorNote={colorNote}
                  onToggleColors={toggleColors}
                  onApplyColor={applyColor}
                  onFormat={setFormat}
                  onCommand={runCommand}
                  onLimit={setLimit}
                  onAddSection={addSection}
                  onFit={() => {
                    const result = fitResume(null);
                    const sentence = fitSentence(result);
                    setFitNote(sentence);
                    announce(sentence);
                  }}
                  onOpenSetup={() => setSetupOpen(true)}
                  toolbarRef={toolbarRef}
                />
              ) : null}
              {editable && context ? <ContextBar at={context} canTable={(name) => Boolean(editorRef.current?.canTable(name))} onSection={onSection} onTable={onTable} onLook={onLook} /> : null}
              {editable && linkOpen ? <div id="rb-linkbar"><LinkBar onSubmit={addLink} onCancel={() => { setLinkOpen(false); editorRef.current?.focus(); }} error={linkError} /></div> : null}
              {editable ? <p className="muted rb-hint">Click any part of your resume and type to change it. Select text to make it bold or a link. Every change is kept as a version.</p> : null}
              {editable && state.format.columns === 2 ? (
                <p className="muted rb-hint">Two columns look sharp, but some ATS parsers read them out of order. One column is the safest choice for online applications.</p>
              ) : null}
              <div className="rb-page-wrap" id="rb-page-wrap" ref={wrapRef}>
                <article
                  ref={editorHost}
                  id="rb-editor"
                  className={`${paperClasses(state.templateId, state.format, true)} rb-editor`}
                  style={paperVars(state.format)}
                  aria-label="Your resume"
                  hidden={!editable}
                />
                {shownVersion ? <Paper ref={paperRef} id="rb-paper" resume={shownVersion.resume as Resume} templateId={state.templateId} format={state.format} label="Your resume" /> : null}
              </div>
              {editable ? (
                <div className="rb-statusbar">
                  <span className={`rb-pages${pageFigure.over ? ' is-over' : ''}`}>{pageFigure.text}</span>
                  <span>{`${counts.words} ${counts.words === 1 ? 'word' : 'words'} · ${counts.characters} characters`}</span>
                  <span>{counts.saved}</span>
                  <button className="btn btn-ghost btn-sm" type="button" title="The resume as plain text, in the order an applicant tracking system reads it" onClick={openReadingOrder}>How an ATS reads this</button>
                  <label className="rb-zoom-label" htmlFor="rb-zoom">Zoom</label>
                  <select
                    className="select rb-zoom"
                    id="rb-zoom"
                    title="How big the page is drawn. Fit width fills the space."
                    value={zoom}
                    onChange={(event) => {
                      const next = ZOOMS.includes(event.target.value as Zoom) ? (event.target.value as Zoom) : 'fit';
                      writeJson(ZOOM_KEY, next);
                      zoomRef.current = next;
                      setZoom(next);
                      requestAnimationFrame(() => {
                        layoutPages();
                        updateBubble();
                      });
                    }}
                  >
                    <option value="fit">Fit width</option>
                    <option value="0.75">75%</option>
                    <option value="1">100%</option>
                    <option value="1.25">125%</option>
                    <option value="1.5">150%</option>
                  </select>
                  <span className="rb-engine" title="The resume is edited in a Tiptap (ProseMirror) editor">Editor: Tiptap</span>
                </div>
              ) : null}
              {fitNote ? <p className="rb-fit-note" role="status">{fitNote}</p> : null}
              <Bubble ref={bubbleRef} tools={tools} position={editable ? bubble : null} onCommand={runCommand} />
              <div className={`rb-pointer${pointer.visible ? ' is-visible' : ''}${pointer.editing ? ' is-editing' : ''}`} aria-hidden="true" style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}>
                <svg viewBox="0 0 24 24"><path d="M4.5 2.5 19.5 12l-6.8 1.7L9.3 20.5z" /></svg>
                <div className="rb-pointer-body">
                  <span className="rb-pointer-label">{pointer.label}</span>
                  <span className="rb-pointer-hint" hidden={!pointer.hint}>{pointer.hint}</span>
                </div>
              </div>
            </div>

            <LayPanel
              open={panelOpen}
              tab={tab}
              onTab={setTab}
              onClose={closePanel}
              rootRef={rootRef}
              state={state}
              resume={resumeNow}
              replying={replying}
              onSend={send}
              onDecide={decide}
              onAgent={runAgent}
              viewing={viewing}
              onView={(number) => { commitEditor(); setViewing(number); }}
              onRestore={restoreTo}
              inputRef={inputRef}
            />
          </section>
        ) : null}

        {inEditor ? (
          <button className="lay-fab" type="button" aria-controls="lay-panel" aria-expanded={panelOpen} hidden={panelOpen} onClick={openPanel}>
            <span className="lay-hi" aria-hidden="true">Hi!</span>
            <span className="lay-orb"><LayMark /></span>
            <span className="lay-name">Lay AI</span>
          </button>
        ) : null}

        {step === 'finished' && state.history ? (
          <section className="rb-finished" aria-label="Finished resume">
            <div className="rb-page-wrap" id="final-wrap" ref={finalWrap}>
              <Paper ref={finalPaper} id="final-paper" resume={resumeNow} templateId={templateName ? state.templateId : null} format={state.format} label="Your finished resume" />
            </div>
            <div className="card rb-finished-actions">
              <h2>Your resume is ready</h2>
              <p className="muted">{`Template ${templateName.name}, version ${state.history.current}.`}</p>
              <button className="btn btn-primary" type="button" onClick={() => window.print()}><Icon name="file" />Download PDF</button>
              <p className="field-hint">Opens the print window: choose &quot;Save as PDF&quot;.</p>
              {!templateName.pdfOnly ? (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    downloadBytes(buildResumeDocx(resumeNow, { format: state.format, templateId: state.templateId }), resumeDocxName(resumeNow), DOCX_MIME);
                    setDocxNote(true);
                    announce('Your Word file is downloading.');
                  }}
                >
                  Download DOCX
                </button>
              ) : null}
              {docxNote ? <p className="field-hint">Your Word file is downloading. It keeps your text, colours, links and tables; the layout can differ a little from the PDF.</p> : null}
              {templateName.pdfOnly ? <p className="field-hint">Classic is PDF only: the PDF is typeset like LaTeX (Typst, with the same font), and a DOCX can&apos;t keep that look.</p> : null}
              <button className="btn btn-ghost" type="button" onClick={() => goTo('editor')}>Back to editor</button>
            </div>
          </section>
        ) : null}
      </div>

      <PageSetupDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        format={state.format}
        pages={state.answers.pages}
        onFormat={setFormat}
        onLimit={setLimit}
        onPreset={(name) => update({ ...model.current, format: normalizeFormat({ ...model.current.format, ...MARGIN_PRESETS[name as keyof typeof MARGIN_PRESETS] }) as BuilderFormat })}
        onMargin={(marginKey, mm) => setMargin(marginKey, mm)}
      />
      <ReadingOrderDialog open={reading.open} onClose={() => setReading((current) => ({ ...current, open: false }))} text={reading.text} notes={reading.notes} />
    </>
  );
}
