import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { guardText, knownValues, resolveText } from './privacy-guard-rules.js';
import { currentResume, isSavedState, safeHref, sampleResume, templateById } from './resume-builder-rules.js';
import { downloadBytes } from '../core/download.js';
import { DOCX_MIME } from './docx-writer.js';
import { buildLetterDocx, letterDocxName } from './letter-docx.js';
import { createLetterEditor } from './letter-editor.js';
import { blocksPlain, blocksText, blocksToDoc, docToBlocks } from './letter-doc.js';
import { SAMPLE_GMAIL, attachmentName, buildMailRequest, mailSummary } from './mail-rules.js';
import { connectionsKey, isConnected, normalizeConnections, setConnected } from './connections-rules.js';
import {
  LETTER_TYPES,
  SAMPLE_JOBS,
  addSuggestion,
  addSuggestionToBlocks,
  draftLetter,
  jobById,
  lengthNote,
  letterSuggestions,
  skillFit,
  templatesFor,
  toBlocks,
  wordCount,
} from './letters-rules.js';

// Letters & emails preview: pick a type, a template and a job; the draft is built with placeholders (what
// Gemini would see) and filled in here from the vault. The draft is the editing surface: click anywhere in it
// and type, with undo and redo, bold, italic, underline and links, new paragraphs and line breaks; an edit goes
// back through the guard before it is kept (names and contacts become placeholders again). Suggestions add one
// sentence each, and only when the user adds them. A cover letter downloads as PDF or Word. A cold email is
// not a file: it goes into the person's Gmail with the resume and the cover letter attached, as a draft or
// sent. The edited text is kept per type, template and job until the person starts from the template again.

const USER_ID = getUser()?.id ?? 'guest';
const KEY = `coverlay.preview.letters.${USER_ID}`;
const CONNECTIONS_KEY = connectionsKey(USER_ID); // shared with Settings > Connected apps
const SAVE_DELAY = 350;
const saved = readJson(`coverlay.resumeBuilder.${USER_ID}`);
const resume = builderResume();
/** Classic is typeset like LaTeX, so its resume is PDF only. */
const resumeIsPdfOnly = Boolean(templateById(saved?.templateId)?.pdfOnly);

let state = load();
let pendingSend = null; // a checked request that is waiting for the second confirmation (declared before the first render)
let editor = null; // the editor on the draft, and which draft it holds
let editorKey = '';
let editorDoc = null;
let saveTimer = null; // set while an edit has not been kept yet
let resetArmed = false;

/** The resume from the Builder preview, so edits made there show up here. */
function builderResume() {
  return isSavedState(saved) && saved.history ? currentResume(saved.history) : sampleResume();
}

function fresh() {
  return {
    type: 'cover', templateId: 'standard', coverTemplateId: 'standard', jobId: SAMPLE_JOBS[0].id, recipient: '', decided: {}, docs: {}, gemini: false,
    mail: { to: '', attachResume: true, resumeFormat: 'pdf', attachCover: true, coverFormat: 'pdf' },
  };
}

function load() {
  const found = readJson(KEY);
  const loaded = found && typeof found === 'object' && LETTER_TYPES.some((t) => t.id === found.type)
    ? { ...fresh(), ...found, docs: found.docs && typeof found.docs === 'object' ? found.docs : {}, mail: { ...fresh().mail, ...(found.mail ?? {}) } }
    : fresh();
  // Before the Settings page had Connected apps, this page kept "connected" itself: move it to the shared state.
  if (loaded.mail.connected) {
    setGmail(true);
  }
  delete loaded.mail.connected;
  return loaded;
}

/** Whether Gmail is connected: the one state Settings and this page share, read each time so a change in the other shows here. */
function gmailConnected() {
  return isConnected(normalizeConnections(readJson(CONNECTIONS_KEY)), 'gmail');
}

