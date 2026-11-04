import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DAY_MS, advanceDeletion, beginPurge, canUndo, defaultConsents, deletionStatusText, regionFromTimeZone, startDeletion, tombstone } from '../src/js/pages/settings-rules.js';

const NOW = Date.UTC(2026, 10, 4, 10);

test('analytics and learning are opt-in in the EU and UK, on elsewhere', () => {
  assert.equal(regionFromTimeZone('Europe/London'), 'EU/UK');
  assert.equal(regionFromTimeZone('Asia/Kolkata'), 'Other');
  assert.deepEqual(defaultConsents('EU/UK'), { analytics: false, learning: false, reminders: true });
  assert.deepEqual(defaultConsents('Other'), { analytics: true, learning: true, reminders: true });
});

test('a grace deletion waits 14 days and can be undone until then', () => {
  const job = startDeletion({ mode: 'grace', deletePosts: false }, NOW);
  assert.equal(job.status, 'scheduled');
  assert.equal(job.purgeAt, NOW + 14 * DAY_MS);
  assert.equal(canUndo(job, NOW + 13 * DAY_MS), true);
  assert.equal(canUndo(job, NOW + 14 * DAY_MS), false);
  assert.equal(advanceDeletion(job), job, 'nothing runs before the purge');
  assert.match(deletionStatusText(job, NOW), /^Scheduled for/);
  assert.equal(beginPurge(job, NOW + DAY_MS).status, 'running');
});

test('every step runs, a failing step is retried, and "Deleted" comes only at the end', () => {
  let job = startDeletion({ mode: 'now', deletePosts: true }, NOW);
  assert.deepEqual(job.steps.map((s) => s.name), ['files', 'search', 'posts', 'account']);
  const seen = [];
  for (let i = 0; i < 10 && job.status !== 'done'; i += 1) {
    job = advanceDeletion(job, { failing: ['search'] });
    seen.push(deletionStatusText(job, NOW));
  }
  assert.equal(job.status, 'done');
  assert.equal(job.steps.find((s) => s.name === 'search').attempts, 2, 'failed once, then succeeded');
  assert.ok(seen.slice(0, -1).every((text) => text.startsWith('Deleting')), 'never "Deleted" early');
  assert.ok(seen.some((text) => text.includes('Retrying')));
  assert.match(seen.at(-1), /^Deleted\. Your email is free/);
});

test('the tombstone keeps the analytics id, the day and the reason only', () => {
  let job = startDeletion({ mode: 'now', deletePosts: false }, NOW);
  assert.equal(tombstone(job, 's-1'), null);
  while (job.status !== 'done') {
    job = advanceDeletion(job);
  }
  assert.deepEqual(tombstone(job, 's-1'), { subject_id: 's-1', deleted_at: '2026-11-04', reason: 'USER_REQUEST' });
});
