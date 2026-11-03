import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import {
  DEFAULT_ANSWERS,
  addVersion,
  answersSummary,
  applyEdit,
  createHistory,
  currentResume,
  diffResume,
  fieldLabel,
  findVersion,
  isSavedState,
  normalizeText,
  relativeTime,
  restoreVersion,
  sampleLayReply,
  sampleResume,
  sectionLabel,
  suggestTemplates,
  templateById,
  versionsNewestFirst,
} from './resume-builder-rules.js';

// The Resume Builder preview (Roadmap step A2): a clickable prototype of wireframe v2 with
// sample data. Steps: start questions -> templates -> editor -> finished. In the editor the
// resume sits on the left and is edited by typing (every committed change becomes a version);
// the floating Lay AI button opens a right-side panel with Chat and Versions. The "Lay AI"
// pointer that follows the user's caret is animation only. Nothing calls the backend or an AI:
// the replies come from sampleLayReply(), and the state lives in this browser only.

const STORE_KEY = `coverlay.resumeBuilder.${getUser()?.id ?? 'guest'}`;
const TYPING_DELAY_MS = 650;
const MAX_MESSAGES = 60;
const GREETING = "Hi! I'm Lay AI. Tell me what to change in your resume, or edit it yourself on the left.";

let state = loadState();
let panelOpen = false;
let tab = 'chat';
let highlight = null; // diffResume() of the last Lay AI change, shown in green until the next change
let viewing = null; // number of an older version shown read-only, or null
let replying = false;
let pointerFrame = 0;

if (requireAuth()) {
  hydrateIcons();
  renderShell('builder');
  wire();
  render();
}

// ---------- state ----------

function freshState() {
  return { step: 'start', answers: { ...DEFAULT_ANSWERS }, fromUpload: false, templateId: null, history: null, messages: [] };
}

function loadState() {
  const saved = readJson(STORE_KEY);
  return isSavedState(saved) ? saved : freshState();
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
  byId('finish-button').addEventListener('click', () => goTo('finished'));

  const paper = byId('rb-paper');
  paper.addEventListener('focusout', onFieldCommit);
  paper.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && event.target.closest('.rb-field')) {
      event.preventDefault();
      event.target.blur();
    }
  });
  paper.addEventListener('focusin', schedulePointer);
  paper.addEventListener('input', schedulePointer);
  paper.addEventListener('click', (event) => {
    if (event.target.closest('#rb-add-skill')) {
      addSkillChip();
    }
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement?.closest?.('#rb-paper .rb-field')) {
      schedulePointer();
    }
  });
  window.addEventListener('resize', schedulePointer);

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
    if (event.key === 'Escape' && panelOpen && !document.body.classList.contains('nav-open')) {
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
  state.templateId = template.id;
  goTo('editor');
  announce(`Template ${template.name} chosen.`);
}

function onFieldCommit(event) {
  const field = event.target.closest('.rb-field');
  if (!field || viewing !== null) {
    return;
  }
  const nextPath = event.relatedTarget?.closest?.('#rb-paper .rb-field')?.dataset.path ?? null;
  if (!nextPath) {
    hidePointer();
  }
  const before = currentResume(state.history);
  const after = applyEdit(before, field.dataset.path, field.textContent);
  if (after === before) {
    if (field.dataset.new !== undefined) {
      field.remove();
    }
    return;
  }
  state.history = addVersion(state.history, after, { source: 'you', summary: `You edited ${sectionLabel(field.dataset.path)}`, at: Date.now() });
  highlight = null;
  save();
  renderEditor();
  if (nextPath) {
    focusField(nextPath);
  }
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

// ---------- Lay AI pointer (animation only, no AI call) ----------

function schedulePointer() {
  cancelAnimationFrame(pointerFrame);
  pointerFrame = requestAnimationFrame(movePointer);
}

function movePointer() {
  const pointer = byId('rb-pointer');
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
  // Beside the caret on the same line (never over the next line of text).
  const fieldRect = field.getBoundingClientRect();
  const anchorX = rect ? rect.right : fieldRect.right;
  const anchorY = rect ? rect.top : fieldRect.top;
  const stage = byId('rb-stage').getBoundingClientRect();
  const x = Math.min(anchorX - stage.left + 8, stage.width - 90);
  const y = anchorY - stage.top - 2;
  pointer.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  pointer.classList.add('is-visible');
}

function hidePointer() {
  byId('rb-pointer').classList.remove('is-visible');
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
  const prompt = normalizeText(text);
  if (!prompt || replying || !state.history) {
    return;
  }
  viewing = null;
  replying = true;
  state.messages.push({ from: 'you', text: prompt });
  byId('lay-input').value = '';
  renderEditor();

  setTimeout(() => {
    const before = currentResume(state.history);
    const result = sampleLayReply(prompt, before);
    if (result.resume !== before) {
      state.history = addVersion(state.history, result.resume, { source: 'ai', summary: result.summary, at: Date.now() });
      highlight = diffResume(before, result.resume);
    }
    state.messages.push({ from: 'lay', text: result.reply });
    replying = false;
    save();
    renderEditor();
    if (tab === 'chat') {
      byId('lay-input').focus();
    }
  }, TYPING_DELAY_MS);
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
  fillPaper(byId('rb-paper'), resume, { editable, highlight: editable ? highlight : null, templateId: state.templateId });
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

function renderPanel() {
  byId('tab-chat').setAttribute('aria-selected', String(tab === 'chat'));
  byId('tab-versions').setAttribute('aria-selected', String(tab === 'versions'));
  show(byId('lay-chat'), tab === 'chat');
  show(byId('lay-versions'), tab === 'versions');
  setText(byId('versions-count'), String(state.history.versions.length));
  renderMessages();
  renderVersions();
}

function renderMessages() {
  const list = byId('lay-messages');
  const messages = [{ from: 'lay', text: GREETING }, ...state.messages];
  const items = messages.map((m) => el('li', { class: `lay-msg from-${m.from === 'you' ? 'you' : 'lay'}` }, m.text));
  if (replying) {
    items.push(el('li', { class: 'lay-msg from-lay is-typing' }, 'Lay AI is typing…'));
  }
  list.replaceChildren(...items);
  list.scrollTop = list.scrollHeight;
  byId('lay-send').disabled = replying;
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
  fillPaper(byId('final-paper'), currentResume(state.history), { editable: false, highlight: null, templateId: template.id });
  setText(byId('finished-sub'), `Template ${template.name}, version ${state.history.current}.`);
  show(byId('docx-note'), false);
}

/** Draws a resume into an <article class="rb-paper">; fields are typed into when editable. */
function fillPaper(paper, resume, { editable, highlight: changes, templateId }) {
  paper.className = `rb-paper rb-tpl-${templateById(templateId).id}${editable ? ' is-editable' : ''}`;

  const field = (tag, path, text, className = '') => {
    const node = el(
      tag,
      {
        class: `rb-field ${className}`.trim(),
        'data-path': path,
        contenteditable: editable ? 'true' : null,
        role: editable ? 'textbox' : null,
        'aria-label': editable ? fieldLabel(path) : null,
        spellcheck: editable ? 'true' : null,
      },
      text,
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