function setGmail(on) {
  writeJson(CONNECTIONS_KEY, setConnected(normalizeConnections(readJson(CONNECTIONS_KEY)), 'gmail', on));
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

/** Text with the placeholders filled in from the vault, as the person sees it. */
const fillText = (text) => resolveText(text ?? '', vault(), (key) => `{${key}}`);
/** Text the person typed, with their name, college and contacts turned back into placeholders. */
const guardPiece = (text) => guardText(text, vault()).stored;

// ---------- the draft: a template, then the person's own edits ----------

/** The template that is open for a type: the one chosen now, or the cover letter template last chosen. */
const templateOf = (type) => (type === state.type ? state.templateId : type === 'cover' ? state.coverTemplateId : templatesFor(type)[0].id);
const docKey = (type = state.type) => `${type}.${templateOf(type)}.${state.jobId}`;
const hasGreeting = (type) => type === 'cover';

/** The template's draft with the suggestions added so far: `{ subject, blocks }` in placeholder form. */
function templateDoc(type) {
  const job = jobById(state.jobId);
  let letter = draftLetter({ type, templateId: templateOf(type), resume, job });
  for (const item of letterSuggestions({ type, resume, job })) {
    if (state.decided[`${type}.${item.id}`] === 'added') {
      letter = addSuggestion(letter, item);
    }
  }
  return { subject: letter.subject, blocks: toBlocks(letter) };
}

/** What the person is working on: their edited text if they have edited it, else the template's draft. */
function letterDoc(type = state.type) {
  return state.docs[docKey(type)] ?? templateDoc(type);
}

/** A draft with the real values filled in, as a file or an email carries it. Keeps any pending edit first. */
function filled(type = state.type) {
  flush();
  const doc = letterDoc(type);
  return { subject: fillText(doc.subject), blocks: doc.blocks.map(fillText) };
}

// ---------- the editor ----------

/** Puts the editor on the draft that is open, unless it already holds it (or `force`). */
function mountEditor(force = false) {
  const key = docKey();
  if (editor && editorKey === key && !force) {
    return;
  }
  editor?.destroy();
  editorDoc = letterDoc();
  editorKey = key;
  const label = state.type === 'email' ? 'Your cold email' : 'Your cover letter';
  editor = createLetterEditor(byId('letter-editor'), {
    doc: blocksToDoc(editorDoc.blocks, fillText),
    label,
    onChange: scheduleSave,
    onSelection: updateToolState,
    onBlur: (to) => {
      if (!to?.closest?.('#letter-toolbar, #letter-linkbar')) {
        flush();
      }
    },
  });
  updateToolState();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY);
  setText(byId('letter-saved'), 'Editing…');
  updateLength();
}

/** Keeps the edit that is waiting: the text goes back through the guard, then is stored for this draft. */
function flush() {
  if (!saveTimer || !editor) {
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = null;
  const isEmail = editorKey.startsWith('email.');
  state.docs[editorKey] = {
    subject: isEmail ? guardPiece(byId('letter-subject').value.replace(/\s+/g, ' ').trim().slice(0, 200)) : editorDoc.subject,
    blocks: docToBlocks(editor.getJSON(), guardPiece),
  };
  save();
  setText(byId('letter-saved'), 'All changes kept');
}

function updateLength() {
  const text = editor ? blocksPlain(docToBlocks(editor.getJSON())) : '';
  setText(byId('length-note'), lengthNote(state.type, wordCount(text)));
}

function updateToolState() {
  if (!editor) {
    return;
  }
  for (const tool of byId('letter-toolbar').querySelectorAll('[data-letter-cmd]')) {
    const command = tool.dataset.letterCmd;
    if (command === 'undo' || command === 'redo') {
      tool.disabled = !(command === 'undo' ? editor.canUndo() : editor.canRedo());
    } else if (command !== 'link') {
      tool.setAttribute('aria-pressed', String(editor.isActive(command)));
    }
  }
}

function openLinkBar() {
  setText(byId('letter-link-error'), '');
  byId('letter-link-url').value = '';
  show(byId('letter-linkbar'));
  byId('letter-link-url').focus();
}

function closeLinkBar() {
  show(byId('letter-linkbar'), false);
  editor?.focus();
}

function addLink(event) {
  event.preventDefault();
  const typed = byId('letter-link-url').value.trim();
  const href = safeHref(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) ? `mailto:${typed}` : typed);
  if (!href) {
    setText(byId('letter-link-error'), 'Use a web address like linkedin.com/in/your-name, or an email address.');
    return;
  }
  show(byId('letter-linkbar'), false);
  editor.setLink(href, typed.replace(/^mailto:/, ''));
  announce('Link added.');
}

