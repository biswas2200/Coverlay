import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ANONYMOUS, HOUR_MS, POINTS_PER_POST, VIEWED_MAX, addPost, MAX_DEPTH, addReply, branchSize, isMyReply, markViewed, replyDepth, replyTree, validateReply, vote, voteCounts, voteOf, withDefaults, checkPost, filterFeed, isMine, migrateSaved, newDeviceTally, postAge, redeemPoints, roundToHour, sampleFeed, validatePost } from '../src/js/pages/community-rules.js';
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
  assert.deepEqual(device, { posts: 0, points: 0, mine: [], votes: {}, viewed: [], replies: [] });
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
    assert.deepEqual(Object.keys(post).sort(), ['company', 'createdHour', 'downvotes', 'id', 'replies', 'text', 'topic', 'upvotes']);
    assert.ok(!('handle' in post) && !('authorId' in post) && !('author' in post));
  }
  const [newer, older] = second.feed;
  assert.equal(Object.keys(newer).filter((key) => newer[key] === older[key] && !['topic', 'company', 'upvotes', 'downvotes'].includes(key)).length, 0, 'no shared value ties the two posts together');
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
  assert.deepEqual(now.device, { posts: 2, points: 10, mine: ['a'], votes: {}, viewed: [], replies: [] });
  assert.ok(now.feed.every((post) => !('handle' in post) && !('authorId' in post)));
  assert.deepEqual(migrateSaved(now), now, 'a current save is left as it is');
  const beforeLikes = migrateSaved({ feed: [], device: { posts: 1, points: 5, mine: ['x'] } });
  assert.deepEqual(beforeLikes.device, { posts: 1, points: 5, mine: ['x'], votes: {}, viewed: [], replies: [] }, 'a save from before likes gets empty lists');
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

test('votes: separate up and down counts, one vote per device that can be taken back or switched, nothing subtracted', () => {
  const feed = sampleFeed(NOW);
  const target = feed[1];
  const start = voteCounts(target);
  const up = vote(feed, newDeviceTally(), { postId: target.id }, 1);
  assert.deepEqual(voteCounts(up.feed[1]), { up: start.up + 1, down: start.down });
  assert.equal(voteOf(up.device, target.id), 1);

  const back = vote(up.feed, up.device, { postId: target.id }, 1);
  assert.deepEqual(voteCounts(back.feed[1]), start, 'pressing again takes the vote back');
  assert.deepEqual(back.device.votes, {});
  assert.equal(back.feed[1].upvotes, target.upvotes + 1, 'given only goes up');
  assert.equal(back.feed[1].upvotesWithdrawn, 1, 'the take-back is its own counter');

  const again = vote(back.feed, back.device, { postId: target.id }, 1);
  assert.deepEqual(voteCounts(again.feed[1]), { up: start.up + 1, down: start.down }, 'and it can be given again');

  const switched = vote(again.feed, again.device, { postId: target.id }, -1);
  assert.deepEqual(voteCounts(switched.feed[1]), { up: start.up, down: start.down + 1 }, 'switching moves the one vote');
  assert.equal(voteOf(switched.device, target.id), -1);
  for (const field of ['upvotes', 'downvotes', 'upvotesWithdrawn', 'downvotesWithdrawn']) {
    assert.ok((switched.feed[1][field] ?? 0) >= (target[field] ?? 0), `${field} never goes down`);
  }

  const fromZero = vote([{ id: 'z', replies: [] }], newDeviceTally(), { postId: 'z' }, -1);
  assert.deepEqual(voteCounts(fromZero.feed[0]), { up: 0, down: 1 });
  assert.deepEqual(voteCounts({ upvotes: 1, upvotesWithdrawn: 3 }), { up: 0, down: 0 }, 'never shown below zero');
  assert.equal(vote(feed, newDeviceTally(), { postId: 'nope' }, 1).feed, feed);
  assert.equal(vote(feed, newDeviceTally(), { postId: target.id }, 2).feed, feed, 'only 1 and -1');
});

test('votes on a comment change only that comment', () => {
  const feed = sampleFeed(NOW);
  const [first] = feed;
  const comment = first.replies[1];
  const { feed: after, device } = vote(feed, newDeviceTally(), { postId: first.id, replyId: comment.id }, -1);
  assert.equal(after[0].replies[1].downvotes, comment.downvotes + 1);
  assert.equal(after[0].upvotes, first.upvotes, 'the post is untouched');
  assert.equal(voteOf(device, comment.id), -1);
  assert.equal(vote(feed, newDeviceTally(), { postId: first.id, replyId: 'nope' }, 1).feed, feed);
});

