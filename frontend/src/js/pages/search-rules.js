// Search with suggestions (preview, sample data). Suggestions come from three places: searches
// at least K_MIN (20) different people made in the last 30 days, topics from community posts,
// and the user's own private history (last 50, clearable). A search is stored for analytics
// under the analytics id only, with consent, and with emails, phone numbers and links removed.
// Company matching tolerates typos the way PostgreSQL's pg_trgm does (trigram similarity), which
// is what the backend will use. DOM-free so tests/search-rules.test.js can run it in Node.

import { TOPICS, sampleFeed } from './community-rules.js';
import { K_MIN } from './team-insights-rules.js';

export const MAX_HISTORY = 50;
export const MIN_SIMILARITY = 0.3;

/** Sample counts of different people per search over the last 30 days. Under 20 stays hidden. */
export const POPULAR_SAMPLE = [
  { query: 'swiggy', people: 132 },
  { query: 'backend developer bengaluru', people: 98 },
  { query: 'zerodha', people: 87 },
  { query: 'ai engineer intern', people: 64 },
  { query: 'razorpay', people: 61 },
  { query: 'data analyst fresher', people: 44 },
  { query: 'flipkart sde', people: 39 },
  { query: 'remote react developer', people: 26 },
  { query: 'devops engineer', people: 23 },
  { query: 'sarvam ai', people: 12 },
  { query: 'swiggy instamart operations', people: 8 },
  { query: 'kubernetes jobs pune', people: 6 },
];

export const COMPANIES_SAMPLE = [
  { name: 'Swiggy', city: 'Bengaluru', openJobs: 34, field: 'Food delivery' },
  { name: 'Zerodha', city: 'Bengaluru', openJobs: 9, field: 'Stock broking' },
  { name: 'Razorpay', city: 'Bengaluru', openJobs: 27, field: 'Payments' },
  { name: 'Flipkart', city: 'Bengaluru', openJobs: 58, field: 'E-commerce' },
  { name: 'Freshworks', city: 'Chennai', openJobs: 21, field: 'Business software' },
  { name: 'Zoho', city: 'Chennai', openJobs: 40, field: 'Business software' },
  { name: 'Meesho', city: 'Bengaluru', openJobs: 15, field: 'E-commerce' },
  { name: 'CRED', city: 'Bengaluru', openJobs: 11, field: 'Payments' },
  { name: 'PhonePe', city: 'Bengaluru', openJobs: 30, field: 'Payments' },
  { name: 'Groww', city: 'Bengaluru', openJobs: 13, field: 'Investing' },
  { name: 'Postman', city: 'Bengaluru', openJobs: 8, field: 'Developer tools' },
  { name: 'BrowserStack', city: 'Mumbai', openJobs: 12, field: 'Developer tools' },
];

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const LONG_NUMBER = /\+?\d[\d -]{8,}\d/g;

/** A query as it is stored: lower case, no emails, links or phone numbers, single spaces. */
export function normalizeQuery(query) {
  return String(query ?? '')
    .replace(EMAIL, ' ')
    .replace(LINK, ' ')
    .replace(LONG_NUMBER, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Whether `query` starts any word of `text` (so "back" matches "backend developer"). */
function matchesPrefix(text, query) {
  if (!query) {
    return true;
  }
  return text.startsWith(query) || text.split(' ').some((word) => word.startsWith(query));
}

/** Topics people post about, from the community feed: company names and topic labels. */
export function communityTopics(feed = sampleFeed(Date.now())) {
  const counts = new Map();
  for (const post of feed) {
    const label = TOPICS.find((t) => t.id === post.topic)?.label;
    for (const name of [post.company, label].filter(Boolean)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].map(([label, posts]) => ({ label, posts })).sort((a, b) => b.posts - a.posts || a.label.localeCompare(b.label));
}

/**
 * Suggestions for what is typed so far: `{ popular, hidden, topics, history }`. Popular searches
 * need K_MIN or more people; `hidden` counts the matching ones that don't, so the page can say so.
 */
export function suggest(typed, { popular = POPULAR_SAMPLE, topics = communityTopics(), history = [] } = {}) {
  const q = normalizeQuery(typed);
  const matching = popular.filter((p) => matchesPrefix(p.query, q));
  return {
    popular: matching.filter((p) => p.people >= K_MIN).sort((a, b) => b.people - a.people).slice(0, 5),
    hidden: matching.filter((p) => p.people < K_MIN).length,
    topics: topics.filter((t) => matchesPrefix(t.label.toLowerCase(), q)).slice(0, 4),
    history: history.filter((h) => matchesPrefix(h.query, q)).slice(0, 5),
  };
}

/** The history with this search first (no duplicates, at most MAX_HISTORY). */
export function addToHistory(history, query, at) {
  const q = normalizeQuery(query);
  if (!q) {
    return history;
  }
  return [{ query: q, at }, ...history.filter((h) => h.query !== q)].slice(0, MAX_HISTORY);
}

function trigrams(text) {
  const padded = `  ${String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** pg_trgm-style similarity: shared trigrams over all trigrams, from 0 to 1. */
export function similarity(a, b) {
  const x = trigrams(a);
  const y = trigrams(b);
  let shared = 0;
  for (const gram of x) {
    if (y.has(gram)) {
      shared += 1;
    }
  }
  const total = x.size + y.size - shared;
  return total ? shared / total : 0;
}

/** Companies for a query: name prefix first, then word prefix, then close spellings ("swigy"). */
export function searchCompanies(query, companies = COMPANIES_SAMPLE) {
  const q = normalizeQuery(query);
  if (!q) {
    return [];
  }
  return companies
    .map((company) => {
      const name = company.name.toLowerCase();
      let score = similarity(name, q);
      if (name.startsWith(q)) {
        score += 2;
      } else if (matchesPrefix(`${name} ${company.field.toLowerCase()} ${company.city.toLowerCase()}`, q)) {
        score += 1;
      }
      return { company, score };
    })
    .filter((r) => r.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score || b.company.openJobs - a.company.openJobs)
    .map((r) => r.company);
}

/** What analytics keeps for a search: nothing without consent, never personal details. */
export function searchEvent(query, { consent, subjectId }) {
  const q = normalizeQuery(query);
  if (!consent || !q) {
    return null;
  }
  return { name: 'search', subject_id: subjectId, properties: { query_norm: q } };
}