function disarmReset() {
  resetArmed = false;
  setText(byId('letter-reset'), 'Start over');
}

// ---------- the page ----------

function wire() {
  byId('type-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (button) {
      flush();
      state.type = button.dataset.type;
      state.templateId = state.type === 'cover' ? state.coverTemplateId : templatesFor(state.type)[0].id;
      disarmReset();
      save();
      render();
    }
  });
  byId('template-list').addEventListener('change', (event) => {
    if (event.target.name === 'template') {
      flush();
      state.templateId = event.target.value;
      if (state.type === 'cover') {
        state.coverTemplateId = state.templateId;
      }
      disarmReset();
      save();
      render();
    }
  });
  byId('job-select').addEventListener('change', (event) => {
    flush();
    state.jobId = event.target.value;
    state.decided = {};
    disarmReset();
    save();
    render();
  });
  byId('recipient').addEventListener('input', (event) => {
    flush();
    state.recipient = event.target.value.slice(0, 40);
    save();
    mountEditor(true);
    renderSubject();
    renderDoc();
  });
  byId('letter-subject').addEventListener('input', scheduleSave);
  byId('toggle-gemini').addEventListener('click', () => {
    flush();
    state.gemini = !state.gemini;
    save();
    renderDoc();
  });
  byId('copy-draft').addEventListener('click', async () => {
    const made = filled();
    const text = blocksText(made.blocks, state.type === 'email' ? made.subject : '');
    try {
      await navigator.clipboard.writeText(text);
      announce('Copied.');
      setText(byId('copy-draft'), 'Copied');
      setTimeout(() => setText(byId('copy-draft'), 'Copy'), 1500);
    } catch {
      announce('Copy is blocked in this browser: select the text instead.');
    }
  });
  byId('print-draft').addEventListener('click', () => {
    flush();
    window.print();
  });
  byId('docx-draft').addEventListener('click', () => {
    const job = jobById(state.jobId);
    downloadBytes(buildLetterDocx({ blocks: filled('cover').blocks }, { title: `Cover letter for ${job.company}` }), letterDocxName(resume.name, job.company), DOCX_MIME);
    announce('Your Word file is downloading.');
  });

  // The toolbar acts on the draft without taking the caret out of it.
  const toolbar = byId('letter-toolbar');
  toolbar.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) {
      event.preventDefault();
    }
  });
  toolbar.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-letter-cmd]');
    if (!tool || !editor) {
      return;
    }
    const command = tool.dataset.letterCmd;
    if (command === 'undo' || command === 'redo') {
      editor[command]();
    } else if (command === 'link') {
      openLinkBar();
    } else {
      editor.toggle(command);
    }
    updateToolState();
  });
  byId('letter-linkbar').addEventListener('submit', addLink);
  byId('letter-link-cancel').addEventListener('click', closeLinkBar);
  byId('letter-reset').addEventListener('click', () => {
    if (!state.docs[docKey()]) {
      announce('This draft is still the template.');
      return;
    }
    if (!resetArmed) {
      resetArmed = true;
      setText(byId('letter-reset'), 'Discard edits?');
      setTimeout(disarmReset, 4000);
      return;
    }
    flush();
    disarmReset();
    delete state.docs[docKey()];
    for (const name of Object.keys(state.decided)) {
      if (name.startsWith(`${state.type}.`)) {
        delete state.decided[name];
      }
    }
    save();
    mountEditor(true); // the key is the same, so the editor must be told to take the template's text
    render();
    announce('Back to the template.');
  });
  byId('letter-suggestions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-decide]');
    if (!button) {
      return;
    }
    flush();
    const added = button.dataset.action === 'add';
    state.decided[`${state.type}.${button.dataset.decide}`] = added ? 'added' : 'skipped';
    // Edited text is its own copy: the sentence goes into that copy. Untouched, the template picks it up itself.
    const kept = state.docs[docKey()];
    if (added && kept) {
      const item = letterSuggestions({ type: state.type, resume, job: jobById(state.jobId) }).find((i) => i.id === button.dataset.decide);
      state.docs[docKey()] = { ...kept, blocks: addSuggestionToBlocks(kept.blocks, item, hasGreeting(state.type)) };
    }
    save();
    mountEditor(true);
    renderSuggestions();
    updateLength();
    announce(added ? 'Added to the draft.' : 'Skipped.');
  });
  wireMail();
}

