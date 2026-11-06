import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ANONYMOUS, HOUR_MS, POINTS_PER_POST, addPost, checkPost, filterFeed, isMine, migrateSaved, newDeviceTally, postAge, redeemPoints, roundToHour, sampleFeed, validatePost } from '../src/js/pages/community-rules.js';
import { knownValues } from '../src/js/pages/privacy-guard-rules.js';
import { sampleResume } from '../src/js/pages/resume-builder-rules.js';

const NOW = Date.UTC(2026, 10, 4, 10, 37, 12);
const values = knownValues(sampleResume());

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

test('posting earns points on this device; redeeming empties them', () => {
  const device = newDeviceTally();
  assert.deepEqual(device, { posts: 0, points: 0, mine: [] });
  const { feed, device: after } = addPost([], device, { text: 'A useful post about interviews.', topic: 'interviews', company: '' }, NOW);
  assert.equal(feed[0].createdHour, roundToHour(NOW));
  assert.equal(feed[0].company, null);
  assert.equal(after.points, POINTS_PER_POST);
  assert.equal(after.posts, 1);
  assert.equal(device.points, 0, 'the old tally is not changed');
  const redeemed = redeemPoints(after);
  assert.equal(redeemed.credits, POINTS_PER_POST);
  assert.equal(redeemed.device.points, 0);
  assert.equal(redeemPoints(redeemed.device).credits, 0);
});

test('a post carries nothing about who wrote it, or that it shares a writer with another post', () => {
  const device = newDeviceTally();
  const first = addPost([], device, { text: 'Interview at Swiggy was about design.', topic: 'interviews', company: 'Swiggy' }, NOW);
  const second = addPost(first.feed, first.device, { text: 'A second post by the same person.', topic: 'advice', company: '' }, NOW + 5 * HOUR_MS);
  for (const post of second.feed) {
    assert.deepEqual(Object.keys(post).sort(), ['company', 'createdHour', 'id', 'text', 'topic', 'upvotes']);
    assert.ok(!('handle' in post) && !('authorId' in post) && !('author' in post));
  }
  const [newer, older] = second.feed;
  assert.equal(Object.keys(newer).filter((key) => newer[key] === older[key] && !['topic', 'company', 'upvotes'].includes(key)).length, 0, 'no shared value ties the two posts together');
  for (const post of sampleFeed(NOW)) {
    assert.ok(!('handle' in post) && !('authorId' in post));
  }
  assert.equal(ANONYMOUS, 'Anonymous');
});

test('only this device knows which posts are its own', () => {
  const { feed, device } = addPost(sampleFeed(NOW), newDeviceTally(), { text: 'My own post, long enough to post.', topic: 'advice', company: '' }, NOW);
  assert.equal(feed.filter((post) => isMine(device, post)).length, 1);
  assert.equal(isMine(device, feed[0]), true);
  assert.equal(isMine(newDeviceTally(), feed[0]), false, 'another device cannot tell');
});

test('an older saved preview, with mask handles, becomes anonymous and keeps the posts that were yours', () => {
  const old = {
    identity: { id: 'mask-1', handle: 'Lunar Ibis', month: '2026-11', points: 10, posts: 2 },
    feed: [
      { id: 'a', authorId: 'mask-1', handle: 'Lunar Ibis', topic: 'advice', company: null, text: 'mine', createdHour: 1, upvotes: 0 },
      { id: 'b', authorId: 'sample-author-1', handle: 'Misty Gecko', topic: 'offers', company: null, text: 'not mine', createdHour: 1, upvotes: 4 },
    ],
  };
  const now = migrateSaved(old);
  assert.deepEqual(now.device, { posts: 2, points: 10, mine: ['a'] });
  assert.ok(now.feed.every((post) => !('handle' in post) && !('authorId' in post)));
  assert.equal(migrateSaved(now), now, 'a current save is left as it is');
  assert.equal(migrateSaved(null), null);
  assert.equal(migrateSaved({ nothing: true }), null);
});

test('validatePost and filterFeed', () => {
  assert.match(validatePost('too short', 'interviews'), /at least 20/);
  assert.match(validatePost('long enough text for a post', 'nope'), /topic/);
  assert.equal(validatePost('long enough text for a post', 'offers'), null);
  assert.equal(filterFeed(sampleFeed(NOW), 'offers').length, 1);
  assert.equal(filterFeed(sampleFeed(NOW), null).length, 4);
});
