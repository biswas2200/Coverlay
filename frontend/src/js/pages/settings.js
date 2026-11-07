import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import {
  CONSENTS,
  EXPORT_CONTENTS,
  advanceDeletion,
  beginPurge,
  canUndo,
  defaultConsents,
  deletionStatusText,
  regionFromTimeZone,
  startDeletion,
  tombstone,
} from './settings-rules.js';
import { CONNECTORS, connectionsKey, connectorById, emptyConnections, isConnected, normalizeConnections, setConnected, statusLabel } from './connections-rules.js';

// Settings & privacy preview: account, phone change with a sample OTP, consents (EU/UK opt-in,
// opt-out elsewhere), the connected apps (shared with the Letters page), export, and the delete-account job shown step by step.

const USER = getUser();
const KEY = `coverlay.preview.settings.${USER?.id ?? 'guest'}`;
const CONNECTIONS_KEY = connectionsKey(USER?.id);
const TICK_MS = 900;
const SAMPLE_OTP = '123456';

let state = load();
let connections = normalizeConnections(readJson(CONNECTIONS_KEY));
let ticker = 0;
let otpSent = false;

if (requireAuth()) {
  hydrateIcons();
  renderShell('settings');
  wire();
  render();
  if (state.job?.status === 'running') {
    run();
  }
}

function load() {
  const saved = readJson(KEY);
  if (saved && typeof saved === 'object' && saved.consents) {
    return saved;
  }
  const region = regionFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  return { region, consents: defaultConsents(region), job: null };
}

function save() {
  writeJson(KEY, state);
}

function announce(text) {
  setText(byId('page-status'), text);
}

function wire() {
  byId('region').addEventListener('change', (event) => {
    state.region = event.target.value;
    state.consents = { ...state.consents, ...defaultConsents(state.region) };
    save();
    renderPrivacy();
  });
  byId('consents').addEventListener('change', (event) => {
    const key = event.target.dataset.consent;
    if (key) {
      state.consents[key] = event.target.checked;
      save();
      announce(`${CONSENTS.find((c) => c.key === key).label} ${event.target.checked ? 'on' : 'off'}.`);
    }
  });
  byId('phone-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const phone = byId('new-phone').value.replace(/[\s-]/g, '');
    if (!otpSent) {
      if (!/^\+?\d{10,15}$/.test(phone)) {
        setText(byId('phone-error'), 'Enter a mobile number with its country code, like +91 98765 43210.');
        return;
      }
      otpSent = true;
      setText(byId('phone-error'), '');
      show(byId('otp-field'));
      setText(byId('phone-submit'), 'Verify');
      byId('otp').focus();
      return;
    }
    if (byId('otp').value.trim() !== SAMPLE_OTP) {
      setText(byId('phone-error'), "That code doesn't match. In the preview it's 123456.");
      return;
    }
    setText(byId('acct-phone'), `${phone.slice(0, 3)} ••••• ••${phone.slice(-3)}`);
    setText(byId('phone-error'), '');
    show(byId('otp-field'), false);
    otpSent = false;
    setText(byId('phone-submit'), 'Send code');
    byId('phone-form').reset();
    announce('Phone number changed.');
  });
  byId('apps').addEventListener('click', (event) => {
    const button = event.target.closest('[data-app]');
    if (!button) {
      return;
    }
    const connect = button.dataset.do === 'connect';
    connections = setConnected(connections, button.dataset.app, connect);
    writeJson(CONNECTIONS_KEY, connections);
    renderApps();
    announce(`${connectorById(button.dataset.app).label} ${connect ? 'connected (a sample: nothing is linked in the preview)' : 'disconnected'}.`);
  });
  byId('export').addEventListener('click', () => show(byId('export-note')));
  byId('delete-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!byId('delete-password').value) {
      setText(byId('delete-error'), 'Enter your password to confirm.');
      return;
    }
    setText(byId('delete-error'), '');
    const mode = new FormData(byId('delete-form')).get('mode');
    state.job = startDeletion({ mode, deletePosts: byId('delete-posts').checked }, Date.now());
    save();
    renderJob();
    if (state.job.status === 'running') {
      run();
    }
  });
  byId('undo-delete').addEventListener('click', () => {
    state.job = null;
    save();
    announce('Your account is kept.');
    renderJob();
  });
  byId('skip-wait').addEventListener('click', () => {
    state.job = beginPurge(state.job, Date.now());
    save();
    renderJob();
    run();
  });
  byId('reset-delete').addEventListener('click', () => {
    clearInterval(ticker);
    state.job = null;
    save();
    renderJob();
  });
}

