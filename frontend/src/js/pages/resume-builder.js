import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { guardText, knownValues, privacyNote, resolveText } from './privacy-guard-rules.js';
import { createResumeEditor } from './resume-editor.js';
import { docToPlainText, readingNotes, resumeToDoc, tableClass, tableStyle } from './resume-doc.js';
import { RULER_THICKNESS, createRuler } from './resume-ruler.js';
import { downloadBytes } from '../core/download.js';
import { DOCX_MIME } from './docx-writer.js';
import { buildResumeDocx, resumeDocxName } from './resume-docx.js';
import {
  DEFAULT_ANSWERS,
  DEFAULT_FORMAT,
  FONT_SIZE,
  HIDEABLE_SECTIONS,
  MARGIN_KEYS,
  MARGIN_LIMITS_MM,
  MARGIN_PRESETS,
  PAGE_SIZES,
  WRITING_STYLE_LABELS,
  addVersion,
  answersSummary,
  applySuggestion,
  createHistory,
  currentResume,
  diffResume,
  fieldLabel,
  clampMargin,
  findVersion,
  fromMm,
  marginPreset,
  mmToPx,
  toMm,
  fitRequest,
  fitToPages,
  isRichPath,
  isSavedState,
  joinList,
  normalizeFormat,
  normalizeText,
  pageUsage,
  parseInline,
  relativeTime,
  resumeStats,
  restoreVersion,
  safeHref,
  sampleLayReply,
  sampleResume,
  sectionLabel,
  sentences,
  suggestTemplates,
  templateById,
  versionsNewestFirst,
  watchHint,
  TEXT_COLORS,
} from './resume-builder-rules.js';

// The Resume Builder preview: a clickable prototype with sample data. Steps: start questions ->
// templates -> editor -> finished. In the editor the resume sits on the left and is edited by
// typing (every committed change becomes a version), with a toolbar for fonts, sizes, bold,
// italic, underline, links, bullets and the writing style Lay AI uses. The floating Lay AI
// button opens a right-side panel with Chat and Versions. The Lay AI cursor follows the user's
// typing ("watching", with a short tip) and moves to what Lay AI changes ("editing"). Asked to
// fit a role, Lay AI suggests changes the user adds one by one: it never rewrites the whole
// resume. What the user types in the chat goes through the personal-data guard: the stored
// text has placeholders, the user's screen shows the real values. Nothing calls the backend or
// an AI: the replies come from sampleLayReply(), and the state lives in this browser only.

const STORE_KEY = `coverlay.resumeBuilder.${getUser()?.id ?? 'guest'}`;
const TYPING_DELAY_MS = 650;
const HINT_DELAY_MS = 900;
const EDITING_MS = 2800; // how long the Lay AI cursor stays on what it changed
const MAX_MESSAGES = 60;
const PANEL_SIZE_KEY = 'coverlay.layPanelSize';
const ZOOM_KEY = 'coverlay.resumeZoom';
const MAX_FIT = 1.5; // "Fit width" never draws the page bigger than 150%
const ZOOMS = ['fit', '0.75', '1', '1.25', '1.5'];
const PAGE_PAIRS = [['rb-page-wrap', 'rb-editor'], ['rb-page-wrap', 'rb-paper'], ['final-wrap', 'final-paper']]; // [wrapper, page]
const GREETING = "Hi! I'm Lay AI. Tell me what to change in your resume, or edit it yourself on the left.";

let state = loadState();
let panelOpen = false;
let tab = 'chat';
let highlight = null; // diffResume() of the last Lay AI change, shown in green until the next change
let viewing = null; // number of an older version shown read-only, or null
let replying = false;
let pointerFrame = 0;
let hintTimer = 0;
let editingTimer = 0;
let editingPath = null; // the field the Lay AI cursor points at while "editing"
let editor = null; // the Tiptap resume editor (resume-editor.js), made in wire()
let activePath = null; // the field the caret was last in, to commit an edit when the caret leaves it
let shownResume = null; // the resume object the editor document was last built from
let shownBullets = false;
let shownColumns = 1;
let zoom = ZOOMS.includes(readJson(ZOOM_KEY)) ? readJson(ZOOM_KEY) : 'fit'; // how big the page is drawn: 'fit' or a number as text
let templateFilter = 'all'; // 'all', '1' or '2': the template page's columns filter
let rulers = null; // { x, y }: the rulers along the top and left of the editable page
let pointerDown = false; // a mouse button is held, so the page must not change shape yet
let dropPending = false; // emptied skills waiting for the mouse button to come up
const storedOpen = new Set(); // messages whose "What we store" box is open

if (requireAuth()) {
  hydrateIcons();
  renderShell('builder');
  wire();
  render();
}

// ---------- state ----------

function freshState() {
  return { step: 'start', answers: { ...DEFAULT_ANSWERS }, fromUpload: false, templateId: null, history: null, messages: [], format: { ...DEFAULT_FORMAT } };
}

function loadState() {
  const saved = readJson(STORE_KEY);
  if (!isSavedState(saved)) {
    return freshState();
  }
  saved.format = normalizeFormat(saved.format);
  return saved;
}

function save() {
  state.messages = state.messages.slice(-MAX_MESSAGES);
  writeJson(STORE_KEY, state);
}

function announce(message) {
  setText(byId('rb-status'), message);
}

function goTo(step) {
  state.step = step;
  viewing = null;
  save();
  render();
  window.scrollTo({ top: 0 });
}

// ---------- events ----------

function wire() {
  byId('start-form').addEventListener('submit', (event) => {
    event.preventDefault();
    readAnswers(false);
  });
  byId('from-upload').addEventListener('click', () => readAnswers(true));
  byId('templates-back').addEventListener('click', () => goTo('start'));
  byId('template-filter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (button) {
      templateFilter = button.dataset.filter;
      renderTemplates();
    }
  });
  byId('template-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-template]');
    if (button) {
      chooseTemplate(button.dataset.template);
    }
  });

  byId('start-over').addEventListener('click', () => {
    state = freshState();
    panelOpen = false;
    highlight = null;
    goTo('start');
    announce('Started over.');
  });
  byId('change-template').addEventListener('click', () => goTo('templates'));
  byId('finish-button').addEventListener('click', () => {
    commitEditor();
    goTo('finished');
  });

  editor = createResumeEditor(byId('rb-editor'), {
    onTyping,
    onSelection: onCaretMoved,
    onFocus: schedulePointer,
    onBlur: onEditorBlur,
  });
  editor.onSkillButton(() => editor.addSkill());
  const bubble = byId('rb-bubble');
  bubble.addEventListener('mousedown', (event) => event.preventDefault()); // keep the selection in the text
  bubble.addEventListener('click', (event) => {
    const tool = event.target.closest('.rb-tool[data-cmd]');
    if (tool) {
      runCommand(tool.dataset.cmd);
      updateBubble();
    }
  });
  window.addEventListener('resize', updateBubble);
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => {
    pointerDown = false;
    if (dropPending) {
      dropPending = false;
      editor.dropEmptySkills();
    }
  }, true);
  window.addEventListener('resize', schedulePointer);

  wireToolbar();
  wirePage();
  wirePanelResize();
  wireSections();

  byId('lay-fab').addEventListener('click', openPanel);
  byId('lay-close').addEventListener('click', closePanel);
  byId('tab-chat').addEventListener('click', () => setTab('chat'));
  byId('tab-versions').addEventListener('click', () => setTab('versions'));
  byId('lay-form').addEventListener('submit', (event) => {
    event.preventDefault();
    send(byId('lay-input').value);
  });
  byId('lay-suggestions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (button) {
      send(button.dataset.prompt);
    }
  });
  byId('lay-messages').addEventListener('click', onMessageClick);
  byId('lay-version-list').addEventListener('click', (event) => {
    const view = event.target.closest('[data-view]');
    const restore = event.target.closest('[data-restore]');
    if (view) {
      viewing = Number(view.dataset.view);
      renderEditor();
    } else if (restore) {
      restoreTo(Number(restore.dataset.restore));
    }
  });
  byId('viewing-restore').addEventListener('click', () => restoreTo(viewing));
  byId('viewing-back').addEventListener('click', () => {
    viewing = null;
    renderEditor();
  });

  byId('download-pdf').addEventListener('click', () => window.print());
  byId('download-docx').addEventListener('click', () => {
    const resume = currentResume(state.history);
    downloadBytes(buildResumeDocx(resume, { format: state.format, templateId: state.templateId }), resumeDocxName(resume), DOCX_MIME);
    show(byId('docx-note'));
    announce('Your Word file is downloading.');
  });
  byId('back-to-editor').addEventListener('click', () => goTo('editor'));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !byId('rb-linkbar').hidden) {
      closeLinkBar();
    } else if (event.key === 'Escape' && panelOpen && !document.body.classList.contains('nav-open')) {
      closePanel();
    }
  });
}

