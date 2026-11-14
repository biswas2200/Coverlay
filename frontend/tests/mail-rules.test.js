import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ATTACHMENT_FORMATS, LIMITS, MAIL_PROVIDERS, SAMPLE_GMAIL, attachmentName, blanksIn, buildMailRequest, cleanRecipient, cleanSubject, describeBlank, mailSummary } from '../src/js/pages/mail-rules.js';

const good = { action: 'draft', to: 'Priya.Sharma@Swiggy.in', subject: 'Backend Engineer at Swiggy', body: 'Hi Priya,\n\nI am applying.', attachments: [{ kind: 'resume', format: 'pdf' }, { kind: 'cover', format: 'docx' }] };

test('only Gmail is available for now, and Outlook is listed for later', () => {
  assert.deepEqual(MAIL_PROVIDERS.map((p) => [p.id, p.available]), [['gmail', true], ['outlook', false]]);
  const refused = buildMailRequest({ ...good, provider: 'outlook' }, 'Jane Doe');
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Outlook is not available yet\. Gmail is\./);
  assert.match(buildMailRequest({ ...good, provider: 'yahoo' }).error, /not available yet/);
});

test('one clean address, lower-cased; a list, a name with brackets or anything else is refused', () => {
  assert.equal(cleanRecipient(' Priya.Sharma@Swiggy.in '), 'priya.sharma@swiggy.in');
  assert.equal(cleanRecipient('a+jobs@sub.example.co.uk'), 'a+jobs@sub.example.co.uk');
  for (const bad of ['', null, 'priya', 'priya@', '@swiggy.in', 'a@b', 'a@b.c', 'a@b.com, c@d.com', 'a@b.com;c@d.com', 'Priya <a@b.com>', 'a b@c.com', 'a@b.com\nBcc: x@y.com', `${'a'.repeat(250)}@b.com`]) {
    assert.equal(cleanRecipient(bad), null, JSON.stringify(bad));
  }
});

test('a subject is one line: a line break could add a header to the message', () => {
  assert.equal(cleanSubject('  Backend   Engineer\r\nBcc: x@y.com  '), 'Backend Engineer Bcc: x@y.com');
  assert.equal(cleanSubject('a b'), 'a b');
  assert.equal(cleanSubject('x'.repeat(500)).length, LIMITS.subject);
  assert.equal(cleanSubject(null), '');
  const made = buildMailRequest({ ...good, subject: 'Hello\r\nBcc: spy@evil.com' });
  assert.equal(made.ok, true);
  assert.doesNotMatch(made.request.subject, /[\r\n]/);
});

test('a draft can wait for the address; a send cannot', () => {
  const draft = buildMailRequest({ ...good, to: '' }, 'Jane Doe');
  assert.equal(draft.ok, true);
  assert.equal(draft.request.to, null);
  assert.equal(draft.request.action, 'draft');
  const send = buildMailRequest({ ...good, action: 'send', to: '' }, 'Jane Doe');
  assert.equal(send.ok, false);
  assert.match(send.error, /Add the address to send to/);
  assert.match(buildMailRequest({ ...good, action: 'send', to: 'a@b.com, c@d.com' }).error, /one email address/);
  assert.match(buildMailRequest({ ...good, action: 'draft', to: 'not an address' }).error, /one email address/, 'a wrong address is refused even for a draft');
  assert.match(buildMailRequest({ ...good, action: 'forward' }).error, /save a draft or to send/);
});

test('the email needs a subject and a body, and not too much', () => {
  assert.match(buildMailRequest({ ...good, subject: '  ' }).error, /needs a subject/);
  assert.match(buildMailRequest({ ...good, body: ' \n ' }).error, /email is empty/);
  assert.match(buildMailRequest({ ...good, body: 'x'.repeat(LIMITS.body + 1) }).error, /too long/);
});

test('the resume and the cover letter go in the same message, once each, named after the person', () => {
  const made = buildMailRequest({ ...good, attachments: [...good.attachments, { kind: 'resume', format: 'docx' }] }, 'Jane Doe');
  assert.deepEqual(made.request.attachments, [
    { kind: 'resume', format: 'pdf', fileName: 'Jane-Doe-Resume.pdf' },
    { kind: 'cover', format: 'docx', fileName: 'Jane-Doe-Cover-Letter.docx' },
  ]);
  assert.equal(buildMailRequest({ ...good, attachments: [] }).request.attachments.length, 0, 'no attachments is allowed');
  assert.deepEqual(ATTACHMENT_FORMATS, ['pdf', 'docx']);
  for (const bad of [{ kind: 'invoice', format: 'pdf' }, { kind: 'resume', format: 'exe' }, { kind: 'resume' }]) {
    assert.match(buildMailRequest({ ...good, attachments: [bad] }).error, /not something Coverlay can attach/);
  }
  assert.equal(attachmentName('cover', 'pdf', '../../Jane'), 'Jane-Cover-Letter.pdf');
});

