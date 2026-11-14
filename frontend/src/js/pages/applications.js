import { byId, cloneTemplate, el, field, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons } from '../components/icons.js';
import { setLayPage } from '../components/lay-global.js';
import { renderShell } from '../components/shell.js';
import {
  PORTALS,
  STATUSES,
  NOTES_MAX,
  addApplication,
  boardColumns,
  dayLabel,
  dueReminders,
  isApplicationList,
  layApplicationsReply,
  moveTo,
  needsCheckIn,
  nextStatus,
  noteWords,
  notesOf,
  notesPlaceholder,
  outcomeRecord,
  sampleApplications,
  setNotes,
  snoozeCheckIn,
  statusLabel,
  validateApplication,
} from './applications-rules.js';

// The applications board preview: five columns, cards that drag between them (or a move control
// and button on each card, for the keyboard and touch), the reminders due soon, the "Did you
// hear back?" check-in, what the outcome insight keeps (no names), and Lay AI answering from the board.

const KEY = `coverlay.preview.applications.${getUser()?.id ?? 'guest'}`;
// The sample analytics id and resume features the outcome record shows (no personal data).
const SUBJECT = { subjectId: '7f3a…c21e', experienceBand: '1-3 yrs', skills: ['Java', 'Spring Boot', 'SQL'] };

let apps = load();
const NOTES_DELAY_MS = 500;
const notesOpen = new Set(); // cards whose notes are open, kept across the redraw a move causes
let notesTimer = 0;

if (requireAuth()) {
  hydrateIcons();
  renderShell('applications');
  wire();
  wireDrag();
  wireLay();
  render();
}

function load() {
  const saved = readJson(KEY);
  return isApplicationList(saved) ? saved : sampleApplications(Date.now());
}

function save() {
  writeJson(KEY, apps);
}

function announce(text) {
  setText(byId('page-status'), text);
}

function wire() {
  byId('add-portal').replaceChildren(...PORTALS.map((portal) => el('option', { value: portal }, portal)));
  byId('add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = { company: byId('add-company').value, role: byId('add-role').value, portal: byId('add-portal').value };
    const error = validateApplication(input);
    setText(byId('add-error'), error);
    if (error) {
      return;
    }
    apps = addApplication(apps, input, Date.now(), 4);
    save();
    byId('add-form').reset();
    byId('add-box').open = false;
    announce(`Added ${input.role} at ${input.company} to Preparing. Reminder set for 3 days.`);
    render();
  });
  byId('board').addEventListener('change', (event) => {
    const select = event.target.closest('[data-move]');
    if (select && select.value) {
      move(select.dataset.move, select.value);
    }
  });
  byId('board').addEventListener('click', (event) => {
    const next = event.target.closest('[data-next]');
    const answer = event.target.closest('[data-answer]');
    if (next) {
      move(next.dataset.next, next.dataset.to);
    } else if (answer) {
      const id = answer.closest('[data-app]').dataset.app;
      if (answer.dataset.answer === 'LATER') {
        apps = snoozeCheckIn(apps, id, Date.now());
        save();
        announce("We'll ask again in a week.");
        render();
      } else {
        move(id, answer.dataset.answer);
      }
    }
  });
  // Notes are kept as the person types (after a short pause, and at once when they leave the box). The board is
  // not redrawn for a note, so the box keeps its caret. Inside a card that can be dragged, text cannot be selected
  // with the mouse, so the card stops being draggable while its note has the focus.
  const board = byId('board');
  board.addEventListener('input', (event) => {
    const box = event.target.closest?.('[data-notes]');
    if (box) {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => keepNotes(box), NOTES_DELAY_MS);
    }
  });
  board.addEventListener('focusin', (event) => {
    if (event.target.closest?.('[data-notes]')) {
      event.target.closest('.apps-card').draggable = false;
    }
  });
  board.addEventListener('focusout', (event) => {
    const box = event.target.closest?.('[data-notes]');
    if (box) {
      clearTimeout(notesTimer);
      keepNotes(box, { announceIt: true });
      box.closest('.apps-card').draggable = true;
    }
  });
  board.addEventListener('toggle', (event) => {
    const details = event.target;
    if (details.classList?.contains('apps-notes')) {
      const id = details.closest('.apps-card')?.dataset.app;
      if (details.open) {
        notesOpen.add(id);
        details.querySelector('textarea').focus({ preventScroll: true });
      } else {
        notesOpen.delete(id);
      }
    }
  }, true);
  byId('reset-apps').addEventListener('click', () => {
    apps = sampleApplications(Date.now());
    save();
    render();
  });
}

