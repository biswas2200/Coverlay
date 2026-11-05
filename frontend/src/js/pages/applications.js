import { byId, cloneTemplate, el, field, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import {
  PORTALS,
  STATUSES,
  addApplication,
  boardColumns,
  dayLabel,
  dueReminders,
  isApplicationList,
  moveTo,
  needsCheckIn,
  nextStatus,
  outcomeRecord,
  sampleApplications,
  snoozeCheckIn,
  statusLabel,
  validateApplication,
} from './applications-rules.js';

// The applications board preview: five columns, a move control on each card, the reminders due
// soon, the "Did you hear back?" check-in, and what the outcome insight keeps (no names).

const KEY = `coverlay.preview.applications.${getUser()?.id ?? 'guest'}`;
// The sample analytics id and resume features the outcome record shows (no personal data).
const SUBJECT = { subjectId: '7f3a…c21e', experienceBand: '1-3 yrs', skills: ['Java', 'Spring Boot', 'SQL'] };

let apps = load();

if (requireAuth()) {
  hydrateIcons();
  renderShell('applications');
  wire();
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
  byId('reset-apps').addEventListener('click', () => {
    apps = sampleApplications(Date.now());
    save();
    render();
  });
}

function move(id, status) {
  apps = moveTo(apps, id, status, Date.now());
  save();
  const app = apps.find((a) => a.id === id);
  announce(`${app.role} at ${app.company} moved to ${statusLabel(status)}.`);
  render();
}

function render() {
  const now = Date.now();
  renderDue(now);
  byId('board').replaceChildren(
    ...boardColumns(apps).map((column) =>
      el(
        'section',
        { class: `apps-col apps-col-${column.value.toLowerCase()}`, 'aria-label': column.label },
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