test('the request is cleaned: the address lower-case, text trimmed, nothing else carried over', () => {
  const made = buildMailRequest({ ...good, body: '  Hi.  \n', extra: 'ignored', cc: 'x@y.com' }, 'Jane Doe');
  assert.deepEqual(Object.keys(made.request).sort(), ['action', 'attachments', 'body', 'provider', 'subject', 'to']);
  assert.equal(made.request.to, 'priya.sharma@swiggy.in');
  assert.equal(made.request.body, 'Hi.');
  assert.equal(made.request.provider, 'gmail');
});

test('the summary says exactly what will happen', () => {
  const draft = buildMailRequest(good, 'Jane Doe').request;
  assert.equal(mailSummary(draft, SAMPLE_GMAIL), `Save in the Drafts of ${SAMPLE_GMAIL} for priya.sharma@swiggy.in with 2 attachments (Resume PDF, Cover letter DOCX). Nothing is sent.`);
  const send = buildMailRequest({ ...good, action: 'send', attachments: [{ kind: 'resume', format: 'pdf' }] }, 'Jane Doe').request;
  assert.equal(mailSummary(send, SAMPLE_GMAIL), `Send from ${SAMPLE_GMAIL} to priya.sharma@swiggy.in with one attachment (Resume PDF).`);
  const bare = buildMailRequest({ ...good, to: '', attachments: [] }, 'Jane Doe').request;
  assert.equal(mailSummary(bare, SAMPLE_GMAIL), `Save in the Drafts of ${SAMPLE_GMAIL} with no attachments. Nothing is sent.`);
  // After it ran, the same sentence in the past tense.
  assert.equal(mailSummary(send, SAMPLE_GMAIL, { done: true }), `Sent from ${SAMPLE_GMAIL} to priya.sharma@swiggy.in with one attachment (Resume PDF).`);
  assert.equal(mailSummary(draft, SAMPLE_GMAIL, { done: true }), `Saved in the Drafts of ${SAMPLE_GMAIL} for priya.sharma@swiggy.in with 2 attachments (Resume PDF, Cover letter DOCX). Nothing was sent.`);
});

test('the formatted email travels with the plain one, written one way, and only the resume\'s small markup survives', () => {
  const made = buildMailRequest({ ...good, body: 'Hi Priya, see my notes.', bodyMarkup: 'Hi <i><b>Priya</b></i>, see <a href="javascript:alert(1)">my notes</a><script>x</script>.' }, 'Jane Doe');
  assert.equal(made.ok, true);
  assert.equal(made.request.body, 'Hi Priya, see my notes.');
  assert.equal(made.request.bodyMarkup, 'Hi <b><i>Priya</i></b>, see my notes&lt;script&gt;x&lt;/script&gt;.', 'canonical order, the unsafe link dropped, the tag turned into text');
  assert.equal('bodyMarkup' in buildMailRequest(good).request, false, 'no markup, no field');
  assert.match(buildMailRequest({ ...good, bodyMarkup: 'x'.repeat(LIMITS.markup + 1) }).error, /too long/);
});

test('a draft can keep a blank, a send cannot', () => {
  const blank = { ...good, subject: 'Platform Engineer at [Company]', body: 'Hi there, my profile is at {user.link}.' };
  assert.deepEqual(blanksIn(`${blank.subject}\n${blank.body}`), ['[Company]', '{user.link}']);
  assert.equal(buildMailRequest({ ...blank, action: 'draft' }, 'Jane Doe').ok, true, 'saved in Drafts, where the person can finish it');
  const refused = buildMailRequest({ ...blank, action: 'send' }, 'Jane Doe');
  assert.equal(refused.ok, false);
  assert.match(refused.error, /still has a blank to fill in: \[Company\] \(the company name\), \{user\.link\} \(your link\)/);
  assert.equal(buildMailRequest({ ...good, action: 'send' }, 'Jane Doe').ok, true, 'a finished email sends');
});

test('blanks are found once each, and described in words', () => {
  assert.deepEqual(blanksIn('a [Company] b [Company] {other.person_1} {user.phone}'), ['[Company]', '{other.person_1}', '{user.phone}']);
  assert.deepEqual(blanksIn('Dear team, {not a placeholder} and [Other]'), []);
  assert.deepEqual(blanksIn(null), []);
  assert.equal(describeBlank('[Company]'), 'the company name');
  assert.equal(describeBlank('{user.link}'), 'your link');
  assert.equal(describeBlank('{other.person_1}'), 'a detail');
});