function readAnswers(fromUpload) {
  const form = new FormData(byId('start-form'));
  state.answers = {
    role: normalizeText(form.get('role')).slice(0, 80),
    level: form.get('level') ?? DEFAULT_ANSWERS.level,
    style: form.get('style') ?? DEFAULT_ANSWERS.style,
    pages: Number(form.get('pages') ?? DEFAULT_ANSWERS.pages),
  };
  state.fromUpload = fromUpload;
  goTo('templates');
}

function chooseTemplate(id) {
  const template = templateById(id);
  const at = Date.now();
  if (!state.history) {
    const summary = state.fromUpload ? `Imported from upload, template ${template.name}` : `Started from template ${template.name}`;
    state.history = createHistory(sampleResume(), { source: state.fromUpload ? 'import' : 'template', summary, at });
  } else if (state.templateId !== template.id) {
    state.history = addVersion(state.history, currentResume(state.history), { source: 'template', summary: `Switched to template ${template.name}`, at });
  }
  // A template brings its typeface (Classic is the LaTeX look) and its columns; leaving Classic goes back to sans.
  if (state.templateId !== template.id) {
    const font = template.id === 'classic' ? 'classic' : template.font ?? (state.format.font === 'classic' ? 'sans' : state.format.font);
    state.format = normalizeFormat({ ...state.format, font, columns: template.columns ?? 1 });
  }
  if (state.templateId !== template.id) {
    // A template brings its own text size and margins (Compact is tighter).
    state.format = normalizeFormat({
      ...state.format, fontSize: template.fontSize, ...Object.fromEntries(MARGIN_KEYS.map((key) => [key, template.margin])),
    });
  }
  state.templateId = template.id;
  goTo('editor');
  announce(`Template ${template.name} chosen.`);
}

// ---------- editing the resume ----------

/**
 * Turns what was typed into a version, if anything changed: one version per field, like
 * before. The editor already shows the new text, so it is not redrawn.
 */
function commitEditor() {
  // Never save an editor that was not showing this resume (it was never drawn, so it is still empty).
  if (!editor?.isDirty() || viewing !== null || !state.history || shownResume === null) {
    return false;
  }
  const before = currentResume(state.history);
  const after = editor.getResume(before);
  editor.markClean();
  const change = diffResume(before, after);
  if (!change.fields.length && !change.addedSkills.length && !change.removedSkills.length && !change.extraChanged && after.skills.length === before.skills.length
    && after.skills.every((skill, i) => skill === before.skills[i])) {
    return false;
  }
  const where = change.fields[0] ?? (change.extraChanged && !change.addedSkills.length && !change.removedSkills.length ? 'custom' : 'skills');
  state.history = addVersion(state.history, after, { source: 'you', summary: `You edited ${sectionLabel(where)}`, at: Date.now() });
  highlight = null;
  editor.setHighlight(null);
  shownResume = after;
  save();
  if (panelOpen) {
    renderPanel();
  }
  updateStatus();
  return true;
}

/** The caret moved: leaving a field with an edit in it commits that edit. */
function onCaretMoved() {
  const path = editor.currentField()?.path ?? null;
  if (path !== activePath) {
    commitEditor();
    dropEmptySkillsSoon();
    activePath = path;
  }
  schedulePointer();
  updateToolState();
  updateBubble();
  updateStatus();
  updateContext();
}

/**
 * Removing an emptied skill makes the page shorter. With the mouse still down that would move
 * the text under the pointer mid-click and turn the click into a drag, so it waits for the
 * button to come up.
 */
function dropEmptySkillsSoon() {
  if (pointerDown) {
    dropPending = true;
  } else {
    editor.dropEmptySkills();
  }
}

function onEditorBlur(relatedTarget) {
  // Focus moving to the toolbar or the link bar is still editing.
  if (relatedTarget?.closest?.('#rb-toolbar, #rb-linkbar, #rb-context')) {
    return;
  }
  commitEditor();
  dropEmptySkillsSoon();
  activePath = null;
  hidePointer();
  updateBubble();
  updateStatus();
  show(byId('rb-context'), false);
}

// ---------- the toolbar ----------

function wireToolbar() {
  const toolbar = byId('rb-toolbar');
  for (const select of toolbar.querySelectorAll('[data-format]')) {
    select.addEventListener('change', () => setFormat(select.dataset.format, select.dataset.number !== undefined ? Number(select.value) : select.value));
  }
  byId('size-down').addEventListener('click', () => setFormat('fontSize', state.format.fontSize - FONT_SIZE.step));
  byId('size-up').addEventListener('click', () => setFormat('fontSize', state.format.fontSize + FONT_SIZE.step));
  byId('fmt-fontsize').addEventListener('change', (event) => setFormat('fontSize', Number(event.target.value)));
  byId('fmt-limit').addEventListener('change', (event) => {
    state.answers.pages = Number(event.target.value) === 2 ? 2 : 1;
    save();
    updatePageStatus();
  });
  byId('fit-page').addEventListener('click', () => {
    const result = fitResume(null);
    showFitNote(fitSentence(result));
    announce(fitSentence(result));
  });
  byId('fmt-bullets').addEventListener('click', () => setFormat('bullets', !state.format.bullets));
  // Pressing a tool must not take the selection out of the field being edited.
  toolbar.addEventListener('mousedown', (event) => {
    if (event.target.closest('.rb-tool, .rb-swatch, .rb-colors-auto')) {
      event.preventDefault();
    }
  });
  toolbar.addEventListener('click', (event) => {
    const tool = event.target.closest('.rb-tool[data-cmd]');
    if (tool) {
      runCommand(tool.dataset.cmd);
    }
  });
  byId('rb-linkbar').addEventListener('submit', addLink);
  byId('link-cancel').addEventListener('click', closeLinkBar);
  wireColors();
}

// ---------- text colour ----------

/** The palette is built from TEXT_COLORS, so the rules file stays the one list of what is on offer. */
function wireColors() {
  const panel = byId('rb-colors');
  byId('color-swatches').replaceChildren(...TEXT_COLORS.map(({ name, hex }) => {
    const swatch = el('button', { class: 'rb-swatch', type: 'button', title: name, 'aria-label': name, 'aria-pressed': 'false', 'data-color': hex });
    swatch.style.setProperty('--swatch', hex);
    return swatch;
  }));
  panel.addEventListener('click', (event) => {
    const swatch = event.target.closest('.rb-swatch');
    if (swatch) {
      applyColor(swatch.dataset.color);
    }
  });
  byId('color-auto').addEventListener('click', () => applyColor(null));
  byId('color-custom').addEventListener('change', (event) => applyColor(event.target.value));
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !event.target.closest('.rb-color')) {
      closeColors();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      closeColors();
      editor.focus();
    }
  });
}

