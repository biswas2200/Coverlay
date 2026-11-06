import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_MS,
  addApplication,
  boardColumns,
  boardSummary,
  findApplication,
  layApplicationsReply,
  stageFromText,
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

// ---------- Lay AI on the board ----------

const board = () => sampleApplications(NOW);

test('findApplication finds the card a message is about: company first, then the role', () => {
  assert.equal(findApplication(board(), 'what is the status of swiggy?').id, 'app-2');
  assert.equal(findApplication(board(), 'the SDE II one').id, 'app-3');
  assert.equal(findApplication(board(), 'prepare for the devops role').id, 'app-4');
  assert.equal(findApplication(board(), "what's due today?"), null);
  assert.equal(findApplication(board(), 'move to interview'), null, 'only stage words, no application named');
  assert.equal(findApplication(board(), 'status of google'), null);
});

test('stageFromText reads the stage a message talks about', () => {
  assert.equal(stageFromText('move swiggy to interview'), 'INTERVIEW');
  assert.equal(stageFromText('I got an offer from Zerodha'), 'OFFER');
  assert.equal(stageFromText('freshworks rejected me'), 'REJECTED');
  assert.equal(stageFromText('I applied to razorpay'), 'APPLIED');
  assert.equal(stageFromText('status of swiggy'), null);
});

test('the summary counts every column and names what needs the person most', () => {
  const text = boardSummary(board(), NOW);
  assert.match(text, /^You have 5 applications: 1 preparing, 2 applied, 1 interview, 0 offer, 1 rejected\./);
  assert.match(text, /needs you most/);
  assert.equal(boardSummary([], NOW), 'Your board is empty. Use Add an application to start.');
});

test('Lay AI answers a status question from the board and points at the card', () => {
  const answer = layApplicationsReply('What is the status of Swiggy?', board(), NOW);
  assert.match(answer.reply, /Backend Engineer at Swiggy is in Applied: you applied 9 days ago on LinkedIn with resume v3/);
  assert.match(answer.reply, /Next: follow up if you haven't heard back, due 2 days ago\./);
  assert.equal(answer.focus, 'app-2');
  assert.equal(answer.proposal, null);
});

test("Lay AI lists what is due, what to chase, and summarises the board", () => {
  const due = layApplicationsReply("What's due?", board(), NOW);
  assert.match(due.reply, /^3 things need you\./);
  assert.match(due.reply, /DevOps Engineer at Zerodha: get ready for the interview \(due 3 days ago\)/);
  assert.doesNotMatch(due.reply, /:[^.]*:/, 'no sentence has two colons in a row of words');
  assert.equal(due.focus, 'app-4', 'the most overdue card is brought into view');
  assert.match(layApplicationsReply("What's due?", [], NOW).reply, /Nothing is due/);

  const chase = layApplicationsReply("Who hasn't replied?", board(), NOW);
  assert.match(chase.reply, /Backend Engineer at Swiggy \(9 days ago\)/);
  assert.doesNotMatch(chase.reply, /Flipkart/, 'a two-day-old application is not worth chasing yet');
  assert.equal(chase.focus, 'app-2');

  assert.match(layApplicationsReply('Summarise my board', board(), NOW).reply, /You have 5 applications/);
});

test('Lay AI only proposes a move; it never changes the board', () => {
  const apps = board();
  const before = JSON.stringify(apps);
  const answer = layApplicationsReply('Move Razorpay to Applied', apps, NOW);
  assert.deepEqual(answer.proposal, { id: 'app-1', status: 'APPLIED' });
  assert.match(answer.reply, /Move Platform Engineer at Razorpay from Preparing to Applied\? I only move it when you say yes\./);
  assert.equal(JSON.stringify(apps), before);

  const outcome = layApplicationsReply('I got an offer from Zerodha', apps, NOW);
  assert.deepEqual(outcome.proposal, { id: 'app-4', status: 'OFFER' });
  assert.deepEqual(layApplicationsReply('Freshworks rejected me', apps, NOW).proposal, null, 'already rejected: nothing to propose');
  assert.match(layApplicationsReply('Freshworks rejected me', apps, NOW).reply, /already in Rejected/);
  assert.match(layApplicationsReply('move to interview', apps, NOW).reply, /Which application\?/);
});

test('Lay AI prepares for an interview, is honest about what it cannot find, and explains itself', () => {
  assert.match(layApplicationsReply('Prepare for Zerodha', board(), NOW).reply, /read the job post again, and open resume v2/);
  assert.match(layApplicationsReply('Prepare for Swiggy', board(), NOW).reply, /starts when it moves to Interview/);
  assert.match(layApplicationsReply('status of Google', board(), NOW).reply, /can't find that on your board/);
  assert.match(layApplicationsReply('hello', board(), NOW).reply, /I can answer from your board/, 'a greeting is not a missing application');
  const help = layApplicationsReply('', board(), NOW);
  assert.match(help.reply, /I can answer from your board/);
  assert.equal(help.proposal, null);
});

test('every Lay AI reply is short and plain', () => {
  for (const question of ["What's due?", 'Summarise my board', "Who hasn't replied?", 'Status of Swiggy', 'Prepare for Zerodha', 'Move Razorpay to Applied', 'hello']) {
    const { reply } = layApplicationsReply(question, board(), NOW);
    assert.ok(reply.split(/\s+/).length <= 80, `${question}: ${reply.split(/\s+/).length} words`);
    assert.ok(!reply.includes('!'), 'no exclamation marks');
  }
});
