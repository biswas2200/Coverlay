import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addPoints,
  applyRecharge,
  creditsFor,
  emptyWallet,
  formatRupees,
  groupHistory,
  isWallet,
  journeyCost,
  journeysCovered,
  lowBalanceWarning,
  MAX_RECHARGE,
  MIN_RECHARGE,
  rupeesFor,
  sampleWallet,
  spend,
  validateRecharge,
} from '../src/js/pages/wallet-rules.js';

test('one full journey costs 282 credits, about ₹28', () => {
  const journey = journeyCost();
  assert.equal(journey.credits, 282);
  assert.equal(journey.rupees, 28.2);
  assert.deepEqual(journey.rows.map((r) => r.credits), [8, 90, 75, 54, 55]);
});

test('the smallest recharge covers two journeys; the largest about a month of heavy use', () => {
  assert.equal(journeysCovered(MIN_RECHARGE), 2);
  assert.equal(creditsFor(MAX_RECHARGE), 20000);
  // 10 applications a day: tailored resume, cover letter, cold email and 5 messages each.
  const perDay = 10 * (25 + 18 + 11 + 5 * 3);
  assert.ok(creditsFor(MAX_RECHARGE) / perDay >= 28, 'about a month');
});

test('validateRecharge keeps amounts whole and between ₹60 and ₹2,000', () => {
  assert.equal(validateRecharge(100), null);
  assert.match(validateRecharge(59), /smallest/);
  assert.match(validateRecharge(2001), /largest/);
  assert.match(validateRecharge(99.5), /Whole rupees/);
  assert.match(validateRecharge(Number('x')), /Enter/);
});

test('recharge adds credits, spend takes them, and never below zero', () => {
  let wallet = applyRecharge(emptyWallet(), 60, 1);
  assert.equal(wallet.balance, 600);
  wallet = spend(wallet, 'tailor', 2);
  assert.equal(wallet.balance, 575);
  assert.equal(wallet.history[0].credits, -25);
  const poor = { balance: 10, history: [] };
  assert.equal(spend(poor, 'tailor', 3), poor, 'too little: nothing is charged');
  assert.equal(applyRecharge(wallet, 10, 4), wallet, 'an invalid recharge changes nothing');
});

test('lowBalanceWarning names what the balance can no longer pay for', () => {
  assert.equal(lowBalanceWarning(5000), null);
  assert.match(lowBalanceWarning(200), /less than one full journey/);
  assert.match(lowBalanceWarning(10), /resume tailored to a job, cover letter and cold email/);
  assert.match(lowBalanceWarning(20), /pay for a resume tailored to a job\./);
});

test('points, formatting and the sample wallet add up', () => {
  assert.equal(addPoints(emptyWallet(), 5, 1).balance, 5);
  assert.equal(addPoints(emptyWallet(), 0, 1).balance, 0);
  assert.equal(formatRupees(1000), '₹1,000');
  assert.equal(formatRupees(28.2), '₹28.20');
  assert.equal(formatRupees(100000), '₹1,00,000');
  assert.equal(rupeesFor(282), 28.2);
  const sample = sampleWallet(Date.UTC(2026, 10, 4));
  assert.ok(isWallet(sample));
  assert.equal(sample.balance, sample.history.reduce((sum, e) => sum + e.credits, 0));
  assert.equal(isWallet({ balance: -1, history: [] }), false);
});

test('the history folds repeats of the same action on the same day into one row, and the balance does not change', () => {
  const noon = new Date(2026, 10, 7, 12, 0, 0).getTime();
  const wallet = sampleWallet(noon);
  assert.equal(wallet.history.length, 16, 'the sample has sixteen entries: a recharge, an analysis, twelve messages, a tailored resume and a cover letter');
  const rows = groupHistory(wallet.history);
  assert.deepEqual(rows.map((r) => [r.label, r.count, r.credits]), [
    ['Cover letter', 1, -18],
    ['Resume tailored to a job', 1, -25],
    ['Lay AI message', 12, -36],
    ['Resume analysis', 1, -8],
    ['Recharge ₹60', 1, 600],
  ], 'newest first, the twelve Lay AI messages one row of 12 × 3 credits');
  assert.equal(rows.reduce((sum, r) => sum + r.credits, 0), wallet.balance, 'grouping changes the list, never the money');
  assert.equal(rows.at(2).at, Math.max(...wallet.history.filter((e) => e.label === 'Lay AI message').map((e) => e.at)), 'a row is as recent as its latest entry');
});

test('the same action on another day, or another kind with the same words, is another row; the input is not changed', () => {
  const day = 24 * 60 * 60 * 1000;
  const noon = new Date(2026, 10, 7, 12, 0, 0).getTime();
  const history = [
    { kind: 'spend', label: 'Lay AI message', credits: -3, at: noon },
    { kind: 'spend', label: 'Resume analysis', credits: -8, at: noon - 60_000 },
    { kind: 'spend', label: 'Lay AI message', credits: -3, at: noon - 120_000 },
    { kind: 'spend', label: 'Lay AI message', credits: -3, at: noon - day },
    { kind: 'points', label: 'Lay AI message', credits: 5, at: noon - 180_000 },
  ];
  const copy = structuredClone(history);
  assert.deepEqual(groupHistory(history).map((r) => [r.kind, r.label, r.count, r.credits]), [
    ['spend', 'Lay AI message', 2, -6],
    ['spend', 'Resume analysis', 1, -8],
    ['spend', 'Lay AI message', 1, -3],
    ['points', 'Lay AI message', 1, 5],
  ], 'two messages today are one row even with an analysis between them; yesterday and a different kind stay apart');
  assert.deepEqual(history, copy);
  assert.deepEqual(groupHistory([]), []);
});