test('a comment is anonymous, earns no points, and only this device knows it wrote it', () => {
  const feed = sampleFeed(NOW);
  const device = newDeviceTally();
  assert.match(validateReply('hey'), /at least 5/);
  assert.match(validateReply('x'.repeat(501)), /under 500/);
  assert.equal(validateReply('Thanks, this helped.'), null);
  const { feed: after, device: mine, reply } = addReply(feed, device, feed[1].id, '  Thanks, this helped.  ', NOW);
  assert.deepEqual(Object.keys(reply).sort(), ['createdHour', 'downvotes', 'id', 'parentId', 'text', 'upvotes']);
  assert.equal(reply.parentId, null);
  assert.equal(reply.text, 'Thanks, this helped.');
  assert.equal(reply.createdHour, roundToHour(NOW));
  assert.deepEqual(after[1].replies, [reply]);
  assert.deepEqual(mine.replies, [{ id: reply.id, postId: feed[1].id }]);
  assert.equal(mine.points, 0);
  assert.equal(mine.posts, 0, 'a comment is not a post');
  assert.equal(isMyReply(mine, reply), true);
  assert.equal(isMyReply(newDeviceTally(), reply), false, 'another device cannot tell');
  assert.equal(addReply(feed, device, feed[1].id, 'no', NOW).reply, null, 'too short changes nothing');
  assert.equal(addReply(feed, device, 'nope', 'Long enough reply.', NOW).reply, null);
  assert.equal(addReply(feed, device, feed[1].id, 'Long enough reply.', NOW, 'nope').reply, null, 'the parent must be on this post');
});

test('comments branch: replies nest under their parent, best first, at most MAX_DEPTH deep', () => {
  let feed = [{ id: 'p', topic: 'advice', company: null, text: 'A post', createdHour: 0, upvotes: 0, downvotes: 0, replies: [] }];
  let device = newDeviceTally();
  let parentId = null;
  const chain = [];
  for (let level = 0; level < MAX_DEPTH; level += 1) {
    const result = addReply(feed, device, 'p', `Level ${level + 1} comment.`, NOW + level, parentId);
    assert.ok(result.reply, `level ${level + 1} is allowed`);
    ({ feed, device } = result);
    parentId = result.reply.id;
    chain.push(parentId);
  }
  assert.equal(addReply(feed, device, 'p', 'One level too deep.', NOW, parentId).reply, null);
  assert.equal(replyDepth(feed[0].replies, chain[0]), 0);
  assert.equal(replyDepth(feed[0].replies, chain[MAX_DEPTH - 1]), MAX_DEPTH - 1);
  assert.equal(replyDepth(feed[0].replies, 'nope'), -1);

  const sibling = addReply(feed, device, 'p', 'A second top-level comment.', NOW + 100);
  ({ feed, device } = vote(sibling.feed, sibling.device, { postId: 'p', replyId: sibling.reply.id }, 1));
  const tree = replyTree(feed[0].replies);
  assert.deepEqual(tree.map((node) => node.id), [sibling.reply.id, chain[0]], 'the most upvotes first');
  assert.equal(tree[1].children[0].id, chain[1]);
  assert.equal(tree[1].children[0].depth, 1);
  assert.equal(branchSize(tree[1]), MAX_DEPTH - 1);
  const orphan = replyTree([{ id: 'x', parentId: 'gone', text: 't', createdHour: 0, upvotes: 0, downvotes: 0 }]);
  assert.equal(orphan[0].depth, 0, 'a comment whose parent is gone is kept at the top');
  const sample = replyTree(sampleFeed(NOW)[0].replies);
  assert.equal(sample[0].children[0].children[0].depth, 2, 'the sample has a real branch');
});

test('an older tally with "useful" marks keeps them as upvotes', () => {
  assert.deepEqual(withDefaults({ liked: ['a'], votes: { b: -1, c: 3 } }).votes, { a: 1, b: -1 });
});

test('views are counted once per post, never for your own posts, and capped', () => {
  const { feed, device } = addPost(sampleFeed(NOW), newDeviceTally(), { text: 'My own post, long enough to post.', topic: 'advice', company: '' }, NOW);
  const ids = feed.map((post) => post.id);
  const seen = markViewed(device, ids);
  assert.equal(seen.viewed.length, ids.length - 1);
  assert.ok(!seen.viewed.includes(feed[0].id));
  assert.equal(markViewed(seen, ids), seen, 'seeing them again changes nothing');
  const many = markViewed(newDeviceTally(), Array.from({ length: VIEWED_MAX + 20 }, (_, i) => `p${i}`));
  assert.equal(many.viewed.length, VIEWED_MAX);
  assert.deepEqual(withDefaults({ replies: [{ id: 1 }, { id: 'r', postId: 'p' }] }).replies, [{ id: 'r', postId: 'p' }]);
});