/** Keeps what is in a note box and updates the small count on its button. */
function keepNotes(box, { announceIt = false } = {}) {
  const before = apps;
  apps = setNotes(apps, box.dataset.notes, box.value, Date.now());
  const app = apps.find((a) => a.id === box.dataset.notes);
  if (!app) {
    return;
  }
  paintNotesSummary(box.closest('.apps-card'), notesOf(app));
  if (apps !== before) {
    save();
    if (announceIt) {
      announce(`Notes saved for ${app.role} at ${app.company}.`);
    }
  }
}

/** "+ Notes" while a card has none, "Notes" and the word count once it has. */
function paintNotesSummary(card, notes) {
  const words = noteWords(notes);
  setText(field(card, 'notes-label'), words ? 'Notes' : '+ Notes');
  const count = field(card, 'notes-count');
  setText(count, words ? `${words} ${words === 1 ? 'word' : 'words'}` : '');
  show(count, words > 0);
}

function move(id, status) {
  apps = moveTo(apps, id, status, Date.now());
  save();
  const app = apps.find((a) => a.id === id);
  announce(`${app.role} at ${app.company} moved to ${statusLabel(status)}.`);
  render();
  focusCard(id);
}

/** Brings a card into view and outlines it for a moment, so the person sees which one a move or an answer is about. */
function focusCard(id) {
  const card = byId('board').querySelector(`[data-app="${id}"]`);
  if (!card) {
    return;
  }
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ block: 'center', inline: 'center', behavior: calm ? 'auto' : 'smooth' });
  card.classList.remove('is-moved');
  void card.offsetWidth; // restart the outline if the card was just outlined
  card.classList.add('is-moved');
}

/**
 * Drag a card onto another column to move it there: the same move as the menu and the button, so
 * dates, reminders and the check-in follow. The columns are redrawn on every change, so the
 * listeners sit on the board and find the column under the pointer.
 */
function wireDrag() {
  const board = byId('board');
  let draggedId = null;
  const clear = () => {
    draggedId = null;
    board.classList.remove('is-dragging-card');
    for (const node of board.querySelectorAll('.is-dragging, .is-over')) {
      node.classList.remove('is-dragging', 'is-over');
    }
  };
  const columnAt = (event) => event.target.closest?.('.apps-col');

  board.addEventListener('dragstart', (event) => {
    const card = event.target.closest?.('.apps-card');
    if (!card) {
      return;
    }
    draggedId = card.dataset.app;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedId);
    card.classList.add('is-dragging');
    board.classList.add('is-dragging-card');
  });
  board.addEventListener('dragend', clear);
  board.addEventListener('dragover', (event) => {
    const column = columnAt(event);
    if (!draggedId || !column) {
      return;
    }
    event.preventDefault();
    const dragged = apps.find((a) => a.id === draggedId);
    const same = dragged?.status === column.dataset.status;
    event.dataTransfer.dropEffect = same ? 'none' : 'move';
    for (const other of board.querySelectorAll('.is-over')) {
      if (other !== column) {
        other.classList.remove('is-over');
      }
    }
    column.classList.toggle('is-over', !same);
  });
  board.addEventListener('dragleave', (event) => {
    const column = columnAt(event);
    if (column && !column.contains(event.relatedTarget)) {
      column.classList.remove('is-over');
    }
  });
  board.addEventListener('drop', (event) => {
    const column = columnAt(event);
    if (!draggedId || !column) {
      return;
    }
    event.preventDefault();
    const id = draggedId;
    clear();
    if (apps.find((a) => a.id === id)?.status !== column.dataset.status) {
      move(id, column.dataset.status);
    }
  });
}

