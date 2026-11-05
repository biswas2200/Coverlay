import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { guardText, knownValues, privacyNote, resolveText } from './privacy-guard-rules.js';
import {
  DEFAULT_ANSWERS,
  DEFAULT_FORMAT,
  WRITING_STYLE_LABELS,
  addVersion,
  answersSummary,
  applyEdit,
  applySuggestion,
  createHistory,
  currentResume,
  diffResume,
  fieldLabel,
  findVersion,
  isRichPath,
  isSavedState,
  mergeSegments,
  normalizeFormat,
  normalizeText,
  parseInline,
  relativeTime,
  restoreVersion,
  safeHref,
  sampleLayReply,
  sampleResume,
  sectionLabel,
  sentences,
  serializeSegments,
  suggestTemplates,
  templateById,
  versionsNewestFirst,
  watchHint,
} from './resume-builder-rules.js';
import { SAMPLE_LINKEDIN_PROFILE, fileProblem, foundItems, roleFrom, toResume } from './linkedin-import-rules.js';

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
const EDITING_MS = 1800;
const MAX_MESSAGES = 60;
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
let pendingField = null; // a field whose focus moved to the toolbar or the link bar, not yet committed
let linkRange = null; // the selection the link bar adds its link to
const storedOpen = new Set(); // messages whose "What we store" box is open
let linkedin = null; // the LinkedIn profile being reviewed in the start step, or null

if (requireAuth()) {
  hydrateIcons();
  renderShell('builder');
  wire();
  // resume-builder.html#linkedin (from the sign-up preview) opens the LinkedIn import.
  if (location.hash === '#linkedin') {
    state.step = 'start';
  }
  render();
  if (location.hash === '#linkedin') {
    openLinkedIn();
  }
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
  byId('from-linkedin').addEventListener('click', () => (byId('linkedin-panel').hidden ? openLinkedIn() : closeLinkedIn()));
  byId('linkedin-close').addEventListener('click', closeLinkedIn);
  byId('linkedin-sample').addEventListener('click', () => reviewLinkedIn('Sample profile (Riya Kapoor, fictional)'));
  byId('linkedin-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    const problem = fileProblem(file);
    setText(byId('linkedin-error'), problem);
    if (!problem) {
      reviewLinkedIn(`${file.name}. Preview: showing a sample profile, not this file`);
    }
    event.target.value = '';
  });
  byId('linkedin-import').addEventListener('click', importLinkedIn);
  byId('templates-back').addEventListener('click', () => goTo('start'));
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
    commitPending();
    goTo('finished');
  });

  const paper = byId('rb-paper');
  paper.addEventListener('focusout', onFieldCommit);
  paper.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && event.target.closest('.rb-field')) {
      event.preventDefault();
      event.target.blur();
    }
  });
  paper.addEventListener('focusin', () => {
    pendingField = null;
    schedulePointer();
  });
  paper.addEventListener('input', onTyping);
  paper.addEventListener('click', (event) => {
    if (event.target.closest('#rb-add-skill')) {
      addSkillChip();
    }
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement?.closest?.('#rb-paper .rb-field')) {
      schedulePointer();
      updateToolState();
    }
  });
  window.addEventListener('resize', schedulePointer);

  wireToolbar();

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
  byId('download-docx').addEventListener('click', () => show(byId('docx-note')));
  byId('back-to-editor').addEventListener('click', () => goTo('editor'));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !byId('rb-linkbar').hidden) {
      closeLinkBar();
    } else if (event.key === 'Escape' && panelOpen && !document.body.classList.contains('nav-open')) {
      closePanel();
    }
  });
}

function formAnswers() {
  const form = new FormData(byId('start-form'));
  return {
    role: normalizeText(form.get('role')).slice(0, 80),
    level: form.get('level') ?? DEFAULT_ANSWERS.level,
    style: form.get('style') ?? DEFAULT_ANSWERS.style,
    pages: Number(form.get('pages') ?? DEFAULT_ANSWERS.pages),
  };
}

function readAnswers(fromUpload) {
  state.answers = formAnswers();
  state.fromUpload = fromUpload;
  goTo('templates');
}

// ---------- LinkedIn import ----------

