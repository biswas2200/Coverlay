import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RECHARGE,
  MIN_RECHARGE,
  addPoints,
  applyRecharge,
  creditsFor,
  emptyWallet,
  formatRupees,
  isWallet,
  journeyCost,
  journeysCovered,
  lowBalanceWarning,
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