function toggleColors() {
  const opening = byId('rb-colors').hidden;
  show(byId('rb-colors'), opening);
  byId('color-btn').setAttribute('aria-expanded', String(opening));
  setText(byId('color-note'), '');
  if (opening) {
    const current = editor.currentColor();
    for (const swatch of byId('rb-colors').querySelectorAll('.rb-swatch')) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.color === current));
    }
    byId('color-auto').setAttribute('aria-pressed', String(current === null));
  }
}

function closeColors() {
  show(byId('rb-colors'), false);
  byId('color-btn').setAttribute('aria-expanded', 'false');
}

/** Colours the selected text; `null` is "Automatic". A colour too pale to read on white paper is refused. */
function applyColor(hex) {
  if (!editor.setColor(hex)) {
    setText(byId('color-note'), 'That colour is too light to read on white paper. Pick a darker one.');
    return;
  }
  closeColors();
  updateToolState();
  announce(hex === null ? 'Text colour removed. Click outside the field to keep it.' : 'Text colour changed. Click outside the field to keep it.');
}

function setFormat(key, value) {
  commitEditor();
  state.format = normalizeFormat({ ...state.format, [key]: value });
  save();
  renderEditor();
  if (key === 'style') {
    announce(`Lay AI now writes in a ${WRITING_STYLE_LABELS[state.format.style].toLowerCase()} style.`);
  }
}

function runCommand(command) {
  if (command === 'undo' || command === 'redo') {
    editor[command]();
    updateToolState();
    return;
  }
  const field = editor.currentField();
  if (!field?.rich) {
    announce('Click into your summary, experience or contact line first, then use the toolbar.');
    flashHint('Click into a field first, then pick bold, italic, underline, a colour or a link.');
    return;
  }
  if (command === 'link') {
    openLinkBar();
    return;
  }
  if (command === 'color') {
    toggleColors();
    return;
  }
  editor.toggle(command);
  updateToolState();
}

function updateToolState() {
  const rich = Boolean(editor.currentField()?.rich);
  for (const tool of document.querySelectorAll('#rb-toolbar .rb-tool[data-cmd], #rb-bubble .rb-tool[data-cmd]')) {
    const command = tool.dataset.cmd;
    if (command === 'undo' || command === 'redo') {
      tool.disabled = !(command === 'undo' ? editor.canUndo() : editor.canRedo());
    } else if (command === 'color') {
      // The bar under the A shows the colour of the text at the caret (black when it has none).
      tool.style.setProperty('--picked', (rich && editor.currentColor()) || '#000000');
    } else if (command !== 'link') {
      tool.setAttribute('aria-pressed', String(rich && editor.isActive(command)));
    }
  }
}

