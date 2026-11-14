import { byId, el, setText, show } from '../core/dom.js';
import { readJson, writeJson } from '../core/local-store.js';
import { getUser, requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { defaultConsents, regionFromTimeZone } from './settings-rules.js';
import { addToHistory, searchCompanies, searchEvent, suggest } from './search-rules.js';

// Search with suggestions (preview): suggestions as you type (popular searches with 20+ people,
// community topics, your own history), companies on Search, and what analytics would keep.

const USER_ID = getUser()?.id ?? 'guest';
const KEY = `coverlay.preview.search.${USER_ID}`;
const SUBJECT = '7f3a…c21e';

let state = load();
let active = -1; // keyboard position in the suggestion list

if (requireAuth()) {
  hydrateIcons();
  renderShell('search');
  wire();
  renderHistory();
  renderStore(null);
}

function load() {
  const saved = readJson(KEY);
  return saved && Array.isArray(saved.history) ? { watched: [], ...saved } : { history: [], watched: [] };
}

function save() {
  writeJson(KEY, state);
}

/** Analytics consent from the Settings preview, or the region default. */
function consent() {
  const settings = readJson(`coverlay.preview.settings.${USER_ID}`);
  if (settings?.consents) {
    return Boolean(settings.consents.analytics);
  }
  return defaultConsents(regionFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)).analytics;
}

function wire() {
  const input = byId('search-input');
  input.addEventListener('input', () => renderSuggestions(input.value));
  input.addEventListener('focus', () => renderSuggestions(input.value));
  input.addEventListener('keydown', onKeys);
  byId('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch(input.value);
  });
  byId('suggestions').addEventListener('mousedown', (event) => event.preventDefault());
  byId('suggestions').addEventListener('click', (event) => {
    const option = event.target.closest('[data-query]');
    if (option) {
      input.value = option.dataset.query;
      runSearch(option.dataset.query);
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#search-form')) {
      closeSuggestions();
    }
  });
  byId('clear-history').addEventListener('click', () => {
    state.history = [];
    save();
    renderHistory();
    setText(byId('page-status'), 'Search history cleared.');
  });
  byId('history').addEventListener('click', (event) => {
    const item = event.target.closest('[data-query]');
    if (item) {
      input.value = item.dataset.query;
      runSearch(item.dataset.query);
    }
  });
  byId('results').addEventListener('click', (event) => {
    const watch = event.target.closest('[data-watch]');
    if (watch) {
      const name = watch.dataset.watch;
      state.watched = state.watched.includes(name) ? state.watched.filter((n) => n !== name) : [...state.watched, name];
      save();
      runSearch(byId('search-input').value, { keepHistory: true });
    }
  });
}

function onKeys(event) {
  const options = [...byId('suggestions').querySelectorAll('[data-query]')];
  // Escape closes the list first; only a second Escape clears the box (the search input's own
  // clearing fires "input", which would open the list again).
  if (event.key === 'Escape') {
    if (!byId('suggestions').hidden) {
      event.preventDefault();
      closeSuggestions();
    }
    return;
  }
  if (!options.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
    return;
  }
  if (event.key === 'Enter' && active >= 0) {
    event.preventDefault();
    options[active].click();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    active = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
    byId('search-input').setAttribute('aria-activedescendant', options[active].id);
  }
}

function closeSuggestions() {
  show(byId('suggestions'), false);
  byId('search-input').setAttribute('aria-expanded', 'false');
  active = -1;
}

function renderSuggestions(typed) {
  const found = suggest(typed, { history: state.history });
  const box = byId('suggestions');
  let n = 0;
  const option = (query, label, meta) => {
    n += 1;
    return el('button', { class: 'search-option', type: 'button', role: 'option', id: `opt-${n}`, 'aria-selected': 'false', 'data-query': query },
      el('span', {}, label), meta ? el('span', { class: 'search-meta' }, meta) : null);
  };
  const groups = [];
  if (found.history.length) {
    groups.push(el('p', { class: 'search-group' }, icon('clock'), 'Your recent searches'),
      ...found.history.map((h) => option(h.query, h.query, null)));
  }
  if (found.popular.length || found.hidden) {
    groups.push(el('p', { class: 'search-group' }, icon('users'), 'Popular in the last 30 days'),
      ...found.popular.map((p) => option(p.query, p.query, `${p.people} people`)));
    if (found.hidden) {
      groups.push(el('p', { class: 'search-hidden' }, `${found.hidden} smaller ${found.hidden === 1 ? 'search stays' : 'searches stay'} hidden (under 20 people)`));
    }
  }
  if (found.topics.length) {
    groups.push(el('p', { class: 'search-group' }, icon('sparkle'), 'From community posts'),
      ...found.topics.map((t) => option(t.label, t.label, `${t.posts} ${t.posts === 1 ? 'post' : 'posts'}`)));
  }
  box.replaceChildren(...groups);
  active = -1;
  show(box, groups.length > 0);
  byId('search-input').setAttribute('aria-expanded', String(groups.length > 0));
}

function runSearch(query, { keepHistory = false } = {}) {
  closeSuggestions();
  const results = searchCompanies(query);
  if (!keepHistory) {
    state.history = addToHistory(state.history, query, Date.now());
    save();
    renderHistory();
    renderStore(query);
  }
  setText(byId('results-note'), query.trim()
    ? (results.length ? `${results.length} ${results.length === 1 ? 'company' : 'companies'} for "${query.trim()}"` : `No companies match "${query.trim()}". Try another spelling.`)
    : 'Type to see suggestions; press Search for companies.');
  byId('results').replaceChildren(
    ...results.map((company) => {
      const watching = state.watched.includes(company.name);
      return el('li', { class: 'card search-company' },
        el('div', { class: 'search-company-head' },
          el('span', { class: 'avatar search-logo', 'aria-hidden': 'true' }, company.name.slice(0, 2).toUpperCase()),
          el('div', {}, el('h3', {}, company.name), el('p', { class: 'muted' }, `${company.field} · ${company.city}`))),
        el('p', { class: 'search-jobs' }, el('strong', { class: 'mono' }, String(company.openJobs)), ' open jobs'),
        el('div', { class: 'row' },
          el('a', { class: 'btn btn-secondary btn-sm', href: `jobs.html` }, 'See jobs'),
          el('button', { class: `btn btn-sm ${watching ? 'btn-primary' : 'btn-ghost'}`, type: 'button', 'data-watch': company.name, 'aria-pressed': String(watching) },
            icon('eye'), watching ? 'Watching' : 'Watch')));
    }),
  );
}

function renderHistory() {
  const list = byId('history');
  list.replaceChildren(
    ...(state.history.length
      ? state.history.slice(0, 8).map((h) => el('li', {}, el('button', { class: 'rb-link', type: 'button', 'data-query': h.query }, icon('clock'), h.query)))
      : [el('li', { class: 'muted' }, 'Nothing yet.')]),
  );
}

function renderStore(query) {
  const allowed = consent();
  setText(byId('store-note'), allowed
    ? 'Analytics is on in Settings, so the search is kept under your random analytics id, never your name or email.'
    : 'Analytics is off in Settings, so nothing is kept for analytics. Your private history above still works.');
  const event = query ? searchEvent(query, { consent: allowed, subjectId: SUBJECT }) : null;
  setText(byId('store-event'), event ? JSON.stringify(event, null, 2) : 'Search for something to see the record.');
}