function render() {
  renderControls();
  mountEditor();
  renderSubject();
  renderDoc();
  renderSuggestions();
  renderMail();
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
  // A cover letter is a document: PDF or Word. A cold email is not a file; it goes out through Gmail (below).
  show(byId('print-draft'), state.type === 'cover');
  show(byId('docx-draft'), state.type === 'cover');
  const type = LETTER_TYPES.find((t) => t.id === state.type);
  setText(byId('letter-cost'), `Writing this costs ${type.credits} credits with the real AI. Free in the preview.`);
  disarmReset();
}

/** The subject of a cold email is its own box above the draft, also edited in place. */
function renderSubject() {
  show(byId('subject-field'), state.type === 'email');
  if (state.type === 'email') {
    byId('letter-subject').value = fillText(letterDoc().subject);
  }
}

function renderDoc() {
  const gemini = state.gemini;
  byId('toggle-gemini').setAttribute('aria-pressed', String(gemini));
  show(byId('gemini-note'), gemini);
  show(byId('letter-toolbar'), !gemini);
  show(byId('edit-hint'), !gemini);
  show(byId('letter-linkbar'), false);
  show(byId('letter-editor'), !gemini);
  show(byId('subject-field'), !gemini && state.type === 'email');
  const view = byId('letter-gemini');
  show(view, gemini);
  if (gemini) {
    // What Gemini gets and writes: the stored text, placeholders marked, no formatting and nothing to edit.
    const doc = letterDoc();
    const parts = state.type === 'email' ? [`Subject: ${doc.subject}`] : [];
    view.replaceChildren(...[...parts, ...doc.blocks.map((block) => blocksPlain([block]))]
      .map((text) => el('p', { class: 'letters-p preserve-lines' }, ...placeholderNodes(text))));
  }
  updateLength();
  setText(byId('letter-saved'), state.docs[docKey()] ? 'All changes kept' : '');
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
      const decided = state.decided[`${state.type}.${item.id}`];
      const badge = decided === 'added' ? el('span', { class: 'badge badge-green' }, icon('check'), 'Added')
        : decided === 'skipped' ? el('span', { class: 'badge' }, 'Skipped') : null;
      const actions = decided ? null : el('span', { class: 'lay-suggest-actions' },
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', 'data-decide': item.id, 'data-action': 'add' }, 'Add'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-decide': item.id, 'data-action': 'skip' }, 'Skip'));
      return el('li', { class: `lay-suggest-item is-${decided ?? 'open'}` },
        el('div', { class: 'lay-suggest-top' }, el('strong', {}, item.label), badge),
        el('p', { class: 'lay-diff-new' }, `+ ${item.text}`),
        actions);
    }),
  );
}

// ---------- sending the cold email from Gmail (sample: the preview sends and saves nothing) ----------

/** The email, the resume and the cover letter as one request: `{ ok, request }` or `{ ok: false, error }`. */
function mailRequest(action) {
  const letter = filled('email');
  const mail = state.mail;
  const attachments = [];
  if (mail.attachResume) {
    attachments.push({ kind: 'resume', format: resumeIsPdfOnly ? 'pdf' : mail.resumeFormat });
  }
  if (mail.attachCover) {
    attachments.push({ kind: 'cover', format: mail.coverFormat });
  }
  return buildMailRequest({
    provider: 'gmail', action, to: mail.to, subject: letter.subject, body: blocksPlain(letter.blocks), bodyMarkup: letter.blocks.join('\n\n'), attachments,
  }, resume.name);
}