/** The small floating toolbar above selected text in a field that takes formatting. */
function updateBubble() {
  const bubble = byId('rb-bubble');
  const rect = viewing === null && editor.hasFocus() && editor.currentField()?.rich ? editor.selectionRect() : null;
  if (!rect) {
    show(bubble, false);
    return;
  }
  show(bubble, true);
  const stage = byId('rb-stage').getBoundingClientRect();
  const x = Math.min(Math.max(rect.left - stage.left, 0), stage.width - bubble.offsetWidth);
  const y = rect.top - stage.top - bubble.offsetHeight - 8;
  bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(y, 0))}px)`;
}

/** Word and character counts, and whether the last edit has been kept as a version. */
function updateStatus() {
  if (!editor || !state.history || viewing !== null) {
    return;
  }
  const before = currentResume(state.history);
  const { words, characters } = resumeStats(editor.isDirty() ? editor.getResume(before) : before);
  setText(byId('rb-count'), `${words} ${words === 1 ? 'word' : 'words'} · ${characters} characters`);
  setText(byId('rb-saved'), editor.isDirty() ? 'Editing: kept as a version when you leave the field' : `All changes kept · v${state.history.current}`);
}

function openLinkBar() {
  setText(byId('link-error'), '');
  const input = byId('link-url');
  input.value = '';
  show(byId('rb-linkbar'));
  input.focus();
}

function closeLinkBar() {
  show(byId('rb-linkbar'), false);
  editor.focus();
}

function addLink(event) {
  event.preventDefault();
  const typed = byId('link-url').value.trim();
  const href = safeHref(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) ? `mailto:${typed}` : typed);
  if (!href) {
    setText(byId('link-error'), 'Use a web address like linkedin.com/in/your-name, or an email address.');
    return;
  }
  show(byId('rb-linkbar'), false);
  // With nothing selected, the address itself becomes the link text.
  editor.setLink(href, typed.replace(/^mailto:/, ''));
  announce('Link added. Click outside the field to keep it.');
}

// ---------- the Lay AI cursor (animation only, no AI call) ----------

function onTyping() {
  show(byId('fit-note'), false);
  schedulePointer();
  updateToolState();
  updateBubble();
  updateStatus();
  clearTimeout(hintTimer);
  setHint(null);
  // After a short pause, Lay AI "notices" what you typed and offers one tip.
  hintTimer = setTimeout(() => {
    const field = editor.currentField();
    if (field && editor.hasFocus()) {
      setHint(watchHint(field.path, editor.currentValue(currentResume(state.history))));
    }
  }, HINT_DELAY_MS);
}

function setHint(text) {
  const hint = byId('rb-pointer-hint');
  setText(hint, text ?? '');
  show(hint, Boolean(text));
}

function flashHint(text) {
  const rect = editor.fieldRect('summary');
  if (!rect) {
    return;
  }
  editingPath = 'summary';
  setPointerLabel('Lay AI');
  setHint(text);
  placePointer(rect, true);
  clearTimeout(editingTimer);
  editingTimer = setTimeout(() => {
    editingPath = null;
    setHint(null);
    hidePointer();
  }, 3200);
}

function setPointerLabel(text) {
  setText(byId('rb-pointer-label'), text);
}

function schedulePointer() {
  cancelAnimationFrame(pointerFrame);
  pointerFrame = requestAnimationFrame(movePointer);
}

function movePointer() {
  if (editingPath) {
    const rect = editor.fieldRect(editingPath);
    if (rect && (rect.width > 0 || rect.height > 0)) { // a hidden section has no size: nothing to point at
      placePointer(rect, true);
      return;
    }
  }
  const field = editor.currentField();
  if (!field || !editor.hasFocus()) {
    hidePointer();
    return;
  }
  const caret = editor.caretRect();
  setPointerLabel('Lay AI · watching');
  byId('rb-pointer').classList.remove('is-editing');
  placePointer(caret ?? editor.fieldRect(field.path), !caret);
}

/** Beside the caret on the same line (never over the next line of text), or at a field's end. */
function placePointer(rect, atFieldEnd) {
  const pointer = byId('rb-pointer');
  const stage = byId('rb-stage').getBoundingClientRect();
  const anchorX = atFieldEnd ? Math.min(rect.right, rect.left + 260) : rect.right;
  // Room for the tip bubble (max 230px) to the right, inside the stage.
  const x = Math.min(anchorX - stage.left + 8, stage.width - 250);
  const y = rect.top - stage.top - 2;
  pointer.style.transform = `translate(${Math.round(Math.max(x, 0))}px, ${Math.round(y)}px)`;
  pointer.classList.add('is-visible');
}

function hidePointer() {
  if (editingPath) {
    return;
  }
  clearTimeout(hintTimer);
  setHint(null);
  byId('rb-pointer').classList.remove('is-visible', 'is-editing');
}

/** After Lay AI changes the resume, its cursor goes to the change, as if it typed it. */
function pointToChange(change) {
  const path = change.fields[0] ?? (change.addedSkills.length || change.removedSkills.length ? skillPath(change) : null);
  if (!path) {
    return;
  }
  editingPath = path;
  scrollToEdit(path);
  setHint(null);
  setPointerLabel('Lay AI is editing…');
  byId('rb-pointer').classList.add('is-editing');
  schedulePointer();
  clearTimeout(editingTimer);
  editingTimer = setTimeout(() => {
    editingPath = null;
    byId('rb-pointer').classList.remove('is-editing');
    hidePointer();
  }, EDITING_MS);
}

/**
 * Brings what Lay AI just changed into view: if its field is off screen (or hugging an edge),
 * the page scrolls to put it in the middle, so the person sees the edit and the cursor on it
 * instead of changes happening below the fold. Respects "reduce motion".
 */
function scrollToEdit(path) {
  const rect = editor.fieldRect(path);
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

function skillPath(change) {
  const skills = currentResume(state.history).skills;
  const added = change.addedSkills.at(-1);
  const index = added ? skills.findIndex((s) => s.toLowerCase() === added.toLowerCase()) : skills.length - 1;
  return `skills.${Math.max(index, 0)}`;
}

// ---------- panel: chat and versions ----------

function openPanel() {
  panelOpen = true;
  renderEditor();
  (tab === 'chat' ? byId('lay-input') : byId('tab-versions')).focus();
}

function closePanel() {
  panelOpen = false;
  renderEditor();
  byId('lay-fab').focus();
}

function setTab(next) {
  tab = next;
  renderPanel();
}

function send(text) {
  const typed = normalizeText(text);
  if (!typed || replying || !state.history) {
    return;
  }
  commitEditor();
  viewing = null;
  replying = true;
  // The guard: what is stored (and what Lay AI would send to Gemini) has placeholders; the
  // vault with the real values is the account's own and only fills this screen.
  const guard = guardText(typed, knownValues(currentResume(state.history)));
  state.messages.push({ id: messageId(), from: 'you', text: guard.stored, vault: guard.vault, found: guard.found });
  byId('lay-input').value = '';
  renderEditor();

  setTimeout(() => {
    const before = currentResume(state.history);
    // "Fit it on one page" changes how the resume is set (spacing, margins, text size), never the words.
    const fit = fitRequest(guard.stored);
    const result = fit
      ? { reply: fitSentence(fitResume(fit.pages)), resume: before, summary: null }
      : sampleLayReply(guard.stored, before, state.format.style);
    let change = null;
    if (result.resume !== before) {
      state.history = addVersion(state.history, result.resume, { source: 'ai', summary: result.summary, at: Date.now() });
      change = diffResume(before, result.resume);
      highlight = change;
    }
    if (result.suggestion) {
      state.messages.push({
        id: messageId(), from: 'lay', kind: 'suggest', text: result.reply, role: result.suggestion.role, items: result.suggestion.items,
      });
    } else {
      state.messages.push({ id: messageId(), from: 'lay', text: result.reply });
    }
    replying = false;
    save();
    renderEditor();
    if (change) {
      pointToChange(change);
    }
    if (tab === 'chat') {
      // preventScroll: the page is scrolling to what Lay AI changed, and focusing the box must not cancel that.
      byId('lay-input').focus({ preventScroll: true });
    }
  }, TYPING_DELAY_MS);
}

let messageCounter = 0;
function messageId() {
  messageCounter += 1;
  return `${Date.now().toString(36)}-${messageCounter}`;
}

function onMessageClick(event) {
  const decision = event.target.closest('[data-suggest]');
  if (decision) {
    decide(decision.dataset.message, decision.dataset.suggest, decision.dataset.action);
    return;
  }
  const stored = event.target.closest('[data-stored]');
  if (stored) {
    const id = stored.dataset.stored;
    if (storedOpen.has(id)) {
      storedOpen.delete(id);
    } else {
      storedOpen.add(id);
    }
    renderMessages();
  }
}

/** Add or Skip one suggestion: only an Add changes the resume, as its own version. */
function decide(messageKey, itemId, action) {
  const message = state.messages.find((m) => m.id === messageKey);
  const item = message?.items?.find((i) => i.id === itemId);
  if (!item || item.status !== 'open') {
    return;
  }
  commitEditor();
  if (action === 'add') {
    const before = currentResume(state.history);
    const after = applySuggestion(before, item);
    if (after !== before) {
      const summary = item.kind === 'skill' ? `Lay AI: added ${item.skill} (you accepted)` : 'Lay AI: new Summary (you accepted)';
      state.history = addVersion(state.history, after, { source: 'ai', summary, at: Date.now() });
      highlight = diffResume(before, after);
    }
    item.status = 'added';
    save();
    renderEditor();
    if (after !== before) {
      pointToChange(highlight);
    }
    announce(item.kind === 'skill' ? `Added ${item.skill}.` : 'Summary updated.');
  } else {
    item.status = 'skipped';
    save();
    renderEditor();
  }
}

function restoreTo(number) {
  const next = restoreVersion(state.history, number, Date.now());
  if (next === state.history) {
    return;
  }
  state.history = next;
  highlight = null;
  viewing = null;
  save();
  renderEditor();
  announce(`Restored version ${number}.`);
}

// ---------- custom sections and tables ----------

/** "Add section", the section and table tools that appear when the caret is in one, and the ATS reading order. */
function wireSections() {
  byId('add-section').addEventListener('change', (event) => {
    const [kind, columns] = event.target.value.split('-');
    event.target.value = '';
    if (!kind) {
      return;
    }
    commitEditor();
    editor.addSection(kind, Number(columns) || 2);
    commitEditor();
    updateContext();
    updateStatus();
    announce('Section added. Type its name, then fill it in.');
  });

  const context = byId('rb-context');
  context.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) {
      event.preventDefault(); // keep the caret in the section while a tool is used
    }
  });
  context.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-ctx], [data-table]');
    if (!tool) {
      return;
    }
    if (tool.dataset.table) {
      editor.tableCommand(tool.dataset.table);
    } else {
      const done = {
        up: () => editor.moveSection(-1),
        down: () => editor.moveSection(1),
        delete: () => editor.deleteSection(),
        'insert-table': () => editor.insertTable(2, 2),
      }[tool.dataset.ctx]();
      if (!done && tool.dataset.ctx !== 'insert-table') {
        return;
      }
    }
    commitEditor();
    updateContext();
    updateStatus();
  });
  // The table's lines and spacing: each control sets one attribute; the editor brings a value into its limits
  // and updateContext() shows the value that was kept.
  const tableLook = { 'ctx-borders': 'borders', 'ctx-style': 'borderStyle', 'ctx-width': 'borderWidth', 'ctx-padding': 'cellPadding', 'ctx-gap': 'cellGap' };
  for (const [id, key] of Object.entries(tableLook)) {
    const control = byId(id);
    control.addEventListener('change', () => {
      const look = editor.setTableLook({ [key]: control.value });
      if (look) {
        control.value = String(look[key]); // show what was kept, e.g. 9 pt of width becomes 6
      }
      commitEditor();
      updateContext();
    });
  }

  byId('open-reading-order').addEventListener('click', () => {
    commitEditor();
    const doc = resumeToDoc(currentResume(state.history), { bullets: state.format.bullets, columns: state.format.columns });
    setText(byId('reading-text'), docToPlainText(doc, { hidden: state.format.hidden }));
    byId('reading-notes').replaceChildren(...readingNotes(doc).map((note) => el('li', {}, note)));
    byId('reading-order').showModal();
  });
}

/** Shows the section and table tools when the caret is in a custom section. */
function updateContext() {
  const bar = byId('rb-context');
  const at = viewing === null && editor ? editor.sectionState() : null;
  if (!at) {
    show(bar, false);
    return;
  }
  show(bar, true);
  setText(byId('ctx-name'), `Section: ${at.title || 'untitled'}`);
  byId('ctx-up').disabled = at.index <= 0;
  byId('ctx-down').disabled = at.index >= at.count - 1;
  show(byId('ctx-table'), at.inTable);
  show(byId('ctx-look'), at.inTable);
  show(byId('ctx-insert'), !at.inTable);
  if (at.inTable) {
    // Not while the person is typing in a number box: that would rewrite what they have half typed.
    const typing = document.activeElement?.closest?.('#ctx-look input');
    byId('ctx-borders').value = at.table.borders;
    byId('ctx-style').value = at.table.borderStyle;
    for (const [id, key] of [['ctx-width', 'borderWidth'], ['ctx-padding', 'cellPadding'], ['ctx-gap', 'cellGap']]) {
      if (!typing || typing.id !== id) {
        byId(id).value = String(at.table[key]);
      }
    }
    for (const button of byId('ctx-table').querySelectorAll('[data-table]')) {
      button.disabled = !editor.canTable(button.dataset.table);
    }
  }
}

// ---------- the page: size, scaling, how full it is, and fitting ----------

/**
 * The page is drawn at its true paper size (A4 or Letter) so the page count is real, then
 * scaled down to fit its column. The scale is a transform, so the measurements below, which
 * are in unscaled pixels, stay true to the paper.
 */
function layoutPages() {
  for (const [wrapId, paperId] of PAGE_PAIRS) {
    const wrap = byId(wrapId);
    const paper = byId(paperId);
    if (!wrap || !paper || paper.hidden || !wrap.offsetParent) {
      continue;
    }
    // The rulers hug the editable page only: a strip along its top and one down its left side.
    const rulersOn = paperId === 'rb-editor' && Boolean(rulers);
    const gutter = rulersOn ? RULER_THICKNESS + 3 : 0;
    const available = wrap.clientWidth - gutter - 10; // a little room for the page's shadow
    const width = paper.offsetWidth;
    if (available <= 0 || !width) {
      continue;
    }
    // Fit width fills the space (up to 150%); a fixed zoom applies to the page being edited and scrolls sideways if it is wider.
    const fixed = wrapId === 'rb-page-wrap' && zoom !== 'fit' ? Number(zoom) : null;
    const scale = fixed ?? Math.min(MAX_FIT, available / width);
    const left = gutter + Math.max(0, (available - width * scale) / 2);
    paper.style.transform = Math.abs(scale - 1) > 0.001 ? `scale(${scale})` : '';
    paper.style.left = `${left}px`;
    paper.style.top = `${gutter}px`;
    wrap.style.height = `${gutter + Math.ceil(paper.offsetHeight * scale) + 14}px`;
    if (wrapId === 'rb-page-wrap') {
      for (const ruler of rulers ? [rulers.x, rulers.y] : []) {
        ruler.element.hidden = !rulersOn;
      }
    }
    if (rulersOn) {
      const page = PAGE_SIZES[state.format.page];
      const pxPerMm = mmToPx(1) * scale;
      const f = state.format;
      rulers.x.element.style.left = `${left}px`;
      rulers.x.element.style.top = '0px';
      rulers.x.update({ lengthMm: page.widthMm, pxPerMm, startMm: f.marginLeft, endMm: f.marginRight, unit: f.unit });
      rulers.y.element.style.left = `${Math.max(0, left - gutter)}px`;
      rulers.y.element.style.top = `${gutter}px`;
      rulers.y.update({ lengthMm: page.heightMm, pxPerMm, startMm: f.marginTop, endMm: f.marginBottom, unit: f.unit });
    }
  }
}

/**
 * Sets one margin (in millimetres) from a ruler handle, the Page setup dialog, or a key press.
 * The text always keeps at least 60 mm of width and 80 mm of height. While a handle is still
 * being dragged (`commit` false) nothing is saved yet.
 */
function setMargin(key, mm, { commit = true } = {}) {
  const f = state.format;
  const page = PAGE_SIZES[f.page];
  const pair = { marginTop: 'marginBottom', marginBottom: 'marginTop', marginLeft: 'marginRight', marginRight: 'marginLeft' }[key];
  const horizontal = key === 'marginLeft' || key === 'marginRight';
  const room = (horizontal ? page.widthMm - 60 : page.heightMm - 80) - f[pair];
  state.format = normalizeFormat({ ...f, [key]: Math.min(clampMargin(mm), room) });
  if (commit) {
    save();
  }
  renderEditor();
}

/** The height the resume's content takes on the page: its text, plus the margins and the border. */
function pageContentHeight(paper) {
  const inner = paper.firstElementChild;
  if (!inner) {
    return 0;
  }
  const style = getComputedStyle(paper);
  return inner.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2;
}

/** The status bar's page figure: how much of the page limit the resume uses, and a line where each page ends. */
function updatePageStatus() {
  const paper = [byId('rb-editor'), byId('rb-paper')].find((candidate) => candidate && !candidate.hidden && candidate.offsetParent);
  if (!paper) {
    return;
  }
  const limit = state.answers.pages === 2 ? 2 : 1;
  const usage = pageUsage(pageContentHeight(paper), state.format.page, limit);
  paper.classList.toggle('is-multipage', usage.used > 1.003);
  const badge = byId('rb-pages');
  badge.classList.toggle('is-over', !usage.fits);
  const pages = limit === 1 ? 'page' : 'pages';
  setText(badge, usage.fits
    ? `Fits ${limit} ${pages} · ${Math.round((usage.used / limit) * 100)}% full`
    : `Over the ${limit}-page limit by ${Math.max(1, Math.round(usage.over * 100))}%`);
}

/** Content height of the editor if the resume were set with `format`: used to try fits without redrawing. */
function measureFormat(format) {
  const host = byId('rb-editor');
  applyPaperFormat(host, state.templateId, format, true);
  host.classList.add('rb-editor');
  return pageContentHeight(host);
}

/**
 * Fits the resume to `pages` pages (the page limit when null) by changing only how it is set.
 * See fitToPages(): bounded, never deletes text, never goes below the smallest readable size.
 */
function fitResume(pages) {
  commitEditor();
  viewing = null;
  const limit = pages ?? (state.answers.pages === 2 ? 2 : 1);
  state.answers.pages = limit;
  const result = fitToPages(state.format, limit, measureFormat);
  state.format = result.format;
  save();
  renderEditor();
  return { ...result, limit };
}

/** What happened, in words: it fit, it already fit, or it still does not and what to do. */
function fitSentence(result) {
  const pages = `${result.limit} ${result.limit === 1 ? 'page' : 'pages'}`;
  if (result.fits && !result.changes.length) {
    return `It already fits on ${pages}: ${Math.round((result.used / result.limit) * 100)}% of the space is used. I changed nothing.`;
  }
  if (result.fits) {
    return `Done: it fits on ${pages} now. I ${joinList(result.changes)}. Every word is still there.`;
  }
  const way = result.limit === 1 ? 'or allow 2 pages' : 'or trim your oldest role';
  return `It is still ${Math.max(1, Math.round(result.over * 100))}% too long for ${pages}, even at the smallest setting I use `
    + `(${result.format.fontSize} pt, ${Number(Math.max(...MARGIN_KEYS.map((key) => result.format[key])).toFixed(1))} mm margins, tight spacing). I have not deleted anything. `
    + `To make room, try "Shorten my summary", ${way}.`;
}

function showFitNote(text) {
  setText(byId('fit-note'), text);
  show(byId('fit-note'), true);
}

/** The paper size the browser prints at, when the resume is saved as a PDF. */
function setPrintPage() {
  let style = document.getElementById('rb-page-style');
  if (!style) {
    style = el('style', { id: 'rb-page-style' });
    document.head.append(style);
  }
  style.textContent = `@page { size: ${state.format.page === 'letter' ? 'letter' : 'A4'}; margin: 0; }`;
}

/** The Page setup dialog: paper, units, the four margins, columns, the page limit, heading lines. */
function wirePageSetup() {
  const dialog = byId('page-setup');
  byId('open-page-setup').addEventListener('click', () => {
    renderPageSetup();
    dialog.showModal();
  });
  byId('ps-page').addEventListener('change', (event) => setFormat('page', event.target.value));
  byId('ps-unit').addEventListener('change', (event) => setFormat('unit', event.target.value));
  byId('ps-columns').addEventListener('change', (event) => setFormat('columns', Number(event.target.value)));
  byId('ps-rules').addEventListener('change', (event) => setFormat('rules', event.target.checked));
  for (const box of dialog.querySelectorAll('[data-show]')) {
    box.addEventListener('change', () => {
      const shown = new Set([...dialog.querySelectorAll('[data-show]')].filter((other) => other.checked).map((other) => other.dataset.show));
      setFormat('hidden', HIDEABLE_SECTIONS.filter((name) => !shown.has(name)));
    });
  }
  byId('ps-limit').addEventListener('change', (event) => {
    state.answers.pages = Number(event.target.value) === 2 ? 2 : 1;
    save();
    renderEditor();
  });
  byId('ps-preset').addEventListener('change', (event) => {
    if (MARGIN_PRESETS[event.target.value]) {
      state.format = normalizeFormat({ ...state.format, ...MARGIN_PRESETS[event.target.value] });
      save();
      renderEditor();
    }
  });
  for (const input of dialog.querySelectorAll('[data-margin]')) {
    input.addEventListener('change', () => {
      if (input.value !== '') {
        setMargin(input.dataset.margin, toMm(Number(input.value), state.format.unit));
      }
    });
  }
}

/** Fills the dialog (and the toolbar's page-limit box) from the current format. */
function renderPageSetup() {
  const f = state.format;
  byId('ps-page').value = f.page;
  byId('ps-unit').value = f.unit;
  byId('ps-columns').value = String(f.columns);
  byId('ps-limit').value = String(state.answers.pages);
  byId('ps-rules').checked = f.rules;
  for (const box of byId('page-setup').querySelectorAll('[data-show]')) {
    box.checked = !f.hidden.includes(box.dataset.show);
  }
  byId('ps-preset').value = marginPreset(f);
  const step = f.unit === 'in' ? 0.05 : 0.1;
  for (const input of byId('page-setup').querySelectorAll('[data-margin]')) {
    input.step = String(step);
    input.min = String(fromMm(MARGIN_LIMITS_MM.min, f.unit).toFixed(2));
    input.max = String(fromMm(MARGIN_LIMITS_MM.max, f.unit).toFixed(2));
    input.value = String(Number(fromMm(f[input.dataset.margin], f.unit).toFixed(f.unit === 'in' ? 2 : 1)));
    input.setAttribute('aria-label', `${input.previousElementSibling.textContent} margin in ${f.unit === 'in' ? 'inches' : 'centimetres'}`);
  }
}

/** Keeps the page scaled and its figure true as the column, the panel or the text change size. */
function wirePage() {
  rulers = {
    x: createRuler('x', { start: 'marginLeft', end: 'marginRight' }, setMargin),
    y: createRuler('y', { start: 'marginTop', end: 'marginBottom' }, setMargin),
  };
  byId('rb-page-wrap').append(rulers.x.element, rulers.y.element);
  wirePageSetup();
  const refresh = () => {
    layoutPages();
    updatePageStatus();
  };
  const observer = new ResizeObserver(refresh);
  for (const id of ['rb-stage', 'rb-editor', 'rb-paper']) {
    observer.observe(byId(id));
  }
  const zoomBox = byId('rb-zoom');
  zoomBox.value = zoom;
  zoomBox.addEventListener('change', () => {
    zoom = ZOOMS.includes(zoomBox.value) ? zoomBox.value : 'fit';
    writeJson(ZOOM_KEY, zoom);
    refresh();
    updateBubble();
  });
  window.addEventListener('resize', refresh);
  document.fonts?.ready.then(refresh);
}

// ---------- the Lay AI panel: drag its edges to resize it ----------

function wirePanelResize() {
  const root = byId('step-editor');
  const panel = byId('lay-panel');
  const size = readJson(PANEL_SIZE_KEY) ?? {};
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const widthLimits = () => [300, Math.max(300, Math.min(720, root.clientWidth - 340))];
  const heightLimits = () => [420, Math.max(420, window.innerHeight - 32)];

  const apply = () => {
    for (const [key, name] of [['w', '--lay-w'], ['h', '--lay-h']]) {
      if (size[key]) {
        root.style.setProperty(name, `${size[key]}px`);
      } else {
        root.style.removeProperty(name);
      }
    }
  };
  const setWidth = (value) => {
    size.w = Math.round(clamp(value, ...widthLimits()));
    apply();
  };
  const setHeight = (value) => {
    size.h = Math.round(clamp(value, ...heightLimits()));
    apply();
  };
  const remember = () => writeJson(PANEL_SIZE_KEY, size);
  apply();

  const drag = (handle, onMove) => {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      const start = { x: event.clientX, y: event.clientY, w: panel.offsetWidth, h: panel.offsetHeight };
      const move = (moveEvent) => onMove(start, moveEvent);
      const stop = () => {
        handle.classList.remove('is-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        remember();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    });
  };
  drag(byId('lay-resize-x'), (start, event) => setWidth(start.w + (start.x - event.clientX)));
  drag(byId('lay-resize-y'), (start, event) => setHeight(start.h + (event.clientY - start.y)));

  const keys = (handle, grow, shrink, resize, key) => {
    handle.addEventListener('keydown', (event) => {
      if (event.key === grow || event.key === shrink) {
        event.preventDefault();
        resize((key === 'w' ? panel.offsetWidth : panel.offsetHeight) + (event.key === grow ? 24 : -24));
        remember();
      } else if (event.key === 'Home') {
        delete size[key];
        apply();
        remember();
      }
    });
    handle.addEventListener('dblclick', () => {
      delete size[key];
      apply();
      remember();
    });
  };
  keys(byId('lay-resize-x'), 'ArrowLeft', 'ArrowRight', setWidth, 'w');
  keys(byId('lay-resize-y'), 'ArrowDown', 'ArrowUp', setHeight, 'h');
}

// ---------- rendering ----------

function render() {
  const { step } = state;
  for (const name of ['start', 'templates', 'editor', 'finished']) {
    show(byId(`step-${name}`), step === name);
  }
  show(byId('start-over'), step !== 'start');
  show(byId('change-template'), step === 'editor');
  show(byId('finish-button'), step === 'editor');
  if (step === 'start') {
    renderStart();
  } else if (step === 'templates') {
    renderTemplates();
  } else if (step === 'editor') {
    renderEditor();
  } else {
    renderFinished();
  }
  if (step !== 'editor') {
    show(byId('lay-fab'), false);
  }
}

function renderStart() {
  const form = byId('start-form');
  form.elements.role.value = state.answers.role;
  for (const name of ['level', 'style', 'pages']) {
    for (const input of form.querySelectorAll(`input[name="${name}"]`)) {
      input.checked = input.value === String(state.answers[name]);
    }
  }
}

function renderTemplates() {
  setText(byId('templates-sub'), answersSummary(state.answers));
  for (const button of byId('template-filter').querySelectorAll('[data-filter]')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === templateFilter));
  }
  const shown = suggestTemplates(state.answers, Infinity).filter((template) => templateFilter === 'all' || String(template.columns ?? 1) === templateFilter);
  byId('template-list').replaceChildren(
    ...shown.map((template, index) =>
      el(
        'li',
        { class: `card rb-tpl-card${index === 0 ? ' is-best' : ''}` },
        el('div', { class: `rb-mini rb-mini-${template.id}`, 'aria-hidden': 'true' }, ...Array.from({ length: 8 }, () => el('span'))),
        el(
          'div',
          { class: 'rb-tpl-title' },
          el('h3', {}, template.name),
          index === 0 ? el('span', { class: 'badge badge-green' }, 'Best match') : null,
          el('span', { class: 'badge' }, (template.columns ?? 1) === 2 ? 'Two columns' : 'One column'),
          template.pdfOnly ? el('span', { class: 'badge' }, 'PDF only') : null,
          state.templateId === template.id ? el('span', { class: 'badge badge-blue' }, 'In use') : null,
        ),
        el('p', { class: 'muted' }, template.blurb),
        el('button', { class: `btn ${index === 0 ? 'btn-primary' : 'btn-secondary'}`, type: 'button', 'data-template': template.id }, 'Use this'),
      ),
    ),
  );
}

function renderEditor() {
  const shown = viewing !== null ? findVersion(state.history, viewing) : null;
  if (viewing !== null && !shown) {
    viewing = null;
  }
  const resume = shown ? shown.resume : currentResume(state.history);
  const editable = viewing === null;

  byId('step-editor').classList.toggle('panel-open', panelOpen);
  show(byId('rb-editor'), editable);
  show(byId('rb-paper'), !editable);
  show(byId('rb-statusbar'), editable);
  if (!editable) {
    show(byId('rb-bubble'), false);
  }
  if (editable) {
    const host = byId('rb-editor');
    applyPaperFormat(host, state.templateId, state.format, true);
    host.classList.add('rb-editor');
    // Redraw the document only when the resume, the bullets or the columns are not what it shows.
    if (shownResume !== resume || shownBullets !== state.format.bullets || shownColumns !== state.format.columns) {
      editor.setResume(resume, { bullets: state.format.bullets, columns: state.format.columns });
      shownResume = resume;
      shownBullets = state.format.bullets;
      shownColumns = state.format.columns;
    }
    editor.setHighlight(highlight);
    updateStatus();
  } else {
    fillPaper(byId('rb-paper'), resume, { editable: false, highlight: null, templateId: state.templateId, format: state.format });
  }
  renderToolbar(editable);
  show(byId('editor-hint'), editable);
  show(byId('viewing-banner'), !editable);
  if (!editable) {
    setText(byId('viewing-text'), `You're looking at v${shown.number}: ${shown.summary}.`);
    hidePointer();
  }

  show(byId('lay-panel'), panelOpen);
  const fab = byId('lay-fab');
  show(fab, !panelOpen);
  fab.setAttribute('aria-expanded', String(panelOpen));
  if (panelOpen) {
    renderPanel();
  }
  layoutPages();
  updatePageStatus();
}

