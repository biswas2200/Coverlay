import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_MS,
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
  validateApplication,
} from '../src/js/pages/applications-rules.js';

const NOW = Date.UTC(2026, 10, 4, 10);

test('a new application starts in Preparing with a reminder in 3 days', () => {
  const apps = addApplication([], { company: ' Razorpay ', role: 'Platform Engineer', portal: 'LinkedIn' }, NOW, 4);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].company, 'Razorpay');
  assert.equal(apps[0].status, 'PREPARING');
  assert.equal(apps[0].reminder.dueAt, NOW + 3 * DAY_MS);
  assert.equal(validateApplication({ company: '', role: 'x', portal: 'LinkedIn' }), 'Add the company.');
  assert.equal(validateApplication({ company: 'x', role: 'y', portal: 'Fax' }), 'Choose where you apply.');
});

test('moving to Applied stamps the date and schedules the check-in a week later', () => {
  const [app] = addApplication([], { company: 'Swiggy', role: 'Backend Engineer', portal: 'Company site' }, NOW);
  const [applied] = moveTo([app], app.id, 'APPLIED', NOW);

  assert.equal(applied.appliedAt, NOW);
  assert.equal(applied.reminder.kind, 'follow_up');
  assert.equal(needsCheckIn(applied, NOW + 6 * DAY_MS), false);
  assert.equal(needsCheckIn(applied, NOW + 7 * DAY_MS), true);
  const [snoozed] = snoozeCheckIn([applied], applied.id, NOW + 7 * DAY_MS);
  assert.equal(needsCheckIn(snoozed, NOW + 8 * DAY_MS), false);
  const [offer] = moveTo([applied], app.id, 'OFFER', NOW);
  assert.equal(offer.reminder, null, 'an outcome clears the reminder');
  assert.equal(moveTo([applied], app.id, 'NOPE', NOW)[0], applied);
});

test('the board keeps its column order and the reminders due soon come first', () => {
  const apps = sampleApplications(NOW);
  assert.deepEqual(boardColumns(apps).map((c) => [c.value, c.items.length]), [
    ['PREPARING', 1], ['APPLIED', 2], ['INTERVIEW', 1], ['OFFER', 0], ['REJECTED', 1],
  ]);
  const due = dueReminders(apps, NOW);
  assert.ok(due.length >= 2);
  assert.ok(due.every((d, i) => i === 0 || due[i - 1].reminder.dueAt <= d.reminder.dueAt));
  assert.ok(due.some((d) => d.overdue));
  assert.ok(isApplicationList(apps));
  assert.equal(isApplicationList([{ id: 'x', status: 'LOST' }]), false);
});

test('the outcome record has no personal details', () => {
  const [app] = moveTo(sampleApplications(NOW), 'app-2', 'INTERVIEW', NOW);
  const record = outcomeRecord(moveTo(sampleApplications(NOW), 'app-2', 'INTERVIEW', NOW).find((a) => a.id === 'app-2'),
    { subjectId: 's-1', experienceBand: '1-3 yrs', skills: ['Java'] });
  assert.deepEqual(Object.keys(record).sort(), ['experience_band', 'outcome', 'resume_version', 'role', 'skills', 'subject_id']);
  assert.equal(record.outcome, 'interview');
  assert.equal(outcomeRecord(app.status === 'PREPARING' ? app : { ...app, status: 'APPLIED' }, {}), null, 'no outcome yet');
});

test('nextStatus and dayLabel', () => {
  assert.equal(nextStatus('PREPARING'), 'APPLIED');
  assert.equal(nextStatus('OFFER'), null);
  assert.equal(dayLabel(NOW, NOW), 'today');
  assert.equal(dayLabel(NOW + DAY_MS, NOW), 'tomorrow');
  assert.equal(dayLabel(NOW - 3 * DAY_MS, NOW), '3 days ago');
});