function openLinkedIn() {
  show(byId('linkedin-panel'));
  byId('from-linkedin').setAttribute('aria-expanded', 'true');
  byId('linkedin-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  byId('linkedin-title').setAttribute('tabindex', '-1');
  byId('linkedin-title').focus({ preventScroll: true });
}

function closeLinkedIn() {
  show(byId('linkedin-panel'), false);
  byId('from-linkedin').setAttribute('aria-expanded', 'false');
  byId('from-linkedin').focus();
}

/** Shows "What we found" for the sample profile; `source` says which file it stands for. */
function reviewLinkedIn(source) {
  linkedin = SAMPLE_LINKEDIN_PROFILE;
  setText(byId('linkedin-error'), '');
  setText(byId('linkedin-file-note'), `Reading: ${source}.`);
  byId('linkedin-found').replaceChildren(
    ...foundItems(linkedin).map((item) =>
      el('li', {},
        el('label', { class: 'rb-found-item' },
          el('input', { type: 'checkbox', value: item.id, checked: true }),
          el('span', { class: 'rb-found-group' }, item.group),
          el('span', { class: 'rb-found-label' }, item.label),
          item.meta ? el('span', { class: 'rb-found-meta' }, item.meta) : null))),
  );
  show(byId('linkedin-review'));
  announce('Profile read. Review what we found, then import.');
}

/** Version 1 (or the next version) is the imported resume; then the template step. */
function importLinkedIn() {
  const chosen = [...byId('linkedin-found').querySelectorAll('input:checked')].map((input) => input.value);
  const meta = { source: 'import', summary: 'Imported from LinkedIn', at: Date.now() };
  const resume = toResume(linkedin, chosen);
  state.history = state.history ? addVersion(state.history, resume, meta) : createHistory(resume, meta);
  const answers = formAnswers();
  state.answers = { ...answers, role: answers.role || roleFrom(linkedin) };
  state.fromUpload = false;
  linkedin = null;
  show(byId('linkedin-review'), false);
  show(byId('linkedin-panel'), false);
  byId('from-linkedin').setAttribute('aria-expanded', 'false');
  if (location.hash === '#linkedin') {
    window.history.replaceState(null, '', location.pathname + location.search);
  }
  goTo('templates');
  announce('Imported from LinkedIn as a new version. Choose a template.');
}

function chooseTemplate(id) {
  const template = templateById(id);
  const at = Date.now();
  if (!state.history) {
    const summary = state.fromUpload ? `Imported from upload, template ${template.name}` : `Started from template ${template.name}`;
    state.history = createHistory(sampleResume(), { source: state.fromUpload ? 'import' : 'template', summary, at });
  } else if (state.templateId && state.templateId !== template.id) {
    state.history = addVersion(state.history, currentResume(state.history), { source: 'template', summary: `Switched to template ${template.name}`, at });
  }
  // Classic is the LaTeX look, so it brings its typeface; leaving it goes back to sans.
  if (template.id === 'classic') {
    state.format = normalizeFormat({ ...state.format, font: 'classic' });
  } else if (state.format.font === 'classic') {
    state.format = normalizeFormat({ ...state.format, font: 'sans' });
  }
  state.templateId = template.id;
  goTo('editor');
  announce(`Template ${template.name} chosen.`);
}

// ---------- editing the resume ----------

/** What a field holds now: markup for the rich fields, plain text for the rest. */
function fieldValue(field) {
  return isRichPath(field.dataset.path) ? serializeSegments(mergeSegments(segmentsFromDom(field))) : field.textContent;
}

/** The field's content as formatted segments, reading what contenteditable produced. */
function segmentsFromDom(root) {
  const out = [];
  const walk = (node, style) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.data) {
          out.push({ text: child.data.replace(/ /g, ' '), ...style });
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const tag = child.tagName;
      if (tag === 'BR') {
        out.push({ text: ' ', ...style });
        continue;
      }
      const next = { ...style };
      const css = child.style ?? {};
      if (tag === 'B' || tag === 'STRONG' || /bold|[6-9]00/.test(css.fontWeight ?? '')) {
        next.bold = true;
      }
      if (tag === 'I' || tag === 'EM' || css.fontStyle === 'italic') {
        next.italic = true;
      }
      if (tag === 'U' || /underline/.test(css.textDecoration ?? '')) {
        next.underline = true;
      }
      if (tag === 'A') {
        const href = safeHref(child.getAttribute('href'));
        if (href) {
          next.href = href;
        }
      }
      if ((tag === 'DIV' || tag === 'P' || tag === 'LI') && out.length) {
        out.push({ text: ' ' });
      }
      walk(child, next);
    }
  };
  walk(root, {});
  return out;
}

function onFieldCommit(event) {
  const field = event.target.closest('.rb-field');
  if (!field || viewing !== null) {
    return;
  }
  // Focus moving to the toolbar or the link bar is still editing this field.
  if (event.relatedTarget?.closest?.('#rb-toolbar, #rb-linkbar')) {
    pendingField = field;
    return;
  }
  const nextPath = event.relatedTarget?.closest?.('#rb-paper .rb-field')?.dataset.path ?? null;
  if (!nextPath) {
    hidePointer();
  }
  commitField(field);
  if (nextPath) {
    focusField(nextPath);
  }
}

