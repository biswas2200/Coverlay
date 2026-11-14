// The anonymous community (preview, sample data). Every post is simply "Anonymous": there is no
// handle, no pseudonym and no per-person mask, so nobody can link a post to an account, and
// nobody can even tell that two posts came from the same person. In the real system each post is
// stamped with its own one-time pass, made on the device and signed by Coverlay without Coverlay
// seeing it (a blind signature), and carries only the topic, the company if given, the text and
// the hour it was made. The device keeps a private tally of its own posts and points; that tally
// never leaves it. Points earned by posts move to the wallet in small batches at random times,
// so amounts and timing don't point back to a post. How Coverlay limits abuse (how many passes an
// account gets, removing posts one by one) is its own internal policy and is not shown here.
// Before a post goes up, the guard checks it for details that would identify the writer.
// DOM-free so tests/community-rules.test.js can run it in Node.

import { guardText } from './privacy-guard-rules.js';

export const HOUR_MS = 60 * 60 * 1000;

export const TOPICS = [
  { id: 'interviews', label: 'Interview experience' },
  { id: 'offers', label: 'Salary & offers' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'culture', label: 'Company culture' },
  { id: 'advice', label: 'Career advice' },
];

export const POINTS_PER_POST = 5;
export const MIN_POST = 20;
export const MAX_POST = 1000;
export const MIN_REPLY = 5;
export const MAX_REPLY = 500;
/** How many levels a branch of comments can have (a comment on the post is level 1). */
export const MAX_DEPTH = 6;
/** How many viewed post ids the device remembers (oldest dropped first). */
export const VIEWED_MAX = 500;

/** What every post shows as its author. */
export const ANONYMOUS = 'Anonymous';

/** Posts keep only the hour they were made, so exact times can't be matched to activity. */
export function roundToHour(at) {
  return Math.floor(at / HOUR_MS) * HOUR_MS;
}

