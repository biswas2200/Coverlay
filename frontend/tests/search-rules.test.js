import { test } from 'node:test';
import assert from 'node:assert/strict';

import { K_MIN } from '../src/js/pages/team-insights-rules.js';
import {
  MAX_HISTORY,
  POPULAR_SAMPLE,
  addToHistory,
  communityTopics,
  normalizeQuery,
  searchCompanies,
  searchEvent,
  similarity,
  suggest,
} from '../src/js/pages/search-rules.js';

const NOW = Date.UTC(2026, 10, 5, 10);

test('a stored query has no emails, links or phone numbers', () => {
  assert.equal(normalizeQuery('  Backend   Developer  '), 'backend developer');
  assert.equal(normalizeQuery('swiggy jane.doe@example.com'), 'swiggy');
  assert.equal(normalizeQuery('call +91 98765 43210 zerodha'), 'call zerodha');
  assert.equal(normalizeQuery('see https://example.com/jobs?id=1 razorpay'), 'see razorpay');
  assert.equal(normalizeQuery('C++ & C# <dev>'), 'c++ c# dev');
  assert.equal(normalizeQuery('x'.repeat(200)).length, 80);
});

test('popular suggestions need 20 people; the rest are only counted', () => {
  const all = suggest('', { topics: [] });
  assert.ok(all.popular.every((p) => p.people >= K_MIN));
  assert.equal(all.popular.length, 5);
  assert.equal(all.hidden, POPULAR_SAMPLE.filter((p) => p.people < K_MIN).length);
  const swiggy = suggest('swi', { topics: [] });
  assert.deepEqual(swiggy.popular.map((p) => p.query), ['swiggy']);
  assert.equal(swiggy.hidden, 1);
});

test('suggestions match the start of any word', () => {
  assert.deepEqual(suggest('dev', { topics: [] }).popular.map((p) => p.query), ['backend developer bengaluru', 'remote react developer', 'devops engineer']);
  assert.deepEqual(suggest('zzz', { topics: [] }).popular, []);
});

test('community topics come from the feed, most posted first', () => {
  const feed = [
    { topic: 'interviews', company: 'Swiggy' },
    { topic: 'interviews', company: 'Swiggy' },
    { topic: 'interviews', company: 'Zerodha' },
    { topic: 'offers', company: null },
  ];
  assert.deepEqual(communityTopics(feed), [
    { label: 'Interview experience', posts: 3 },
    { label: 'Swiggy', posts: 2 },
    { label: 'Salary & offers', posts: 1 },
    { label: 'Zerodha', posts: 1 },
  ]);
});

test('history keeps the newest first, no duplicates, at most 50', () => {
  let history = addToHistory([], 'Swiggy', NOW);
  history = addToHistory(history, 'zerodha', NOW + 1);
  history = addToHistory(history, '  SWIGGY ', NOW + 2);
  assert.deepEqual(history.map((h) => h.query), ['swiggy', 'zerodha']);
  assert.equal(addToHistory(history, '   ', NOW), history);
  for (let i = 0; i < 70; i += 1) {
    history = addToHistory(history, `query ${i}`, NOW + i);
  }
  assert.equal(history.length, MAX_HISTORY);
  assert.deepEqual(suggest('quer', { history, topics: [] }).history.length, 5);
});

test('company search ranks name prefixes first and tolerates typos', () => {
  assert.equal(searchCompanies('swi')[0].name, 'Swiggy');
  assert.equal(searchCompanies('swigy')[0].name, 'Swiggy');
  assert.equal(searchCompanies('zerodah')[0].name, 'Zerodha');
  assert.ok(searchCompanies('payments').some((c) => c.name === 'Razorpay'));
  assert.deepEqual(searchCompanies(''), []);
  assert.deepEqual(searchCompanies('qqqqq'), []);
  assert.equal(similarity('swiggy', 'swiggy'), 1);
  assert.ok(similarity('swigy', 'swiggy') >= 0.3);
});

test('analytics keeps nothing without consent, and never personal details', () => {
  assert.equal(searchEvent('swiggy', { consent: false, subjectId: 'a' }), null);
  assert.equal(searchEvent('   ', { consent: true, subjectId: 'a' }), null);
  assert.deepEqual(searchEvent('Swiggy me@example.com', { consent: true, subjectId: '7f3a' }), {
    name: 'search', subject_id: '7f3a', properties: { query_norm: 'swiggy' },
  });
});