/** Turns a field's edit into a version; true when something changed. */
function commitField(field) {
  const before = currentResume(state.history);
  const after = applyEdit(before, field.dataset.path, fieldValue(field));
  if (after === before) {
    if (field.dataset.new !== undefined) {
      field.remove();
    }
    return false;
  }
  state.history = addVersion(state.history, after, { source: 'you', summary: `You edited ${sectionLabel(field.dataset.path)}`, at: Date.now() });
  highlight = null;
  save();
  renderEditor();
  return true;
}

/** Commits the field the toolbar took focus from, before anything re-draws the paper. */
function commitPending() {
  if (pendingField?.isConnected) {
    commitField(pendingField);
  }
  pendingField = null;
}

function addSkillChip() {
  const list = byId('rb-skill-list');
  const index = currentResume(state.history).skills.length;
  const chip = el('li', {
    class: 'rb-field', 'data-path': `skills.${index}`, 'data-new': '', contenteditable: 'true',
    role: 'textbox', 'aria-label': 'New skill', spellcheck: 'true',
  });
  list.insertBefore(chip, byId('rb-add-skill').closest('li'));
  chip.focus();
}

function focusField(path) {
  const field = byId('rb-paper').querySelector(`[data-path="${path}"]`);
  if (!field) {
    return;
  }
  field.focus();
  const range = document.createRange();
  range.selectNodeContents(field);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// ---------- the toolbar ----------

function wireToolbar() {
  const toolbar = byId('rb-toolbar');
  for (const select of toolbar.querySelectorAll('[data-format]')) {
    select.addEventListener('change', () => setFormat(select.dataset.format, select.value));
  }
  byId('fmt-bullets').addEventListener('click', () => setFormat('bullets', !state.format.bullets));
  // Pressing a tool must not take the selection out of the field being edited.
  toolbar.addEventListener('mousedown', (event) => {
    if (event.target.closest('.rb-tool')) {
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
}

function setFormat(key, value) {
  commitPending();
  state.format = normalizeFormat({ ...state.format, [key]: value });
  save();
  renderEditor();
  if (key === 'style') {
    announce(`Lay AI now writes in a ${WRITING_STYLE_LABELS[state.format.style].toLowerCase()} style.`);
  }
}

/** The rich field being edited (focused, or the one the toolbar took focus from). */
function activeRichField() {
  const focused = document.activeElement?.closest?.('#rb-paper .rb-field');
  const field = focused ?? (pendingField?.isConnected ? pendingField : null);
  return field && isRichPath(field.dataset.path) ? field : null;
}

function runCommand(command) {
  const field = activeRichField();
  if (!field) {
    announce('Click into your summary, experience or contact line first, then use the toolbar.');
    flashHint('Click into a field first, then pick bold, italic, underline or a link.');
    return;
  }
  if (command === 'link') {
    openLinkBar(field);
    return;
  }
  field.focus();
  // execCommand is deprecated but still the one way to format a contenteditable selection
  // in every browser; fieldValue() reads the result back into the markup.
  document.execCommand(command);
  updateToolState();
}

function updateToolState() {
  for (const tool of byId('rb-toolbar').querySelectorAll('.rb-tool[data-cmd]')) {
    const command = tool.dataset.cmd;
    if (command !== 'link') {
      let on = false;
      try {
        on = document.queryCommandState(command);
      } catch {
        on = false;
      }
      tool.setAttribute('aria-pressed', String(Boolean(on) && Boolean(activeRichField())));
    }
  }
}

function openLinkBar(field) {
  const selection = window.getSelection();
  linkRange = selection.rangeCount && field.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
  pendingField = field;
  setText(byId('link-error'), '');
  const input = byId('link-url');
  input.value = '';
  show(byId('rb-linkbar'));
  input.focus();
}

function closeLinkBar() {
  show(byId('rb-linkbar'), false);
  const field = pendingField;
  linkRange = null;
  if (field?.isConnected) {
    field.focus();
  }
}

function addLink(event) {
  event.preventDefault();
  const typed = byId('link-url').value.trim();
  const href = safeHref(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) ? `mailto:${typed}` : typed);
  if (!href) {
    setText(byId('link-error'), 'Use a web address like linkedin.com/in/your-name, or an email address.');
    return;
  }
  const field = pendingField;
  if (!field?.isConnected) {
    closeLinkBar();
    return;
  }
  field.focus();
  const selection = window.getSelection();
  const range = linkRange ?? (() => {
    const end = document.createRange();
    end.selectNodeContents(field);
    end.collapse(false);
    return end;
  })();
  selection.removeAllRanges();
  selection.addRange(range);
  if (range.collapsed) {
    // Nothing selected: the address itself becomes the link text.
    const link = el('a', { href }, typed.replace(/^mailto:/, ''));
    range.insertNode(document.createTextNode(' '));
    range.insertNode(link);
  } else {
    document.execCommand('createLink', false, href);
  }
  show(byId('rb-linkbar'), false);
  linkRange = null;
  announce('Link added. Click outside the field to keep it.');
}

// ---------- the Lay AI cursor (animation only, no AI call) ----------

function onTyping(event) {
  schedulePointer();
  const field = event.target.closest?.('.rb-field');
  clearTimeout(hintTimer);
  setHint(null);
  if (!field) {
    return;
  }
  // After a short pause, Lay AI "notices" what you typed and offers one tip.
  hintTimer = setTimeout(() => {
    if (document.activeElement === field) {
      setHint(watchHint(field.dataset.path, fieldValue(field)));
    }
  }, HINT_DELAY_MS);
}

function setHint(text) {
  const hint = byId('rb-pointer-hint');
  setText(hint, text ?? '');
  show(hint, Boolean(text));
}

function flashHint(text) {
  const field = byId('rb-paper').querySelector('[data-path="summary"]');
  if (!field) {
    return;
  }
  editingPath = 'summary';
  setPointerLabel('Lay AI');
  setHint(text);
  placePointer(field.getBoundingClientRect(), true);
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
    const target = byId('rb-paper').querySelector(`[data-path="${editingPath}"]`);
    if (target) {
      placePointer(target.getBoundingClientRect(), true);
      return;
    }
  }
  const field = document.activeElement?.closest?.('#rb-paper .rb-field');
  if (!field) {
    hidePointer();
    return;
  }
  let rect = null;
  const selection = window.getSelection();
  if (selection.rangeCount && field.contains(selection.anchorNode)) {
    const caret = selection.getRangeAt(0).cloneRange();
    caret.collapse(false);
    rect = caret.getClientRects()[0] ?? null;
  }
  setPointerLabel('Lay AI · watching');
  byId('rb-pointer').classList.remove('is-editing');
  placePointer(rect ?? field.getBoundingClientRect(), !rect);
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
  commitPending();
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
    const result = sampleLayReply(guard.stored, before, state.format.style);
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
      byId('lay-input').focus();
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
  byId('template-list').replaceChildren(
    ...suggestTemplates(state.answers).map((template, index) =>
      el(
        'li',
        { class: `card rb-tpl-card${index === 0 ? ' is-best' : ''}` },
        el('div', { class: `rb-mini rb-mini-${template.id}`, 'aria-hidden': 'true' }, ...Array.from({ length: 8 }, () => el('span'))),
        el(
          'div',
          { class: 'rb-tpl-title' },
          el('h3', {}, template.name),
          index === 0 ? el('span', { class: 'badge badge-green' }, 'Best match') : null,
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
  fillPaper(byId('rb-paper'), resume, { editable, highlight: editable ? highlight : null, templateId: state.templateId, format: state.format });
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
    if (segment.href) {
      node = el('a', { href: segment.href, target: '_blank', rel: 'noopener noreferrer' }, node);
    }
    return node;
  });
}

/** Draws a resume into an <article class="rb-paper">; fields are typed into when editable. */
function fillPaper(paper, resume, { editable, highlight: changes, templateId, format }) {
  const f = normalizeFormat(format);
  paper.className = [
    'rb-paper', `rb-tpl-${templateById(templateId).id}`, `rb-font-${f.font}`, `rb-size-${f.size}`,
    `rb-space-${f.spacing}`, `rb-align-${f.align}`, editable ? 'is-editable' : '',
  ].filter(Boolean).join(' ');

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
  const section = (title, ...children) => el('section', { class: 'rb-section' }, el('h3', {}, title), ...children);

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

  paper.replaceChildren(
    el('header', { class: 'rb-head' }, field('h2', 'name', resume.name, 'rb-name'), field('p', 'contact', resume.contact, 'rb-contact')),
    section('Summary', field('p', 'summary', resume.summary)),
    section(
      'Experience',
      ...resume.experience.map((job, i) =>
        el(
          'div',
          { class: 'rb-item' },
          el('div', { class: 'rb-item-head' }, field('p', `experience.${i}.role`, job.role, 'rb-strong'), field('p', `experience.${i}.dates`, job.dates, 'rb-dates')),
          field('p', `experience.${i}.details`, job.details),
        ),
      ),
    ),
    section(
      'Education',
      ...resume.education.map((school, i) =>
        el('div', { class: 'rb-item-head' }, field('p', `education.${i}.degree`, school.degree, 'rb-strong'), field('p', `education.${i}.dates`, school.dates, 'rb-dates')),
      ),
    ),
    section('Skills', el('ul', { class: 'rb-skills', id: editable ? 'rb-skill-list' : null }, ...skills)),
  );
}