function renderToolbar(editable) {
  show(byId('rb-toolbar'), editable);
  if (!editable) {
    show(byId('rb-linkbar'), false);
  }
  for (const select of byId('rb-toolbar').querySelectorAll('[data-format]')) {
    select.value = String(state.format[select.dataset.format]);
  }
  byId('fmt-bullets').setAttribute('aria-pressed', String(state.format.bullets));
  byId('fmt-fontsize').value = String(state.format.fontSize);
  byId('fmt-limit').value = String(state.answers.pages);
  show(byId('columns-note'), editable && state.format.columns === 2);
  renderPageSetup();
  updateContext();
}

function renderPanel() {
  byId('tab-chat').setAttribute('aria-selected', String(tab === 'chat'));
  byId('tab-versions').setAttribute('aria-selected', String(tab === 'versions'));
  show(byId('lay-chat'), tab === 'chat');
  show(byId('lay-versions'), tab === 'versions');
  setText(byId('versions-count'), String(state.history.versions.length));
  setText(byId('lay-sub'), `Preview: sample replies · ${WRITING_STYLE_LABELS[state.format.style]} style`);
  renderMessages();
  renderVersions();
}

function renderMessages() {
  const list = byId('lay-messages');
  const items = [el('li', { class: 'lay-msg from-lay' }, GREETING)];
  for (const message of state.messages) {
    items.push(...renderMessage(message));
  }
  if (replying) {
    items.push(el('li', { class: 'lay-msg from-lay is-typing' }, 'Lay AI is typing…'));
  }
  list.replaceChildren(...items);
  list.scrollTop = list.scrollHeight;
  byId('lay-send').disabled = replying;
}