function wireMail() {
  const changed = () => {
    pendingSend = null;
    save();
    renderMail();
  };
  byId('mail-connect-btn').addEventListener('click', () => {
    setGmail(true);
    setText(byId('mail-result'), '');
    changed();
    announce(`Gmail connected as ${SAMPLE_GMAIL}.`);
  });
  byId('mail-disconnect').addEventListener('click', () => {
    setGmail(false);
    setText(byId('mail-result'), '');
    changed();
    announce('Gmail disconnected.');
  });
  byId('mail-to').addEventListener('input', (event) => {
    state.mail.to = event.target.value.slice(0, 254);
    pendingSend = null;
    save();
    show(byId('mail-confirm'), false);
  });
  const attach = [['attach-resume', 'attachResume', 'checked'], ['attach-resume-format', 'resumeFormat', 'value'], ['attach-cover', 'attachCover', 'checked'], ['attach-cover-format', 'coverFormat', 'value']];
  for (const [id, key, prop] of attach) {
    byId(id).addEventListener('change', (event) => {
      state.mail[key] = event.target[prop];
      changed();
    });
  }
  byId('mail-draft').addEventListener('click', () => {
    const made = mailRequest('draft');
    if (!made.ok) {
      setText(byId('mail-result'), made.error);
      return;
    }
    pendingSend = null;
    show(byId('mail-confirm'), false);
    setText(byId('mail-result'), `${mailSummary(made.request, SAMPLE_GMAIL, { done: true })} Subject: ${made.request.subject} (Sample: the preview saves nothing in Gmail.)`);
    announce('Draft saved.');
  });
  byId('mail-send').addEventListener('click', () => {
    const made = mailRequest('send');
    if (!made.ok) {
      setText(byId('mail-result'), made.error);
      show(byId('mail-confirm'), false);
      return;
    }
    pendingSend = made.request;
    setText(byId('mail-result'), '');
    setText(byId('mail-confirm-text'), `${mailSummary(made.request, SAMPLE_GMAIL)} Subject: ${made.request.subject}. Coverlay sends it when you press Send now, and nothing sooner.`);
    show(byId('mail-confirm'), true);
    byId('mail-send-cancel').focus(); // not on "Send now": Enter must not send by accident
  });
  byId('mail-send-now').addEventListener('click', () => {
    if (!pendingSend) {
      return;
    }
    setText(byId('mail-result'), `${mailSummary(pendingSend, SAMPLE_GMAIL, { done: true })} Subject: ${pendingSend.subject} (Sample: the preview sends nothing.)`);
    announce('Email sent.');
    pendingSend = null;
    show(byId('mail-confirm'), false);
  });
  byId('mail-send-cancel').addEventListener('click', () => {
    pendingSend = null;
    show(byId('mail-confirm'), false);
    byId('mail-send').focus();
  });
}

function renderMail() {
  const isEmail = state.type === 'email';
  show(byId('mail-panel'), isEmail);
  if (!isEmail) {
    return;
  }
  const mail = state.mail;
  const connected = gmailConnected();
  show(byId('mail-connect'), !connected);
  show(byId('mail-ready'), connected);
  setText(byId('mail-account'), `Gmail: ${SAMPLE_GMAIL}`);
  byId('mail-to').value = mail.to;
  byId('attach-resume').checked = mail.attachResume;
  byId('attach-resume-format').value = resumeIsPdfOnly ? 'pdf' : mail.resumeFormat;
  byId('attach-resume-format').querySelector('[value="docx"]').disabled = resumeIsPdfOnly;
  byId('attach-cover').checked = mail.attachCover;
  byId('attach-cover-format').value = mail.coverFormat;
  const job = jobById(state.jobId);
  setText(byId('attach-cover-label'), `Cover letter for ${job.company}`);
  const names = [
    mail.attachResume ? attachmentName('resume', resumeIsPdfOnly ? 'pdf' : mail.resumeFormat, resume.name) : null,
    mail.attachCover ? attachmentName('cover', mail.coverFormat, resume.name) : null,
  ].filter(Boolean);
  setText(byId('attach-note'), `${names.length ? `Attached: ${names.join(', ')}.` : 'No attachments.'}${resumeIsPdfOnly ? ' Your Classic resume is PDF only.' : ''} Both are made from your current resume and your cover letter.`);
  show(byId('mail-confirm'), pendingSend !== null);
}

// Start up last: every constant and function above exists by now (a `const` is not usable before its line runs).
if (requireAuth()) {
  hydrateIcons();
  renderShell('letters');
  wire();
  render();
}
