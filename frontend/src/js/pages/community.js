import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { PLACEHOLDER_LABELS, knownValues } from './privacy-guard-rules.js';
import { currentResume, isSavedState, sampleResume } from './resume-builder-rules.js';
import { addPoints, isWallet, sampleWallet, walletKey } from './wallet-rules.js';
import {
  ANONYMOUS,
  TOPICS,
  addPost,
  checkPost,
  filterFeed,
  isMine,
  migrateSaved,
  newDeviceTally,
  postAge,
  redeemPoints,
  sampleFeed,
  validatePost,
} from './community-rules.js';

// The community preview: a feed where every post is plain "Anonymous" (no handle, nothing that
// ties two posts together), posting with the identity check first, this device's private tally of
// its own posts and points, and moving points to the wallet. Everything lives in this browser only.

const USER_ID = getUser()?.id ?? 'guest';
const KEY = `coverlay.preview.community.${USER_ID}`;
const values = knownValues(builderResume());

let state = load();
let topic = null;
let checked = null; // the text the identity check last approved

if (requireAuth()) {
  hydrateIcons();
  renderShell('community');
  wire();
  render();
}

function builderResume() {
  const saved = readJson(`coverlay.resumeBuilder.${USER_ID}`);
  return isSavedState(saved) && saved.history ? currentResume(saved.history) : sampleResume();
}

function load() {
  // An older preview (posts with a mask handle) is converted: handles and author ids are dropped.
  const saved = migrateSaved(readJson(KEY));
  return saved ?? { feed: sampleFeed(Date.now()), device: newDeviceTally() };
}

function save() {
  writeJson(KEY, state);
}

function announce(text) {
  setText(byId('page-status'), text);
}

function wire() {
  byId('post-topic').replaceChildren(...TOPICS.map((t) => el('option', { value: t.id }, t.label)));
  byId('topic-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-topic]');
    if (chip) {
      topic = chip.dataset.topic || null;
      renderFeed();
    }
  });
  byId('compose-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitPost();
  });
  byId('post-text').addEventListener('input', () => {
    checked = null;
    show(byId('post-check'), false);
  });
  byId('use-safe').addEventListener('click', () => {
    byId('post-text').value = byId('check-safe').textContent;
    checked = byId('post-text').value.trim();
    show(byId('post-check'), false);
    submitPost();
  });
  byId('keep-mine').addEventListener('click', () => {
    show(byId('post-check'), false);
    byId('post-text').focus();
  });
  byId('redeem').addEventListener('click', () => {
    const { device, credits } = redeemPoints(state.device);
    if (!credits) {
      announce('No points to move yet.');
      return;
    }
    state.device = device;
    save();
    const key = walletKey(USER_ID);
    const saved = readJson(key);
    const wallet = isWallet(saved) ? saved : sampleWallet(Date.now());
    writeJson(key, addPoints(wallet, credits, Date.now()));
    setText(byId('redeem-note'), `${credits} points are on their way. In the preview they're in your Wallet already; the real batch arrives within a day.`);
    renderTally();
  });
}

function submitPost() {
  const text = byId('post-text').value.trim();
  const postTopic = byId('post-topic').value;
  const error = validatePost(text, postTopic);
  setText(byId('post-error'), error);
  if (error) {
    return;
  }
  if (checked !== text) {
    const check = checkPost(text, values);
    if (check.found.length) {
      const labels = [...new Set(check.found.map((key) => PLACEHOLDER_LABELS[key] ?? otherLabel(key)))];
      setText(byId('check-list'), labels.join(', '));
      setText(byId('check-safe'), check.safeText);
      show(byId('post-check'));
      return;
    }
  }
  const next = addPost(state.feed, state.device, { text, topic: postTopic, company: byId('post-company').value }, Date.now());
  state = { ...state, ...next };
  save();
  byId('compose-form').reset();
  checked = null;
  announce('Posted anonymously. +5 points.');
  render();
}

function otherLabel(key) {
  if (key.startsWith('other.email')) {
    return 'an email address';
  }
  return key.startsWith('other.phone') ? 'a phone number' : 'a link';
}

function render() {
  renderTally();
  renderFilters();
  renderFeed();
}

/** This device's own tally: it is private to this browser and no post carries it. */
function renderTally() {
  const { device } = state;
  setText(byId('tally-posts'), String(device.posts));
  setText(byId('tally-points'), String(device.points));
  byId('redeem').disabled = device.points <= 0;
}

function renderFilters() {
  byId('topic-filters').replaceChildren(
    el('button', { class: 'community-chip', type: 'button', 'data-topic': '', 'aria-pressed': String(topic === null) }, 'All'),
    ...TOPICS.map((t) => el('button', { class: 'community-chip', type: 'button', 'data-topic': t.id, 'aria-pressed': String(topic === t.id) }, t.label)),
  );
}

function renderFeed() {
  for (const chip of byId('topic-filters').querySelectorAll('[data-topic]')) {
    chip.setAttribute('aria-pressed', String((chip.dataset.topic || null) === topic));
  }
  const now = Date.now();
  const posts = filterFeed(state.feed, topic);
  byId('feed').replaceChildren(
    ...(posts.length
      ? posts.map((post) =>
          el('li', { class: 'card community-post' },
            el('div', { class: 'community-post-head' },
              el('span', { class: 'avatar community-avatar', 'aria-hidden': 'true' }, icon('lock')),
              el('div', {},
                // Every post has the same author line. "You" is worked out on this device only, from its own list.
                el('p', { class: 'community-post-handle' }, ANONYMOUS, isMine(state.device, post) ? el('span', { class: 'badge badge-violet', title: 'Only you can see this label' }, 'You') : null),
                el('p', { class: 'field-hint' }, [TOPICS.find((t) => t.id === post.topic)?.label, post.company, postAge(post.createdHour, now)].filter(Boolean).join(' · ')))),
            el('p', { class: 'community-post-text' }, post.text),
            el('p', { class: 'field-hint' }, `${post.upvotes} found this useful`)))
      : [el('li', { class: 'empty' }, 'No posts on this topic yet.')]),
  );
}
