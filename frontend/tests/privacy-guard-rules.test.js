import { test } from 'node:test';
import assert from 'node:assert/strict';

import { guardText, knownValues, privacyNote, resolveText } from '../src/js/pages/privacy-guard-rules.js';
import { sampleResume } from '../src/js/pages/resume-builder-rules.js';

const values = knownValues(sampleResume());

test('knownValues reads the account values out of the resume', () => {
  assert.deepEqual(values, {
    'user.name': 'Jane Doe',
    'user.first_name': 'Jane',
    'user.email': 'jane@email.com',
    'user.phone': '+91 98765 43210',
    'user.college': 'VIT',
    'user.company': 'Acme Corp',
  });
  assert.deepEqual(knownValues(null), {});
});

test('guardText swaps personal details for placeholders, longest first, any case', () => {
  const { stored, found, vault } = guardText('Should I add the vit hackathon? Jane Doe here. Jane likes Java.', values);

  assert.equal(stored, 'Should I add the {user.college} hackathon? {user.name} here. {user.first_name} likes Java.');
  assert.deepEqual(found, ['user.college', 'user.name', 'user.first_name']);
  assert.equal(vault['user.college'], 'vit', 'the vault keeps exactly what was typed');
});

test('other people\'s emails, phones and links become numbered placeholders', () => {
  const { stored, found } = guardText('Mail rahul.k@gmail.com, call +91 99887 76655, see linkedin.com/in/rahul.', values);

  assert.equal(stored, 'Mail {other.email_1}, call {other.phone_1}, see {other.link_1}.');
  assert.deepEqual(found, ['other.email_1', 'other.phone_1', 'other.link_1']);
});

test('a date range is not a phone number, and words inside words are left alone', () => {
  assert.equal(guardText('At Acme Corp 2019 - 2021.', values).stored, 'At {user.company} 2019 - 2021.');
  assert.equal(guardText('Visited Vitoria, Janeiro.', values).stored, 'Visited Vitoria, Janeiro.');
});

test('resolveText fills placeholders from the vault, and with no vault they are null', () => {
  const typed = 'Should I add the VIT hackathon? I am Jane Doe.';
  const { stored, vault } = guardText(typed, values);

  assert.equal(resolveText(stored, vault), typed);
  assert.equal(resolveText(stored, null), 'Should I add the null hackathon? I am null.');
  assert.equal(resolveText('{user.name}', {}, (key) => `{${key}}`), '{user.name}');
});

test('privacyNote reads naturally', () => {
  assert.equal(privacyNote(['user.college']), 'Your college stays private.');
  assert.equal(privacyNote(['user.name', 'user.first_name', 'user.college']), 'Your name and your college stay private.');
  assert.equal(privacyNote(['other.email_1']), 'An email address stays private.');
  assert.equal(privacyNote([]), null);
});
