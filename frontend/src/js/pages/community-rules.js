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
 * What this device keeps privately about its own posting: `{ posts, points, mine }`. `mine` lists
 * the ids of the posts this device made, so it can label them "You" on its own screen. It is
 * never sent anywhere, and the posts themselves carry nothing that points back to it.
 */
export function newDeviceTally() {
  return { posts: 0, points: 0, mine: [] };
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
    return saved;
  }
  const identity = saved.identity ?? {};
  const feed = saved.feed.map(({ authorId, handle, ...post }) => post);
  const mine = saved.feed.filter((post) => identity.id && post.authorId === identity.id).map((post) => post.id);
  return { feed, device: { posts: identity.posts ?? mine.length, points: identity.points ?? 0, mine } };
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
    id: `sample-${n}`, topic, company, text, createdHour: roundToHour(now - hoursAgo * HOUR_MS), upvotes,
  });
  return [
    post(1, 'interviews', 'Swiggy', 'Backend round 2 was a design question: rate-limit an API for 1M users. They cared more about trade-offs than the final answer.', 3, 41),
    post(2, 'offers', null, 'Got two offers as a 2-year Java dev in Bengaluru: 18 and 21 LPA. Negotiating with the second offer in writing worked.', 26, 87),
    post(3, 'referrals', 'Flipkart', 'Referrals work best with a two-line note and the job link. Long messages get skipped.', 50, 23),
    post(4, 'culture', 'Zerodha', 'Small teams, very few meetings, and on-call is shared fairly. Good place to learn Linux deeply.', 75, 19),
  ];
}
