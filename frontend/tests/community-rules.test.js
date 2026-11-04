import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOUR_MS, POINTS_PER_POST, addPost, checkPost, filterFeed, maskHandle, newIdentity, postAge, redeemPoints, roundToHour, sampleFeed, validatePost } from '../src/js/pages/community-rules.js';
import { knownValues } from '../src/js/pages/privacy-guard-rules.js';
import { sampleResume } from '../src/js/pages/resume-builder-rules.js';

const NOW = Date.UTC(2026, 10, 4, 10, 37, 12);
const values = knownValues(sampleResume());

test('mask handles are stable per seed', () => {
  assert.equal(maskHandle('abc'), maskHandle('abc'));
  assert.match(maskHandle('abc'), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
});

test('posts keep only the hour', () => {
  assert.equal(roundToHour(NOW), Date.UTC(2026, 10, 4, 10));
  assert.equal(postAge(roundToHour(NOW), NOW), 'this hour');
  assert.equal(postAge(NOW - 3 * HOUR_MS, NOW), 'about 3 h ago');
  assert.equal(postAge(NOW - 30 * HOUR_MS, NOW), 'yesterday');
});

test('the check before posting finds what identifies the writer and offers a safe version', () => {
  const { found, safeText } = checkPost('I studied at VIT, work at Acme Corp. Mail jane@email.com or ring +91 99887 76655.', values);
  assert.deepEqual(found, ['user.college', 'user.company', 'user.email', 'other.phone_1']);
  assert.equal(safeText, 'I studied at my college, work at my company. Mail [email removed] or ring [phone removed].');
  assert.deepEqual(checkPost('Interviews at Swiggy were about system design.', values).found, []);
});

test('posting earns points under the mask; redeeming empties them', () => {
  const identity = newIdentity('seed', NOW);
  assert.equal(identity.month, '2026-11');
  const { feed, identity: after } = addPost([], identity, { text: 'A useful post about interviews.', topic: 'interviews', company: '' }, NOW);
  assert.equal(feed[0].createdHour, roundToHour(NOW));
  assert.equal(feed[0].company, null);
  assert.equal(feed[0].handle, identity.handle);
  assert.equal(after.points, POINTS_PER_POST);
  const redeemed = redeemPoints(after);
  assert.equal(redeemed.credits, POINTS_PER_POST);
  assert.equal(redeemed.identity.points, 0);
  assert.equal(redeemPoints(redeemed.identity).credits, 0);
});

test('validatePost and filterFeed', () => {
  assert.match(validatePost('too short', 'interviews'), /at least 20/);
  assert.match(validatePost('long enough text for a post', 'nope'), /topic/);
  assert.equal(validatePost('long enough text for a post', 'offers'), null);
  assert.equal(filterFeed(sampleFeed(NOW), 'offers').length, 1);
  assert.equal(filterFeed(sampleFeed(NOW), null).length, 4);
});
