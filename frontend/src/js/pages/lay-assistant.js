import { byId, el, setText } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { DAY_MS, isApplicationList, sampleApplications } from './applications-rules.js';
import { isWallet, sampleWallet, walletKey } from './wallet-rules.js';
import { OPENERS, chipsFor, freshConversation, reminderDue, step } from './lay-assistant-rules.js';

// Lay AI on the phone (preview): the conversation runs through step() in the rules module. It
// shares the Applications board and the Wallet with the other preview pages through this
// browser's storage, so a prepared and applied role shows up on the board, paid for in credits.

const USER_ID = getUser()?.id ?? 'guest';
const KEY = `coverlay.preview.assistant.${USER_ID}`;
const APPS_KEY = `coverlay.preview.applications.${USER_ID}`;
const REPLY_DELAY_MS = 450;

let state = load();
let busy = false;

if (requireAuth()) {
  hydrateIcons();
  renderShell('assistant');
  wire();
  render();
}

function load() {
  const saved = readJson(KEY);
  if (saved && saved.conv && Array.isArray(saved.messages)) {
    return saved;
  }
  return { conv: freshConversation(), messages: [{ from: 'lay', text: OPENERS[1], kind: 'opener' }], clockDays: 0 };
}

function save() {
  state.messages = state.messages.slice(-60);
  writeJson(KEY, state);
}

/** The preview's clock: real time plus the days "3 days later" added. */
function now() {
  return Date.now() + state.clockDays * DAY_MS;
}

function apps() {
  const saved = readJson(APPS_KEY);
  return isApplicationList(saved) ? saved : sampleApplications(Date.now());
}

function wallet() {
  const saved = readJson(walletKey(USER_ID));
  return isWallet(saved) ? saved : sampleWallet(Date.now());
}

function wire() {
  byId('phone-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = byId('phone-input');
    const text = input.value.trim();
    if (text) {
      input.value = '';
      send({ text }, text);
    }
  });
  byId('phone-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-intent]');
    if (chip) {
      send({ intent: chip.dataset.intent, jobId: chip.dataset.job }, chip.textContent);
    }
  });
  byId('phone-messages').addEventListener('click', (event) => {
    const prepare = event.target.closest('[data-prepare]');
    if (prepare) {
      send({ intent: 'prepare', jobId: prepare.dataset.prepare }, `Prepare ${prepare.dataset.title}`);
    }
  });
  byId('later-3d').addEventListener('click', () => {
    state.clockDays += 3;
    const reminder = reminderDue(state.conv, now());
    if (reminder) {
      state.conv = { ...state.conv, reminded: true };
      state.messages.push({ from: 'lay', text: reminder, kind: 'reminder' });
    }
    save();
    render();
  });
  byId('reset-chat').addEventListener('click', () => {
    state = { conv: freshConversation(), messages: [{ from: 'lay', text: OPENERS[1], kind: 'opener' }], clockDays: 0 };
    save();
    render();
  });
}

function send(input, shownText) {
  if (busy) {
    return;
  }
  busy = true;
  state.messages.push({ from: 'you', text: shownText });
  render(true);
  setTimeout(() => {
    const result = step(state.conv, input, { apps: apps(), wallet: wallet(), now: now() });
    state.conv = result.conv;
    state.messages.push(...result.replies);
    writeJson(APPS_KEY, result.apps);
    writeJson(walletKey(USER_ID), result.wallet);
    busy = false;
    save();
    render();
    byId('phone-input').focus();
  }, REPLY_DELAY_MS);
}

function render(typing = false) {
  const list = byId('phone-messages');
  const items = state.messages.map(renderMessage);
  if (typing) {
    items.push(el('li', { class: 'pmsg from-lay is-typing' }, 'Lay AI is typing…'));
  }
  list.replaceChildren(...items);
  list.scrollTop = list.scrollHeight;
  byId('phone-chips').replaceChildren(
    ...chipsFor(state.conv).map((chip) =>
      el('button', { class: 'lay-suggestion', type: 'button', 'data-intent': chip.intent, 'data-job': chip.jobId ?? null }, chip.label)),
  );
  setText(byId('clock-note'), state.clockDays ? `The preview's clock is ${state.clockDays} days ahead.` : '');
}

function renderMessage(message) {
  if (message.from === 'you') {
    return el('li', { class: 'pmsg from-you' }, message.text);
  }
  const bubble = el('li', { class: `pmsg from-lay${message.kind ? ` is-${message.kind}` : ''}` });
  if (message.kind === 'reminder') {
    bubble.append(el('span', { class: 'pmsg-tag' }, icon('clock'), 'Reminder'));
  }
  bubble.append(el('p', {}, message.text));
  if (message.kind === 'jobs') {
    bubble.append(
      el('ul', { class: 'pjobs' }, ...message.jobs.map((job) =>
        el('li', { class: 'pjob' },
          el('div', {}, el('strong', {}, job.title), el('span', {}, `${job.company} · ${job.source}`)),
          el('span', { class: 'pjob-match mono' }, `${job.match}%`),
          el('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-prepare': job.id, 'data-title': job.title }, 'Prepare')))),
      el('p', { class: 'plinks' }, 'Look yourself: ', ...message.links.flatMap((link, i) => [
        i ? ' · ' : '',
        el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer' }, link.label),
      ])),
    );
  }
  if (message.kind === 'package') {
    bubble.append(el('ul', { class: 'ppack' },
      el('li', {}, icon('check'), 'Resume v4: summary and skills ordered for this role'),
      el('li', {}, icon('check'), 'Cover letter: 3 short paragraphs from your resume'),
      el('li', {}, el('a', { href: 'resume-builder.html' }, 'Open the resume'), ' · ', el('a', { href: 'letters.html' }, 'Open the letter'))));
  }
  if (message.kind === 'ready') {
    bubble.append(el('a', { class: 'btn btn-primary btn-sm pready', href: message.job.applyUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), `Open ${message.job.company}'s apply page`));
  }
  if (message.kind === 'tracked') {
    bubble.append(el('a', { class: 'plink-board', href: 'applications.html' }, 'See it on the Applications board'));
  }
  if (message.kind === 'wallet') {
    bubble.append(el('a', { class: 'plink-board', href: 'wallet.html' }, 'Open Wallet'));
  }
  return bubble;
}
