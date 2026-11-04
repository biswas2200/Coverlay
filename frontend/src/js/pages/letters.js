import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { guardText, knownValues, resolveText } from './privacy-guard-rules.js';
import { currentResume, isSavedState, sampleResume } from './resume-builder-rules.js';
import {
  LETTER_TYPES,
  SAMPLE_JOBS,
  addSuggestion,
  draftLetter,
  draftText,
  jobById,
  lengthNote,
  letterSuggestions,
  skillFit,
  templatesFor,
  wordCount,
} from './letters-rules.js';

// Letters & emails preview: pick a type, a template and a job; the draft is built with
// placeholders (what Gemini would see) and filled in here from the vault. Paragraphs can be
// edited; an edit goes back through the guard before it is kept. Suggestions add one sentence
// each, and only when the user adds them.

const USER_ID = getUser()?.id ?? 'guest';
const KEY = `coverlay.preview.letters.${USER_ID}`;
const resume = builderResume();

let state = load();

if (requireAuth()) {
  hydrateIcons();
  renderShell('letters');
  wire();
  render();
}

/** The resume from the Resume Builder preview, so edits made there show up here. */
function builderResume() {
  const saved = readJson(`coverlay.resumeBuilder.${USER_ID}`);
  return isSavedState(saved) && saved.history ? currentResume(saved.history) : sampleResume();
}

function fresh() {
  return { type: 'cover', templateId: 'standard', jobId: SAMPLE_JOBS[0].id, recipient: '', decided: {}, edits: {}, gemini: false };
}

function load() {
  const saved = readJson(KEY);
  return saved && typeof saved === 'object' && LETTER_TYPES.some((t) => t.id === saved.type) ? { ...fresh(), ...saved } : fresh();
}

function save() {
  writeJson(KEY, state);
}

function announce(text) {
  setText(byId('page-status'), text);
}

function vault() {
  return { ...knownValues(resume), 'other.person_1': state.recipient.trim() || 'there' };
}

/** The draft in placeholder form: template, then added suggestions, then the user's edits. */
function draft() {
  const job = jobById(state.jobId);
  let letter = draftLetter({ type: state.type, templateId: state.templateId, resume, job });
  for (const item of letterSuggestions({ type: state.type, resume, job })) {
    if (state.decided[item.id] === 'added') {
      letter = addSuggestion(letter, item);
    }
  }
  const paragraphs = letter.paragraphs.map((p, i) => state.edits[`${state.type}.${state.templateId}.${i}`] ?? p);
  return { ...letter, paragraphs };
}

function wire() {
  byId('type-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (button) {
      state.type = button.dataset.type;
      state.templateId = templatesFor(state.type)[0].id;
      state.decided = {};
      save();
      render();
    }
  });
  byId('template-list').addEventListener('change', (event) => {
    if (event.target.name === 'template') {
      state.templateId = event.target.value;
      save();
      render();
    }
  });
  byId('job-select').addEventListener('change', (event) => {
    state.jobId = event.target.value;
    state.decided = {};
    save();
    render();
  });
  byId('recipient').addEventListener('input', (event) => {
    state.recipient = event.target.value.slice(0, 40);
    save();
    renderDoc();
  });
  byId('toggle-gemini').addEventListener('click', () => {
    state.gemini = !state.gemini;
    save();
    renderDoc();
  });
  byId('copy-draft').addEventListener('click', async () => {
    const text = resolveText(draftText(draft(), { withSubject: state.type === 'email' }), vault(), (key) => `{${key}}`);
    try {
      await navigator.clipboard.writeText(text);
      announce('Copied.');
      setText(byId('copy-draft'), 'Copied');
      setTimeout(() => setText(byId('copy-draft'), 'Copy'), 1500);
    } catch {
      announce('Copy is blocked in this browser: select the text instead.');
    }
  });
  byId('print-draft').addEventListener('click', () => window.print());
  const paper = byId('letter-paper');
  paper.addEventListener('focusout', (event) => {
    const paragraph = event.target.closest('[data-paragraph]');
    if (!paragraph || state.gemini) {
      return;
    }
    // Your edit goes back through the guard: names and contacts become placeholders again.
    const stored = guardText(paragraph.textContent.replace(/\s+/g, ' ').trim(), vault()).stored;
    const key = `${state.type}.${state.templateId}.${paragraph.dataset.paragraph}`;
    if (stored !== draft().paragraphs[Number(paragraph.dataset.paragraph)]) {
      state.edits[key] = stored;
      save();
      renderDoc();
    }
  });
  byId('letter-suggestions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-decide]');
    if (button) {
      state.decided[button.dataset.decide] = button.dataset.action === 'add' ? 'added' : 'skipped';
      save();
      render();
      announce(button.dataset.action === 'add' ? 'Added to the draft.' : 'Skipped.');
    }
  });
}