export function postAge(createdHour, now) {
  const hours = Math.floor((now - createdHour) / HOUR_MS);
  if (hours < 1) {
    return 'this hour';
  }
  if (hours < 24) {
    return `about ${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// What a personal detail becomes when the writer agrees to make the post safe.
const SAFE_WORDS = {
  'user.name': 'me', 'user.first_name': 'me', 'user.college': 'my college', 'user.company': 'my company',
  'user.email': '[email removed]', 'user.phone': '[phone removed]', 'user.link': '[link removed]',
};

/**
 * The check before posting: `{ found, safeText }`. `found` lists the details that would
 * identify the writer (their name, college, company, contacts, or anyone's email, phone or
 * link); `safeText` is the post with each replaced by a neutral word ("my college").
 */
export function checkPost(text, values) {
  const { stored, found, vault } = guardText(text, values);
  const safeText = stored.replace(/\{((?:user|other)\.[a-z_]+(?:_\d+)?)\}/g, (_, key) => {
    if (SAFE_WORDS[key]) {
      return SAFE_WORDS[key];
    }
    if (key.startsWith('other.email')) {
      return '[email removed]';
    }
    if (key.startsWith('other.phone')) {
      return '[phone removed]';
    }
    return vault[key] && key.startsWith('other.link') ? '[link removed]' : '';
  });
  return { found, safeText };
}

/** Why a post can't go up, or null. */
export function validatePost(text, topic) {
  const length = String(text ?? '').trim().length;
  if (length < MIN_POST) {
    return `Write at least ${MIN_POST} characters.`;
  }
  if (length > MAX_POST) {
    return `Keep it under ${MAX_POST} characters.`;
  }
  if (!TOPICS.some((t) => t.id === topic)) {
    return 'Choose a topic.';
  }
  return null;
}

/**
 * What this device keeps privately about its own activity: `{ posts, points, mine, votes, viewed, replies }`.
 * `mine` lists the ids of the posts this device made, so it can label them "You" on its own screen;
 * `votes` maps a post or comment id to this device's vote (1 up, -1 down); `viewed` the posts it has
 * shown; `replies` its own anonymous comments as `{ id, postId }`. None of it is ever sent anywhere, and the posts, likes and replies
 * themselves carry nothing that points back to it. "My activity" is read from this tally.
 */
export function newDeviceTally() {
  return { posts: 0, points: 0, mine: [], votes: {}, viewed: [], replies: [] };
}

/**
 * A tally saved before votes, views and comments existed, with the missing parts added empty. An older `liked` list
 * (the "Useful" button) becomes upvotes.
 */
export function withDefaults(device) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const votes = {};
  for (const id of list(device?.liked)) {
    votes[id] = 1;
  }
  for (const [id, value] of Object.entries(device?.votes && typeof device.votes === 'object' ? device.votes : {})) {
    if (value === 1 || value === -1) {
      votes[id] = value;
    }
  }
  return {
    posts: Number(device?.posts) || 0,
    points: Number(device?.points) || 0,
    mine: list(device?.mine),
    votes,
    viewed: list(device?.viewed),
    replies: list(device?.replies).filter((r) => r && typeof r.id === 'string' && typeof r.postId === 'string'),
  };
}

/**
 * A new post at the top of the feed, and the device's updated tally. The post has no author, no
 * handle and no link to any other post: only its topic, company, text, the hour and its count.
 */
export function addPost(feed, device, { text, topic, company }, now) {
  const post = {
    id: `post-${now.toString(36)}-${feed.length + 1}`,
    topic,
    company: String(company ?? '').trim().slice(0, 60) || null,
    text: String(text).trim(),
    createdHour: roundToHour(now),
    upvotes: 0,
    downvotes: 0,
    replies: [],
  };
  return {
    feed: [post, ...feed],
    device: { ...device, points: device.points + POINTS_PER_POST, posts: device.posts + 1, mine: [post.id, ...device.mine] },
  };
}

/** Whether this device made the post (shown as "You" on this screen only). */
export function isMine(device, post) {
  return device.mine.includes(post.id);
}

/**
 * A saved preview from before every post was anonymous (it had a mask handle and an author id
 * on each post) as the current shape: the handles and author ids are dropped, and the posts the
 * old identity wrote become this device's own. Anything else comes back unchanged.
 */
export function migrateSaved(saved) {
  if (!saved || !Array.isArray(saved.feed)) {
    return null;
  }
  if (saved.device && Array.isArray(saved.device.mine)) {
    return { ...saved, device: withDefaults(saved.device) };
  }
  const identity = saved.identity ?? {};
  const feed = saved.feed.map(({ authorId, handle, ...post }) => post);
  const mine = saved.feed.filter((post) => identity.id && post.authorId === identity.id).map((post) => post.id);
  return { feed, device: withDefaults({ posts: identity.posts ?? mine.length, points: identity.points ?? 0, mine }) };
}

/** This device's vote on a post or a comment: 1 (up, agree), -1 (down, disagree) or 0 (none yet). */
export function voteOf(device, id) {
  return device.votes[id] ?? 0;
}

/**
 * The up (agree) and down (disagree) counts to show for a post or a comment. Every stored counter only ever goes up:
 * `upvotes` and `downvotes` count votes given, `upvotesWithdrawn` and `downvotesWithdrawn` count votes taken back. What
 * is shown is given minus withdrawn, never below zero. There is no combined score; how the two are weighed or ranked is
 * the backend's decision.
 */
export function voteCounts(item) {
  return {
    up: Math.max(0, (item?.upvotes ?? 0) - (item?.upvotesWithdrawn ?? 0)),
    down: Math.max(0, (item?.downvotes ?? 0) - (item?.downvotesWithdrawn ?? 0)),
  };
}

/**
 * Votes on a post (`{ postId }`) or one of its comments (`{ postId, replyId }`). A device has one vote per post or
 * comment, and it is never locked: pressing the same arrow again takes the vote back, pressing the other arrow switches
 * it. Nothing is ever subtracted. A new vote adds one to `upvotes` or `downvotes`; taking a vote back (or switching
 * away from it) adds one to `upvotesWithdrawn` or `downvotesWithdrawn`. So the server only ever increments four counters
 * and can apply votes in any order without locks (increment-only counters; the shown count is given minus withdrawn).
 * Which way this device voted is kept on the device alone (`votes`), so a vote can't be tied to an account.
 *
 * @param {any[]} feed
 * @param {any} device
 * @param {{ postId: string, replyId?: string | null }} target
 * @param {number} direction
 */
export function vote(feed, device, { postId, replyId = null }, direction) {
  if (direction !== 1 && direction !== -1) {
    return { feed, device };
  }
  const post = feed.find((p) => p.id === postId);
  const target = replyId ? post?.replies?.find((r) => r.id === replyId) : post;
  if (!target) {
    return { feed, device };
  }
  const before = voteOf(device, target.id);
  const after = before === direction ? 0 : direction;
  const bump = (item, field) => ({ ...item, [field]: (item[field] ?? 0) + 1 });
  const counted = (item) => {
    let next = item;
    if (before === 1) {
      next = bump(next, 'upvotesWithdrawn');
    } else if (before === -1) {
      next = bump(next, 'downvotesWithdrawn');
    }
    if (after === 1) {
      next = bump(next, 'upvotes');
    } else if (after === -1) {
      next = bump(next, 'downvotes');
    }
    return next;
  };
  const votes = { ...device.votes };
  if (after) {
    votes[target.id] = after;
  } else {
    delete votes[target.id];
  }
  return {
    feed: feed.map((p) => {
      if (p.id !== postId) {
        return p;
      }
      return replyId ? { ...p, replies: p.replies.map((r) => (r.id === replyId ? counted(r) : r)) } : counted(p);
    }),
    device: { ...device, votes },
  };
}

/** Why a comment can't go up, or null. */
export function validateReply(text) {
  const length = String(text ?? '').trim().length;
  if (length < MIN_REPLY) {
    return `Write at least ${MIN_REPLY} characters.`;
  }
  if (length > MAX_REPLY) {
    return `Keep it under ${MAX_REPLY} characters.`;
  }
  return null;
}

/** How deep a comment sits: 0 for a comment on the post, 1 for a reply to it, and so on. */
export function replyDepth(replies, replyId) {
  let depth = 0;
  let current = replies.find((r) => r.id === replyId);
  while (current?.parentId) {
    depth += 1;
    current = replies.find((r) => r.id === current.parentId);
  }
  return current ? depth : -1;
}

/**
 * An anonymous comment on a post (`parentId` null) or a reply to another comment, and the device's updated tally.
 * Comments form branches as on Reddit, at most MAX_DEPTH levels deep. A comment keeps only its parent, its text, the
 * hour and its vote counts, is shown as "Anonymous", and earns no points (so comments can't be farmed). The device
 * remembers its own comments so it can label them "You" and list them on My activity.
 *
 * @param {any[]} feed
 * @param {any} device
 * @param {string} postId
 * @param {string} text
 * @param {number} now
 * @param {string | null} [parentId]
 */
export function addReply(feed, device, postId, text, now, parentId = null) {
  const post = feed.find((p) => p.id === postId);
  if (!post || validateReply(text)) {
    return { feed, device, reply: null };
  }
  const replies = post.replies ?? [];
  if (parentId && (replyDepth(replies, parentId) < 0 || replyDepth(replies, parentId) >= MAX_DEPTH - 1)) {
    return { feed, device, reply: null };
  }
  const reply = {
    id: `reply-${now.toString(36)}-${replies.length + 1}`,
    parentId: parentId ?? null,
    text: String(text).trim(),
    createdHour: roundToHour(now),
    upvotes: 0,
    downvotes: 0,
  };
  return {
    feed: feed.map((p) => (p.id === postId ? { ...p, replies: [...replies, reply] } : p)),
    device: { ...device, replies: [{ id: reply.id, postId }, ...device.replies] },
    reply,
  };
}

/** Whether this device wrote the comment (shown as "You" on this screen only). */
export function isMyReply(device, reply) {
  return device.replies.some((r) => r.id === reply.id);
}

/**
 * A post's comments as branches: `[{ ...comment, depth, children: [...] }]`. In the prototype siblings are sorted by
 * the most upvotes, then the fewest downvotes, then the older one (the real ranking is the backend's decision). A comment whose parent is gone is shown at the
 * top level rather than lost.
 */
export function replyTree(replies = []) {
  const ids = new Set(replies.map((r) => r.id));
  const byParent = new Map();
  for (const reply of replies) {
    const parent = reply.parentId && ids.has(reply.parentId) ? reply.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), reply]);
  }
  const order = (a, b) => voteCounts(b).up - voteCounts(a).up || voteCounts(a).down - voteCounts(b).down || a.createdHour - b.createdHour || replies.indexOf(a) - replies.indexOf(b);
  const build = (parent, depth) => (byParent.get(parent) ?? []).slice().sort(order).map((reply) => ({ ...reply, depth, children: build(reply.id, depth + 1) }));
  return build(null, 0);
}

/** How many comments are under a comment, all the way down (shown when a branch is collapsed). */
export function branchSize(node) {
  return node.children.reduce((sum, child) => sum + 1 + branchSize(child), 0);
}

/**
 * The posts this device has now shown, added to what it has seen before (each post once, the
 * newest first, at most VIEWED_MAX). Its own posts don't count as views. Kept on the device only.
 */
export function markViewed(device, postIds) {
  const fresh = postIds.filter((id) => !device.viewed.includes(id) && !device.mine.includes(id));
  if (!fresh.length) {
    return device;
  }
  return { ...device, viewed: [...fresh, ...device.viewed].slice(0, VIEWED_MAX) };
}

/** Points leave the device for the wallet; the wallet gets them later, in a random batch. */
export function redeemPoints(device) {
  if (device.points <= 0) {
    return { device, credits: 0 };
  }
  return { device: { ...device, points: 0 }, credits: device.points };
}

export function filterFeed(feed, topic) {
  return topic ? feed.filter((p) => p.topic === topic) : feed;
}

export function sampleFeed(now) {
  const post = (n, topic, company, text, hoursAgo, upvotes) => ({
    id: `sample-${n}`, topic, company, text, createdHour: roundToHour(now - hoursAgo * HOUR_MS), upvotes, downvotes: Math.round(upvotes / 12), replies: [],
  });
  const comment = (n, parentId, text, hoursAgo, upvotes, downvotes = 0) => ({
    id: `sample-reply-${n}`, parentId, text, createdHour: roundToHour(now - hoursAgo * HOUR_MS), upvotes, downvotes,
  });
  const withComments = (item, replies) => ({ ...item, replies });
  return [
    withComments(post(1, 'interviews', 'Swiggy', 'Backend round 2 was a design question: rate-limit an API for 1M users. They cared more about trade-offs than the final answer.', 3, 41), [
      comment(1, null, 'Did they ask you to write code for it, or only draw the design?', 2, 12),
      comment(2, 'sample-reply-1', 'Only the design, then a few questions on Redis and what happens when it goes down.', 2, 9),
      comment(3, 'sample-reply-2', 'Same for me last month. Token bucket was enough, they wanted to hear the failure cases.', 1, 4),
      comment(4, null, 'Was this for SDE 2 or SDE 1?', 1, 3, 1),
    ]),
    post(2, 'offers', null, 'Got two offers as a 2-year Java dev in Bengaluru: 18 and 21 LPA. Negotiating with the second offer in writing worked.', 26, 87),
    post(3, 'referrals', 'Flipkart', 'Referrals work best with a two-line note and the job link. Long messages get skipped.', 50, 23),
    post(4, 'culture', 'Zerodha', 'Small teams, very few meetings, and on-call is shared fairly. Good place to learn Linux deeply.', 75, 19),
  ];
}
