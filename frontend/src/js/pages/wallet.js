import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { relativeTime } from './resume-builder-rules.js';
import {
  ACTIONS,
  FREE_ACTIONS,
  MAX_RECHARGE,
  MIN_RECHARGE,
  RECHARGE_OPTIONS,
  applyRecharge,
  creditsFor,
  formatRupees,
  isWallet,
  journeyCost,
  journeysCovered,
  lowBalanceWarning,
  rupeesFor,
  sampleWallet,
  spend,
  validateRecharge,
  walletKey,
} from './wallet-rules.js';

// The wallet preview: balance, recharge (sample payment), the price of every action, what one
// full journey costs, and the history. The balance lives in this browser only.

const KEY = walletKey(getUser()?.id);
let wallet = load();
let amount = 100;

if (requireAuth()) {
  hydrateIcons();
  renderShell('wallet');
  wire();
  render();
}

function load() {
  const saved = readJson(KEY);
  return isWallet(saved) ? saved : sampleWallet(Date.now());
}

function save() {
  writeJson(KEY, wallet);
}

function wire() {
  byId('recharge-options').addEventListener('change', (event) => {
    if (event.target.name === 'amount') {
      amount = Number(event.target.value);
      byId('recharge-custom').value = '';
      renderRecharge();
    }
  });
  byId('recharge-custom').addEventListener('input', (event) => {
    const value = event.target.value.trim();
    amount = value === '' ? 100 : Number(value);
    for (const input of byId('recharge-options').querySelectorAll('input')) {
      input.checked = value === '' && Number(input.value) === amount;
    }
    renderRecharge();
  });
  byId('recharge-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const error = validateRecharge(amount);
    setText(byId('recharge-error'), error);
    if (error) {
      byId('recharge-custom').focus();
      return;
    }
    wallet = applyRecharge(wallet, amount, Date.now());
    save();
    const done = byId('recharge-done');
    setText(done, `Paid ${formatRupees(amount)} (sample). ${creditsFor(amount)} credits added.`);
    show(done);
    render();
  });
  byId('try-actions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-spend]');
    if (!button) {
      return;
    }
    const before = wallet;
    wallet = spend(wallet, button.dataset.spend, Date.now());
    if (wallet === before) {
      setText(byId('page-status'), 'Not enough credits for that.');
    }
    save();
    render();
  });
  byId('reset-wallet').addEventListener('click', () => {
    wallet = sampleWallet(Date.now());
    save();
    show(byId('recharge-done'), false);
    render();
  });
}

function render() {
  renderBalance();
  renderRecharge();
  renderPrices();
  renderJourney();
  renderHistory();
}

function renderBalance() {
  setText(byId('balance-credits'), new Intl.NumberFormat('en-IN').format(wallet.balance));
  const journeys = Math.floor(wallet.balance / journeyCost().credits);
  setText(byId('balance-rupees'), `Worth ${formatRupees(rupeesFor(wallet.balance))} · about ${journeys} full ${journeys === 1 ? 'journey' : 'journeys'}`);
  const warning = lowBalanceWarning(wallet.balance);
  setText(byId('low-balance'), warning);
  show(byId('low-balance'), Boolean(warning));
  byId('try-actions').replaceChildren(
    ...ACTIONS.slice(0, 3).map((action) =>
      el('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-spend': action.id, disabled: wallet.balance < action.credits },
        `${action.label} · ${action.credits}`),
    ),
  );
}

function renderRecharge() {
  const options = byId('recharge-options');
  if (!options.children.length) {
    options.replaceChildren(
      ...RECHARGE_OPTIONS.map((value) =>
        el('label', { class: 'rb-choice' },
          el('input', { type: 'radio', name: 'amount', value, checked: value === amount }),
          el('span', { class: 'mono' }, formatRupees(value))),
      ),
    );
  }
  const error = validateRecharge(amount);
  const gets = byId('recharge-gets');
  if (error) {
    setText(gets, `Choose ${formatRupees(MIN_RECHARGE)} to ${formatRupees(MAX_RECHARGE)}.`);
  } else {
    const journeys = journeysCovered(amount);
    setText(gets, `You get ${new Intl.NumberFormat('en-IN').format(creditsFor(amount))} credits: about ${journeys} full ${journeys === 1 ? 'journey' : 'journeys'}.`);
  }
  setText(byId('recharge-error'), '');
  const pay = byId('recharge-pay');
  setText(pay, error ? 'Pay' : `Pay ${formatRupees(amount)} (sample)`);
}

function renderPrices() {
  byId('price-list').replaceChildren(
    ...ACTIONS.map((action) =>
      el('li', {},
        el('div', {}, el('p', { class: 'wallet-price-name' }, action.label), el('p', { class: 'field-hint' }, action.note)),
        el('p', { class: 'wallet-price mono' }, `${action.credits} credits`, el('span', { class: 'muted' }, formatRupees(rupeesFor(action.credits))))),
    ),
  );
  byId('free-list').replaceChildren(...FREE_ACTIONS.map((label) => el('li', {}, icon('check'), el('span', {}, label))));
}

function renderJourney() {
  const journey = journeyCost();
  setText(byId('journey-total'), `${journey.credits} credits · ${formatRupees(journey.rupees)}`);
  byId('journey-rows').replaceChildren(
    ...journey.rows.map((row) =>
      el('tr', {}, el('td', {}, row.action.label), el('td', { class: 'mono' }, `${row.count} × ${row.action.credits}`), el('td', { class: 'mono' }, String(row.credits))),
    ),
    el('tr', { class: 'wallet-total' }, el('td', {}, 'Total'), el('td'), el('td', { class: 'mono' }, String(journey.credits))),
  );
}

function renderHistory() {
  const now = Date.now();
  const list = byId('history');
  if (wallet.history.length === 0) {
    list.replaceChildren(el('li', { class: 'muted' }, 'Nothing yet.'));
    return;
  }
  list.replaceChildren(
    ...wallet.history.slice(0, 30).map((entry) =>
      el('li', {},
        el('span', { class: 'tl-what' }, entry.label),
        el('span', { class: `mono wallet-delta ${entry.credits > 0 ? 'is-plus' : ''}` }, `${entry.credits > 0 ? '+' : ''}${entry.credits}`),
        el('span', { class: 'tl-when' }, relativeTime(entry.at, now))),
    ),
  );
}
