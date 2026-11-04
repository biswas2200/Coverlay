// The anonymous community (preview, sample data). Each account gets one mask identity a month:
// a key pair made on the device, stamped by Coverlay without Coverlay seeing it (a blind
// signature), so nobody -- not us, not Google -- can link a post to an account. Posts show a
// random handle and the hour, rounded. Points earned by posts move to the wallet in small
// batches at random times, so amounts and timing don't point back to the post.
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

const ADJECTIVES = ['Teal', 'Quiet', 'Amber', 'Swift', 'Cobalt', 'Sage', 'Brave', 'Misty', 'Coral', 'Lunar'];
const ANIMALS = ['Falcon', 'Otter', 'Lynx', 'Heron', 'Panda', 'Koi', 'Fox', 'Ibis', 'Gecko', 'Wren'];

/** A random-looking handle from a seed (the identity's public-key hash in the real system). */
export function maskHandle(seed) {
  let hash = 2166136261;
  for (const ch of String(seed)) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  return `${ADJECTIVES[hash % ADJECTIVES.length]} ${ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length]}`;
}

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

/** The identity this device holds for the month: `{ id, handle, month, points, posts }`. */
export function newIdentity(seed, now) {
  const month = new Date(now).toISOString().slice(0, 7);
  return { id: `mask-${seed}`, handle: maskHandle(seed), month, points: 0, posts: 0 };
}

export function addPost(feed, identity, { text, topic, company }, now) {
  const post = {
    id: `post-${now.toString(36)}-${feed.length + 1}`,
    authorId: identity.id,
    handle: identity.handle,
    topic,
    company: String(company ?? '').trim().slice(0, 60) || null,
    text: String(text).trim(),
    createdHour: roundToHour(now),
    upvotes: 0,
  };
  return {
    feed: [post, ...feed],
    identity: { ...identity, points: identity.points + POINTS_PER_POST, posts: identity.posts + 1 },
  };
}

/** Points leave the identity for the wallet; the wallet gets them later, in a random batch. */
export function redeemPoints(identity) {
  if (identity.points <= 0) {
    return { identity, credits: 0 };
  }
  return { identity: { ...identity, points: 0 }, credits: identity.points };
}

export function filterFeed(feed, topic) {
  return topic ? feed.filter((p) => p.topic === topic) : feed;
}

export function sampleFeed(now) {
  const post = (n, topic, company, text, hoursAgo, upvotes) => ({
    id: `sample-${n}`, authorId: `sample-author-${n}`, handle: maskHandle(`sample-${n * 7}`), topic, company, text,
    createdHour: roundToHour(now - hoursAgo * HOUR_MS), upvotes,
  });
  return [
    post(1, 'interviews', 'Swiggy', 'Backend round 2 was a design question: rate-limit an API for 1M users. They cared more about trade-offs than the final answer.', 3, 41),
    post(2, 'offers', null, 'Got two offers as a 2-year Java dev in Bengaluru: 18 and 21 LPA. Negotiating with the second offer in writing worked.', 26, 87),
    post(3, 'referrals', 'Flipkart', 'Referrals work best with a two-line note and the job link. Long messages get skipped.', 50, 23),
    post(4, 'culture', 'Zerodha', 'Small teams, very few meetings, and on-call is shared fairly. Good place to learn Linux deeply.', 75, 19),
  ];
}
