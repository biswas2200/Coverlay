import { el } from '../core/dom.js';
import { icon } from './icons.js';

// Lay AI as a floating chat on every signed-in page except the Resume Builder (which has its own panel): the
// black-square button with the white triangle (bottom right), and a panel docked to the right edge that opens over
// it. The page supplies `answer(text)`, which returns (or resolves to) `{ reply, actions?, card? }`: an action is a
// button in the message (`{ label, primary?, run() }`, where `run` may return a line, or another
// `{ reply, actions?, card? }`, to show after); a `card` is a drafted email shown as a quoted block.
// Lay AI only proposes: nothing changes until the person presses an action.
//
// The box takes several lines (Enter sends, Shift+Enter adds a line) and up to MAX_INPUT characters, so a job
// description can be pasted into it. The conversation is kept on this device between pages when the page gives
// `history` ({ load(), save(list) }); what is kept goes through `encode` first (the personal-data guard) and comes
// back through `decode`, and a long message is kept only as its first lines, never the whole paste.

const TYPING_MS = 650;
export const MAX_INPUT = 6000;
const SHORT_AT = 360;
const SHORT_KEEP = 300;

// Static markup written here, never data from anywhere else.
const MARK =
  '<svg class="lay-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#000"/>'
  + '<path class="lay-tri" d="M16 8.5 25 23.5H7z" fill="#fff"/></svg>';

function mark() {
  const holder = document.createElement('span');
  holder.innerHTML = MARK;
  return holder.firstElementChild;
}

/** What a message looks like in the chat and in the history: a long paste is cut to its first lines. */
export function shortened(text) {
  const body = String(text ?? '');
  if (body.length <= SHORT_AT) {
    return body;
  }
  const words = body.split(/\s+/).filter(Boolean).length;
  return `${body.slice(0, SHORT_KEEP).trimEnd()}…\n(${words} words in all)`;
}

/**
 * Adds the Lay AI button and chat panel to the page. `prompts` are the quick questions under the messages.
 * Returns `{ open, close, setPage }`; `setPage({ sub, greeting, prompts, answer })` lets a page add its own answers.
 */