function renderMessage(message) {
  if (message.from === 'you') {
    // Your own screen: the placeholders filled back in from this message's vault.
    const shown = resolveText(message.text, message.vault ?? {}, (key) => `{${key}}`);
    const nodes = [el('li', { class: 'lay-msg from-you' }, shown)];
    const note = privacyNote(message.found ?? []);
    if (note) {
      const key = message.id ?? message.text;
      const open = storedOpen.has(key);
      nodes.push(
        el(
          'li',
          { class: 'lay-privacy' },
          el('p', { class: 'lay-privacy-note' }, icon('lock'), note),
          el('button', { class: 'rb-link lay-privacy-toggle', type: 'button', 'data-stored': key, 'aria-expanded': String(open) }, open ? 'Hide what we store' : 'What we store'),
          open ? storedBox(message) : null,
        ),
      );
    }
    return nodes;
  }
  if (message.kind === 'suggest') {
    return [renderSuggestion(message)];
  }
  return [el('li', { class: 'lay-msg from-lay' }, message.text)];
}

function storedBox(message) {
  return el(
    'dl',
    { class: 'lay-stored' },
    el('div', {}, el('dt', {}, 'Stored, and what Gemini sees'), el('dd', { class: 'mono' }, message.text)),
    el('div', {}, el('dt', {}, 'If you delete your account'), el('dd', { class: 'mono' }, resolveText(message.text, null))),
  );
}