function render() {
  renderControls();
  renderDoc();
  renderSuggestions();
}

function renderControls() {
  byId('type-tabs').replaceChildren(
    ...LETTER_TYPES.map((type) =>
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(type.id === state.type), 'data-type': type.id }, type.label)),
  );
  byId('template-list').replaceChildren(
    ...templatesFor(state.type).map((template) =>
      el('li', {},
        el('label', { class: 'letters-template' },
          el('input', { type: 'radio', name: 'template', value: template.id, checked: template.id === state.templateId }),
          el('span', {}, el('strong', {}, template.label), el('span', { class: 'field-hint' }, template.blurb)))),
    ),
  );
  const select = byId('job-select');
  if (!select.children.length) {
    select.replaceChildren(...SAMPLE_JOBS.map((job) => el('option', { value: job.id }, `${job.title} · ${job.company}`)));
  }
  select.value = state.jobId;
  const fit = skillFit(resume, jobById(state.jobId));
  setText(byId('job-fit'), `You have ${fit.matched.length} of the ${fit.matched.length + fit.missing.length} skills it asks for${fit.missing.length ? ` (not yet: ${fit.missing.join(', ')})` : ''}.`);
  byId('recipient').value = state.recipient;
  show(byId('recipient-field'), state.type === 'email');
  const type = LETTER_TYPES.find((t) => t.id === state.type);
  setText(byId('letter-cost'), `Writing this costs ${type.credits} credits with the real AI. Free in the preview.`);
}

function renderDoc() {
  const letter = draft();
  const values = vault();
  const gemini = state.gemini;
  byId('toggle-gemini').setAttribute('aria-pressed', String(gemini));
  show(byId('gemini-note'), gemini);
  const display = (text) => (gemini ? placeholderNodes(text) : [resolveText(text, values, (key) => `{${key}}`)]);
  const paper = byId('letter-paper');
  paper.classList.toggle('is-gemini', gemini);
  const nodes = [];
  if (state.type === 'email') {
    nodes.push(el('p', { class: 'letters-subject' }, el('span', { class: 'section-label' }, 'Subject '), ...display(letter.subject)));
  }
  letter.paragraphs.forEach((paragraph, i) => {
    nodes.push(el('p', { 'data-paragraph': String(i), contenteditable: gemini ? null : 'true', spellcheck: 'true', class: 'letters-p' }, ...display(paragraph)));
  });
  nodes.push(el('p', { class: 'letters-signoff preserve-lines' }, ...display(letter.signOff)));
  paper.replaceChildren(...nodes);
  const text = resolveText(draftText(letter, { withSubject: false }), values);
  setText(byId('length-note'), lengthNote(state.type, wordCount(text)));
}

/** Placeholder text with each {placeholder} marked, for "What Gemini sees". */
function placeholderNodes(text) {
  return String(text).split(/(\{[a-z_.0-9]+\})/g).filter(Boolean)
    .map((part) => (/^\{[a-z_.0-9]+\}$/.test(part) ? el('mark', { class: 'letters-ph mono' }, part) : document.createTextNode(part)));
}

function renderSuggestions() {
  const items = letterSuggestions({ type: state.type, resume, job: jobById(state.jobId) });
  const list = byId('letter-suggestions');
  if (!items.length) {
    list.replaceChildren(el('li', { class: 'muted' }, 'No suggestions for this draft.'));
    return;
  }
  list.replaceChildren(
    ...items.map((item) => {
      const decided = state.decided[item.id];
      const status = decided === 'added' ? el('span', { class: 'badge badge-green' }, icon('check'), 'Added')
        : decided === 'skipped' ? el('span', { class: 'badge' }, 'Skipped')
          : el('span', { class: 'lay-suggest-actions' },
            el('button', { class: 'btn btn-primary btn-sm', type: 'button', 'data-decide': item.id, 'data-action': 'add' }, 'Add'),
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-decide': item.id, 'data-action': 'skip' }, 'Skip'));
      return el('li', { class: `lay-suggest-item is-${decided ?? 'open'}` },
        el('div', { class: 'lay-suggest-top' }, el('strong', {}, item.label), status),
        el('p', { class: 'lay-diff-new' }, `+ ${item.text}`));
    }),
  );
}