/** Lay AI on this page: answers from the board, and moves a card only when the person says yes. */
function wireLay() {
  setLayPage({
    sub: 'Preview: answers come from your board',
    greeting: "Hi, I'm Lay AI. Ask me about your applications: what is due, who has not replied, or how one company is going. I can also work on your resume and a job description.",
    prompts: ["What's due?", "Who hasn't replied?", 'Where are my rejections?', 'Status of Swiggy', 'Move Razorpay to Applied'],
    answer(text) {
      const result = layApplicationsReply(text, apps, Date.now());
      if (result.focus) {
        focusCard(result.focus);
      }
      const proposal = result.proposal;
      return {
        reply: result.reply,
        actions: proposal
          ? [
              { label: 'Move it', primary: true, run: () => { move(proposal.id, proposal.status); return `Done. It is in ${statusLabel(proposal.status)} now.`; } },
              { label: 'Not now', run: () => 'Fine, I left it where it is.' },
            ]
          : [],
      };
    },
  });
}

function render() {
  const now = Date.now();
  renderDue(now);
  byId('board').replaceChildren(
    ...boardColumns(apps).map((column) =>
      el(
        'section',
        { class: `apps-col apps-col-${column.value.toLowerCase()}`, 'aria-label': column.label, 'data-status': column.value },
        el('h2', { class: 'apps-col-title' }, column.label, el('span', { class: 'count' }, String(column.items.length))),
        column.items.length
          ? el('ul', { class: 'apps-list' }, ...column.items.map((app) => renderCard(app, now)))
          : el('p', { class: 'apps-empty' }, 'Nothing here.'),
      ),
    ),
  );
}

function renderDue(now) {
  const due = dueReminders(apps, now);
  setText(byId('due-count'), due.length ? `${due.length} due` : '');
  show(byId('due-count'), due.length > 0);
  byId('due-list').replaceChildren(
    ...(due.length
      ? due.map(({ app, reminder, overdue }) =>
          el('li', { class: overdue ? 'is-overdue' : '' },
            el('span', { class: 'tl-what' }, `${reminder.text}: ${app.role}, ${app.company}`),
            el('span', { class: 'tl-when' }, overdue ? `due ${dayLabel(reminder.dueAt, now)}` : dayLabel(reminder.dueAt, now))))
      : [el('li', { class: 'muted' }, 'No reminders in the next two days.')]),
  );
}

function renderCard(app, now) {
  const card = cloneTemplate('app-card');
  card.dataset.app = app.id;
  card.draggable = true;
  setText(field(card, 'role'), app.role);
  setText(field(card, 'company'), app.company);
  const since = app.appliedAt ? `Applied ${dayLabel(app.appliedAt, now)}` : `Added ${dayLabel(app.createdAt, now)}`;
  setText(field(card, 'meta'), [app.portal, since, app.resumeVersion ? `resume v${app.resumeVersion}` : null, app.externalId ? `id ${app.externalId}` : null].filter(Boolean).join(' · '));
  const reminder = field(card, 'reminder');
  setText(reminder, app.reminder ? `Reminder ${dayLabel(app.reminder.dueAt, now)}: ${app.reminder.text}` : '');
  show(reminder, Boolean(app.reminder));
  show(field(card, 'checkin'), needsCheckIn(app, now));

  const record = outcomeRecord(app, SUBJECT);
  show(field(card, 'stored'), Boolean(record));
  if (record) {
    setText(field(card, 'record'), JSON.stringify(record, null, 2));
  }

  const notes = notesOf(app);
  const input = field(card, 'notes');
  input.value = notes;
  input.dataset.notes = app.id;
  input.id = `notes-${app.id}`;
  input.maxLength = NOTES_MAX;
  input.placeholder = notesPlaceholder(app.status);
  field(card, 'notes-title').setAttribute('for', input.id);
  setText(field(card, 'notes-title'), `Notes for ${app.role} at ${app.company}`);
  field(card, 'notes-box').open = notesOpen.has(app.id);
  paintNotesSummary(card, notes);

  const select = field(card, 'move');
  select.dataset.move = app.id;
  const label = field(card, 'move-label');
  const selectId = `move-${app.id}`;
  select.id = selectId;
  label.setAttribute('for', selectId);
  select.replaceChildren(
    el('option', { value: '' }, 'Move to…'),
    ...STATUSES.filter((s) => s.value !== app.status).map((s) => el('option', { value: s.value }, s.label)),
  );
  const next = field(card, 'next');
  const to = nextStatus(app.status);
  if (to) {
    next.dataset.next = app.id;
    next.dataset.to = to;
    setText(next, to === 'APPLIED' ? 'Mark applied' : `→ ${statusLabel(to)}`);
  } else {
    show(next, false);
  }
  return card;
}