export function mountLayChat({ sub, greeting, prompts = [], answer, history = null, encode = (text) => text, decode = (text) => text }) {
  let page = { sub, greeting, prompts, answer };
  const messages = el('ul', { class: 'lay-messages', role: 'log', 'aria-live': 'polite' });
  const input = el('textarea', {
    class: 'input lay-input', id: 'lay-chat-input', rows: '1', maxlength: String(MAX_INPUT), autocomplete: 'off',
    placeholder: 'Ask Lay AI, or paste a job description…',
  });
  const form = el('form', { class: 'lay-form' }, el('label', { class: 'sr-only', for: 'lay-chat-input' }, 'Ask Lay AI'), input, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Send'));
  const close = el('button', { class: 'icon-btn lay-close', type: 'button', 'aria-label': 'Close Lay AI' }, icon('close'));
  const clear = el('button', { class: 'btn btn-ghost btn-sm lay-clear', type: 'button', hidden: true }, 'New chat');
  const subtitle = el('p', { class: 'lay-sub' }, page.sub);
  const suggestions = el('div', { class: 'lay-suggestions' });

  const panel = el(
    'aside',
    { class: 'lay-panel lay-dock', id: 'lay-chat', 'aria-label': 'Lay AI', hidden: true },
    el(
      'div',
      { class: 'lay-panel-head' },
      el('span', { class: 'lay-avatar', 'aria-hidden': 'true' }, mark()),
      el('div', {}, el('p', { class: 'lay-title' }, 'Lay AI'), subtitle),
      clear,
      close,
    ),
    el('div', { class: 'lay-body' }, messages, suggestions, form),
  );

  const fab = el(
    'button',
    { class: 'lay-fab', type: 'button', 'aria-controls': 'lay-chat', 'aria-expanded': 'false' },
    el('span', { class: 'lay-hi', 'aria-hidden': 'true' }, 'Hi!'),
    el('span', { class: 'lay-orb' }, mark()),
    el('span', { class: 'lay-name' }, 'Lay AI'),
  );

  let busy = false;
  let log = []; // what is on screen and kept: { who: 'you' | 'lay', text, card? }, real values

  const scrollDown = () => {
    messages.scrollTop = messages.scrollHeight;
  };

  function persist() {
    clear.hidden = log.length === 0;
    history?.save(log.map(({ who, text, card }) => ({
      who,
      text: encode(text),
      ...(card ? { card: { subject: encode(card.subject), body: encode(card.body) } } : {}),
    })));
  }

  function cardNode(card) {
    return el('div', { class: 'lay-card' }, el('p', { class: 'lay-card-subject' }, el('span', { class: 'lay-card-label' }, 'Subject'), card.subject), el('p', { class: 'lay-card-body' }, card.body));
  }

  function say(who, text, { extra = [], card = null, keep = false } = {}) {
    const item = el('li', { class: `lay-msg ${who === 'you' ? 'from-you' : 'from-lay'}${keep === 'typing' ? ' is-typing' : ''}` }, text, ...(card ? [cardNode(card)] : []), ...extra);
    messages.append(item);
    scrollDown();
    return item;
  }

  function remember(who, text, card = null) {
    log.push(card ? { who, text, card } : { who, text });
    log = log.slice(-60);
    persist();
  }

  function sayLay(result) {
    const actions = result.actions ?? [];
    const buttons = actions.map((item) => el('button', { class: `btn btn-sm ${item.primary ? 'btn-primary' : 'btn-secondary'}`, type: 'button' }, item.label));
    const row = buttons.length ? el('div', { class: 'lay-msg-actions' }, ...buttons) : null;
    say('lay', result.reply, { extra: row ? [row] : [], card: result.card ?? null });
    remember('lay', result.reply, result.card ?? null);
    actions.forEach((item, index) => {
      buttons[index].addEventListener('click', async () => {
        buttons.forEach((button) => {
          button.disabled = true;
        });
        const done = await item.run();
        if (typeof done === 'string' && done) {
          say('lay', done);
          remember('lay', done);
        } else if (done && typeof done === 'object' && done.reply) {
          sayLay(done);
        }
      });
    });
  }

  async function send(text) {
    const typed = String(text ?? '').trim();
    if (!typed || busy) {
      return;
    }
    busy = true;
    const shown = shortened(typed);
    say('you', shown);
    remember('you', shown);
    input.value = '';
    grow();
    const typing = say('lay', 'Lay AI is thinking…', { keep: 'typing' });
    await new Promise((resolve) => setTimeout(resolve, TYPING_MS));
    let result;
    try {
      result = await page.answer(typed);
    } catch (error) {
      console.error('Lay AI could not answer', error);
      result = { reply: 'Something went wrong on my side. Nothing was changed. Try again.' };
    }
    typing.remove();
    sayLay(result);
    busy = false;
  }

  function renderPrompts() {
    suggestions.replaceChildren(...page.prompts.map((text) => el('button', { class: 'lay-suggestion', type: 'button', 'data-prompt': text }, text)));
  }

  function renderAll() {
    messages.replaceChildren();
    if (!log.length) {
      say('lay', page.greeting);
    }
    for (const message of log) {
      say(message.who, message.text, { card: message.card ?? null });
    }
    clear.hidden = log.length === 0;
  }

  function grow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  }

  function open() {
    panel.hidden = false;
    fab.hidden = true;
    fab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('lay-docked');
    scrollDown();
    input.focus({ preventScroll: true });
  }
  function shut() {
    panel.hidden = true;
    fab.hidden = false;
    fab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('lay-docked');
    fab.focus({ preventScroll: true });
  }

  fab.addEventListener('click', open);
  close.addEventListener('click', shut);
  clear.addEventListener('click', () => {
    log = [];
    persist();
    renderAll();
    input.focus({ preventScroll: true });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
  });
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  panel.addEventListener('click', (event) => {
    const prompt = event.target.closest('[data-prompt]');
    if (prompt) {
      send(prompt.dataset.prompt);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden && !document.body.classList.contains('nav-open') && !document.querySelector('dialog[open]')) {
      shut();
    }
  });

  try {
    log = (history?.load() ?? []).map((message) => ({
      who: message.who,
      text: decode(message.text),
      ...(message.card ? { card: { subject: decode(message.card.subject), body: decode(message.card.body) } } : {}),
    }));
  } catch (error) {
    console.error('Could not read the Lay AI history', error);
    log = [];
  }
  renderPrompts();
  renderAll();
  document.body.append(panel, fab);

  return {
    open,
    close: shut,
    /** A page that knows more (the Applications board) adds its own answers, quick questions and greeting. */
    setPage(next) {
      const hadNone = log.length === 0;
      page = { ...page, ...next };
      subtitle.textContent = page.sub;
      renderPrompts();
      if (hadNone) {
        renderAll();
      }
    },
  };
}