function renderSuggestion(message) {
  const percent = (share) => `${Math.round(share * 100)}%`;
  const button = (item, action, label, className) =>
    el('button', { class: `btn btn-sm ${className}`, type: 'button', 'data-message': message.id, 'data-suggest': item.id, 'data-action': action }, label);
  const rows = message.items.map((item) => {
    const status = item.status === 'have' ? el('span', { class: 'badge badge-green' }, 'You have it')
      : item.status === 'added' ? el('span', { class: 'badge badge-green' }, icon('check'), 'Added')
        : item.status === 'skipped' ? el('span', { class: 'badge' }, 'Skipped')
          : el('span', { class: 'lay-suggest-actions' }, button(item, 'add', 'Add', 'btn-primary'), button(item, 'skip', 'Skip', 'btn-ghost'));
    if (item.kind === 'summary') {
      return el(
        'li',
        { class: `lay-suggest-item is-${item.status}` },
        el('div', { class: 'lay-suggest-top' }, el('strong', {}, 'Summary'), status),
        el('p', { class: 'lay-diff-old' }, parseInlineText(item.before)),
        el('p', { class: 'lay-diff-new' }, parseInlineText(item.after)),
      );
    }
    return el(
      'li',
      { class: `lay-suggest-item is-${item.status}` },
      el('div', { class: 'lay-suggest-top' }, el('strong', {}, item.skill), el('span', { class: 'mono lay-share' }, percent(item.share)), status),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('span', { style: `width:${percent(item.share)}` })),
      el('p', { class: 'lay-suggest-why' }, item.evidence),
    );
  });
  return el(
    'li',
    { class: 'lay-msg from-lay lay-suggest' },
    el('p', {}, message.text),
    el('ul', { class: 'lay-suggest-list' }, ...rows),
    el('p', { class: 'lay-suggest-foot' }, `Share of ${message.role} postings asking for it (sample data). Nothing changes until you press Add.`),
  );
}

function parseInlineText(markup) {
  return parseInline(markup).map((s) => s.text).join('');
}