/** The preview's worker: one step per tick; the search step fails once to show the retry. */
function run() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    state.job = advanceDeletion(state.job, { failing: ['search'] });
    save();
    renderJob();
    if (state.job.status === 'done') {
      clearInterval(ticker);
      // The "Connected apps" step of the job: every app is disconnected.
      connections = emptyConnections();
      writeJson(CONNECTIONS_KEY, connections);
      renderApps();
    }
  }, TICK_MS);
}

function render() {
  setText(byId('acct-email'), USER?.email ?? '');
  renderApps();
  renderPrivacy();
  byId('export-list').replaceChildren(...EXPORT_CONTENTS.map((item) => el('li', {}, icon('check'), el('span', {}, item))));
  renderJob();
}

/** One row per service: its name, whether it is linked, what it is for, what it asks for, and the one thing to do. */
function renderApps() {
  byId('apps').replaceChildren(
    ...CONNECTORS.map((connector) => {
      const linked = isConnected(connections, connector.id);
      const action = connector.status === 'connectable'
        ? el('button', { class: `btn btn-sm ${linked ? 'btn-secondary' : 'btn-primary'}`, type: 'button', 'data-app': connector.id, 'data-do': linked ? 'disconnect' : 'connect' },
          linked ? `Disconnect ${connector.label}` : `Connect ${connector.label}`)
        : connector.href ? el('a', { class: 'btn btn-secondary btn-sm', href: connector.href }, connector.linkLabel) : null;
      return el('li', { class: `settings-app is-${connector.status}` },
        el('div', { class: 'settings-app-head' },
          el('span', { class: 'settings-app-name' }, el('strong', {}, connector.label), connector.detail ? el('span', { class: 'field-hint' }, connector.detail) : null),
          el('span', { class: `badge ${linked ? 'badge-green' : ''}` }, statusLabel(connector, connections))),
        el('p', { class: 'settings-app-text' }, connector.does),
        connector.asks ? el('p', { class: 'field-hint' }, `Asks for: ${connector.asks}`) : null,
        connector.note ? el('p', { class: 'field-hint' }, connector.note) : null,
        action);
    }),
  );
}

function renderPrivacy() {
  byId('region').value = state.region;
  setText(byId('region-note'), state.region === 'EU/UK'
    ? 'In the EU and UK these start off: you choose to turn them on.'
    : 'These start on; you can turn each one off at any time.');
  byId('consents').replaceChildren(
    ...CONSENTS.map((consent) =>
      el('li', {},
        el('label', { class: 'settings-toggle' },
          el('input', { type: 'checkbox', role: 'switch', 'data-consent': consent.key, checked: Boolean(state.consents[consent.key]) }),
          el('span', { class: 'settings-switch', 'aria-hidden': 'true' }),
          el('span', {}, el('strong', {}, consent.label), el('span', { class: 'field-hint' }, consent.hint)))),
    ),
  );
}

function renderJob() {
  const job = state.job;
  show(byId('delete-start'), !job);
  show(byId('delete-job'), Boolean(job));
  if (!job) {
    return;
  }
  const now = Date.now();
  setText(byId('job-status'), deletionStatusText(job, now));
  byId('job-status').className = `settings-job-status is-${job.status}`;
  byId('job-steps').replaceChildren(
    ...job.steps.map((step) =>
      el('li', { class: `settings-step is-${step.state}` },
        el('span', { class: 'settings-step-icon', 'aria-hidden': 'true' }, step.state === 'done' ? icon('check') : step.state === 'retrying' ? icon('refresh') : el('span', { class: 'sb-dot' })),
        el('span', {}, step.label),
        el('span', { class: 'field-hint' }, step.state === 'retrying' ? `retry ${step.attempts}` : step.state === 'done' ? 'done' : 'waiting'))),
  );
  show(byId('undo-delete'), canUndo(job, now));
  show(byId('skip-wait'), job.status === 'scheduled');
  show(byId('reset-delete'), job.status === 'done');
  const stone = tombstone(job, '7f3a…c21e');
  show(byId('tombstone-box'), Boolean(stone));
  if (stone) {
    setText(byId('tombstone'), JSON.stringify(stone, null, 2));
  }
}
