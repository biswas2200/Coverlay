import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DAY_MS, sampleApplications } from '../src/js/pages/applications-rules.js';
import { emptyWallet, sampleWallet } from '../src/js/pages/wallet-rules.js';
import {
  SAMPLE_FINDS,
  chipsFor,
  findApplication,
  freshConversation,
  intentOf,
  portalLinks,
  prepareCost,
  reminderDue,
  sampleApplicationId,
  statusReply,
  step,
} from '../src/js/pages/lay-assistant-rules.js';

const NOW = Date.UTC(2026, 10, 5, 10);
const ctx = () => ({ apps: sampleApplications(NOW), wallet: sampleWallet(NOW), now: NOW });

test('typed messages map to intents, and "I applied" is not "apply for"', () => {
  assert.equal(intentOf("What's the status for AI engineer intern?"), 'status');
  assert.equal(intentOf('I applied'), 'applied');
  assert.equal(intentOf("I've just applied, thanks"), 'applied');
  assert.equal(intentOf('apply for the Zerodha one'), 'prepare');
  assert.equal(intentOf('find me new ones'), 'find');
  assert.equal(intentOf('yes go ahead'), 'confirm');
  assert.equal(intentOf('not now'), 'later');
  assert.equal(intentOf('hello'), 'help');
});

test('the status question finds the tracked application and answers in the owner\'s words', () => {
  const app = findApplication(sampleApplications(NOW), 'status for AI engineer intern?');
  assert.equal(app.company, 'Swiggy');
  assert.match(statusReply(app, NOW), /^Boss, your application is still pending\. Want me to find a new one\?/);
  assert.match(statusReply(app, NOW), /applied 9 days ago/);
  assert.match(statusReply(null, NOW), /haven't tracked any applications/);
});

test('find lists sample roles and links LinkedIn and Naukri instead of searching them', () => {
  const { conv, replies } = step(freshConversation(), { intent: 'find' }, ctx());
  assert.equal(conv.stage, 'found');
  assert.equal(replies[0].kind, 'jobs');
  assert.equal(replies[0].jobs.length, SAMPLE_FINDS.length);
  assert.deepEqual(portalLinks('AI engineer intern').map((l) => l.label), ['LinkedIn Jobs', 'Naukri']);
  assert.match(portalLinks('AI engineer intern')[1].url, /naukri\.com\/ai-engineer-intern-jobs$/);
});

test('prepare shows the price first and spends nothing until confirmed', () => {
  const start = ctx();
  const found = step(freshConversation(), { intent: 'find' }, start).conv;
  const quoted = step(found, { intent: 'prepare', jobId: 'find-1' }, start);
  assert.equal(quoted.conv.stage, 'quote');
  assert.equal(quoted.wallet.balance, start.wallet.balance);
  assert.equal(quoted.apps.length, start.apps.length);
  assert.equal(prepareCost().credits, 43);
  assert.match(quoted.replies[0].text, /43 credits \(₹4\.30\)/);
});

test('confirm spends the credits, adds the application to Preparing, and never applies', () => {
  const start = ctx();
  const quote = step(step(freshConversation(), { intent: 'find' }, start).conv, { intent: 'prepare', jobId: 'find-1' }, start).conv;
  const done = step(quote, { intent: 'confirm' }, start);
  assert.equal(done.conv.stage, 'prepared');
  assert.equal(done.wallet.balance, start.wallet.balance - 43);
  assert.equal(done.apps[0].company, 'Zerodha');
  assert.equal(done.apps[0].status, 'PREPARING');
  assert.deepEqual(done.replies.map((r) => r.kind), ['package', 'ready']);
  assert.match(done.replies[1].text, /press Apply yourself\. I never apply for you\./);
});

test('a low wallet stops the preparation and points to Wallet', () => {
  const start = { ...ctx(), wallet: emptyWallet() };
  const quote = step(freshConversation(), { intent: 'find' }, start).conv;
  const done = step(step(quote, { intent: 'prepare' }, start).conv, { intent: 'confirm' }, start);
  assert.equal(done.conv.stage, 'quote');
  assert.equal(done.replies[0].kind, 'wallet');
  assert.equal(done.apps.length, start.apps.length);
});

test('"I applied" moves the prepared application to Applied with the portal id', () => {
  const start = ctx();
  let { conv, apps, wallet } = step(freshConversation(), { intent: 'find' }, start);
  ({ conv, apps, wallet } = step(conv, { intent: 'prepare', jobId: 'find-2' }, { apps, wallet, now: NOW }));
  ({ conv, apps, wallet } = step(conv, { intent: 'confirm' }, { apps, wallet, now: NOW }));
  const later = NOW + DAY_MS;
  const applied = step(conv, { text: 'I applied' }, { apps, wallet, now: later });
  const app = applied.apps.find((a) => a.company === 'Razorpay' && a.role === 'ML Engineer Intern');
  assert.equal(app.status, 'APPLIED');
  assert.equal(app.externalId, sampleApplicationId(SAMPLE_FINDS[1]));
  assert.match(app.externalId, /^APP-\d{5}$/);
  assert.equal(applied.conv.appliedAt, later);
  assert.equal(reminderDue(applied.conv, later + 5 * DAY_MS), null);
});

test('the reminder comes once, three days after preparing, only if not applied', () => {
  const conv = { ...freshConversation(), stage: 'prepared', chosen: SAMPLE_FINDS[0], preparedAt: NOW };
  assert.equal(reminderDue(conv, NOW + 2 * DAY_MS), null);
  assert.match(reminderDue(conv, NOW + 3 * DAY_MS), /Zerodha application 3 days ago/);
  assert.equal(reminderDue({ ...conv, reminded: true }, NOW + 4 * DAY_MS), null);
});

test('the quick replies follow the conversation', () => {
  assert.equal(chipsFor(freshConversation())[0].intent, 'status');
  assert.deepEqual(chipsFor({ stage: 'quote' }).map((c) => c.intent), ['confirm', 'later']);
  assert.deepEqual(chipsFor({ stage: 'prepared' }).map((c) => c.intent), ['applied', 'later']);
});