function renderVersions() {
  const now = Date.now();
  byId('lay-version-list').replaceChildren(
    ...versionsNewestFirst(state.history).map((version) => {
      const isCurrent = version.number === state.history.current;
      return el(
        'li',
        { class: `lay-version${isCurrent ? ' is-current' : ''}${viewing === version.number ? ' is-viewing' : ''}` },
        el(
          'div',
          { class: 'lay-version-top' },
          el('span', { class: `badge${isCurrent ? ' badge-green' : ''}` }, `v${version.number}`),
          el('span', { class: 'lay-version-summary' }, version.summary),
        ),
        el(
          'div',
          { class: 'lay-version-meta' },
          el('span', {}, relativeTime(version.at, now)),
          isCurrent
            ? el('span', { class: 'lay-version-current' }, 'Current')
            : el(
                'span',
                { class: 'lay-version-actions' },
                el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-view': version.number }, icon('eye'), 'View'),
                el('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-restore': version.number }, 'Restore'),
              ),
        ),
      );
    }),
  );
}

function renderFinished() {
  const template = templateById(state.templateId);
  fillPaper(byId('final-paper'), currentResume(state.history), { editable: false, highlight: null, templateId: template.id, format: state.format });
  setText(byId('finished-sub'), `Template ${template.name}, version ${state.history.current}.`);
  setPrintPage();
  layoutPages();
  show(byId('docx-note'), false);
  show(byId('download-docx'), !template.pdfOnly);
  show(byId('pdf-only-note'), Boolean(template.pdfOnly));
}

/** Formatted text as DOM nodes (built with textContent, never parsed as HTML). */
function richNodes(markup) {
  return parseInline(markup).map((segment) => {
    let node = document.createTextNode(segment.text);
    if (segment.italic) {
      node = el('i', {}, node);
    }
    if (segment.bold) {
      node = el('b', {}, node);
    }
    if (segment.underline) {
      node = el('u', {}, node);
    }
    if (segment.color) {
      node = el('span', { style: `color: ${segment.color}` }, node); // parseInline only returns a vetted #rrggbb
    }
    if (segment.href) {
      node = el('a', { href: segment.href, target: '_blank', rel: 'noopener noreferrer' }, node);
    }
    return node;
  });
}

/** The classes that give the paper its template, font, spacing, header, page size, margins and columns. */
function paperClasses(templateId, format, editable) {
  const f = normalizeFormat(format);
  return [
    'rb-paper', `rb-tpl-${templateById(templateId).id}`, `rb-font-${f.font}`, `rb-space-${f.spacing}`,
    `rb-align-${f.align}`, `rb-page-${f.page}`, `rb-cols-${f.columns}`, f.rules ? 'rb-rules' : '', ...f.hidden.map((name) => `rb-hide-${name}`), editable ? 'is-editable' : '',
  ].filter(Boolean).join(' ');
}

/** Puts the format on a paper: its classes, and the text size in points. */
function applyPaperFormat(paper, templateId, format, editable) {
  const f = normalizeFormat(format);
  paper.className = paperClasses(templateId, format, editable);
  paper.style.setProperty('--rb-fs', String(f.fontSize));
  for (const [key, name] of [['marginTop', '--mt'], ['marginBottom', '--mb'], ['marginLeft', '--ml'], ['marginRight', '--mr']]) {
    paper.style.setProperty(name, `${f[key]}mm`);
  }
}

/** Inline editor text (with bold, italic, underline and links) as DOM nodes. */
function inlineNodes(content) {
  return (content ?? []).map((node) => {
    let out = document.createTextNode(node.text ?? '');
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') {
        out = el('strong', {}, out);
      } else if (mark.type === 'italic') {
        out = el('em', {}, out);
      } else if (mark.type === 'underline') {
        out = el('u', {}, out);
      } else if (mark.type === 'link' && safeHref(mark.attrs?.href)) {
        out = el('a', { href: safeHref(mark.attrs.href) }, out);
      }
    }
    return out;
  });
}

/** The blocks of a custom section (paragraphs, bullet lists, tables) as DOM, for the read-only page. */
function blockElements(nodes) {
  return (nodes ?? []).map((node) => {
    if (node.type === 'bulletList') {
      return el('ul', { class: 'rb-bullets' }, ...(node.content ?? []).map((item) => el('li', {}, ...(item.content ?? []).flatMap((paragraph) => inlineNodes(paragraph.content)))));
    }
    if (node.type === 'table') {
      const rows = (node.content ?? []).map((row) =>
        el('tr', {}, ...(row.content ?? []).map((cell) => el(cell.type === 'tableHeader' ? 'th' : 'td', {}, ...blockElements(cell.content)))));
      return el('table', { class: tableClass(node.attrs), style: tableStyle(node.attrs) }, el('tbody', {}, ...rows));
    }
    return el('p', {}, ...inlineNodes(node.content));
  });
}

/** Draws a resume into an <article class="rb-paper">; fields are typed into when editable. */
function fillPaper(paper, resume, { editable, highlight: changes, templateId, format }) {
  const f = normalizeFormat(format);
  applyPaperFormat(paper, templateId, format, editable);

  const field = (tag, path, value, className = '') => {
    const rich = isRichPath(path);
    const bullets = f.bullets && /^experience\.\d+\.details$/.test(path);
    const children = bullets
      ? sentences(value).map((sentence) => el('li', {}, ...richNodes(sentence)))
      : rich ? richNodes(value) : [value];
    const node = el(
      bullets ? 'ul' : tag,
      {
        class: `rb-field ${bullets ? 'rb-bullets' : ''} ${className}`.replace(/\s+/g, ' ').trim(),
        'data-path': path,
        'data-rich': rich ? '' : null,
        contenteditable: editable ? 'true' : null,
        role: editable ? 'textbox' : null,
        'aria-label': editable ? fieldLabel(path) : null,
        spellcheck: editable ? 'true' : null,
      },
      ...children,
    );
    if (changes?.fields.includes(path)) {
      node.classList.add('is-changed');
    }
    return node;
  };
  const section = (title, ...children) =>
    el('section', { class: 'rb-section', 'data-node': `${title.toLowerCase()}Section` }, el('h3', {}, title), ...children);

  const skills = resume.skills.map((skill, i) => {
    const chip = field('li', `skills.${i}`, skill);
    if (changes?.addedSkills.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      chip.classList.add('is-changed');
    }
    return chip;
  });
  if (editable) {
    skills.push(el('li', { class: 'rb-add' }, el('button', { class: 'btn btn-ghost btn-sm', id: 'rb-add-skill', type: 'button' }, icon('plus'), 'Skill')));
  }

  const header = el('header', { class: 'rb-head' }, field('h2', 'name', resume.name, 'rb-name'), field('p', 'contact', resume.contact, 'rb-contact'));
  const summary = section('Summary', field('p', 'summary', resume.summary));
  const experience = section(
    'Experience',
    ...resume.experience.map((job, i) =>
      el(
        'div',
        { class: 'rb-item' },
        el('div', { class: 'rb-item-head' }, field('p', `experience.${i}.role`, job.role, 'rb-strong'), field('p', `experience.${i}.dates`, job.dates, 'rb-dates')),
        field('p', `experience.${i}.details`, job.details),
      ),
    ),
  );
  const education = section(
    'Education',
    ...resume.education.map((school, i) =>
      el('div', { class: 'rb-item-head' }, field('p', `education.${i}.degree`, school.degree, 'rb-strong'), field('p', `education.${i}.dates`, school.dates, 'rb-dates')),
    ),
  );
  const skillsSection = section('Skills', el('ul', { class: 'rb-skills', id: editable ? 'rb-skill-list' : null }, ...skills));
  const custom = (resume.extra ?? []).map((section) => el('section', { class: 'rb-section rb-custom' }, el('h3', {}, section.title), ...blockElements(section.body)));
  const body = f.columns === 2
    ? [el('div', { class: 'rb-columns' }, el('div', { class: 'rb-col-main' }, summary, experience, ...custom), el('div', { class: 'rb-col-side' }, education, skillsSection))]
    : [summary, experience, education, skillsSection, ...custom];
  paper.replaceChildren(el('div', { class: 'rb-sheet' }, header, ...body));
}
