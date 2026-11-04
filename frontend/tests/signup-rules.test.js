import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyticsDefault, emailState, finalStepError, normalizePhone, otpValid, validPassword } from '../src/js/pages/signup-rules.js';

test('email states: free, being deleted, invalid', () => {
  assert.equal(emailState('new@example.com'), 'free');
  assert.equal(emailState(' Deleting@Example.com '), 'deleting');
  assert.equal(emailState('not-an-email'), 'invalid');
});

test('phone, code, password and the last step', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '+919876543210');
  assert.equal(normalizePhone('98765-43210'), '+919876543210');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(otpValid(' 123456 '), true);
  assert.equal(otpValid('000000'), false);
  assert.equal(validPassword('short'), false);
  assert.equal(validPassword('long enough'), true);
  assert.equal(analyticsDefault('EU/UK'), false);
  assert.equal(analyticsDefault('Other'), true);
  assert.match(finalStepError({ adult: false, terms: true }), /18/);
  assert.match(finalStepError({ adult: true, terms: false }), /Terms/);
  assert.equal(finalStepError({ adult: true, terms: true }), null);
});
