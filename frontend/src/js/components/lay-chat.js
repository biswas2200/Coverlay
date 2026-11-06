import { el } from '../core/dom.js';
import { icon } from './icons.js';

// Lay AI as a floating chat on a page that is not the Resume Builder: the black-square button
// with the white triangle (bottom right), and a panel docked to the right edge that opens over
// it. The page supplies `answer(text)`, which returns `{ reply, actions? }`: an action is a button
// in the message (`{ label, primary?, run() }`, where `run` may return a line to show after).
// Lay AI only proposes: nothing changes until the person presses an action. In the preview the
// answers come from the page's own data with no AI call, and nothing is stored.

const TYPING_MS = 650;

// Static markup written here, never data from anywhere else.
const MARK =
  '<svg class="lay-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#000"/>'
  + '<path class="lay-tri" d="M16 8.5 25 23.5H7z" fill="#fff"/></svg>';

function mark() {
  const holder = document.createElement('span');
  holder.innerHTML = MARK;
  return holder.firstElementChild;
}

/**
 * Adds the Lay AI button and chat panel to the page. `prompts` are the quick questions under the
 * messages. Returns `{ open, close }`.
 */
export function mountLayChat({ sub, greeting, prompts = [], answer }) {
  const messages = el('ul', { class: 'lay-messages', role: 'log', 'aria-live': 'polite' });
  const input = el('input', { class: 'input', id: 'lay-chat-input', maxlength: '300', autocomplete: 'off', placeholder: 'Ask Lay AI…' });
  const form = el('form', { class: 'lay-form' }, el('label', { class: 'sr-only', for: 'lay-chat-input' }, 'Ask Lay AI'), input, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Send'));
  const close = el('button', { class: 'icon-btn lay-close', type: 'button', 'aria-label': 'Close Lay AI' }, icon('close'));

  const panel = el(
    'aside',
    { class: 'lay-panel lay-dock', id: 'lay-chat', 'aria-label': 'Lay AI', hidden: true },
    el(
      'div',
      { class: 'lay-panel-head' },
      el('span', { class: 'lay-avatar', 'aria-hidden': 'true' }, mark()),
      el('div', {}, el('p', { class: 'lay-title' }, 'Lay AI'), el('p', { class: 'lay-sub' }, sub)),
      close,
    ),
    el(
      'div',
      { class: 'lay-body' },
      messages,
      el('div', { class: 'lay-suggestions' }, ...prompts.map((text) => el('button', { class: 'lay-suggestion', type: 'button', 'data-prompt': text }, text))),
      form,
    ),
  );

  const fab = el(
    'button',
    { class: 'lay-fab', type: 'button', 'aria-controls': 'lay-chat', 'aria-expanded': 'false' },
    el('span', { class: 'lay-hi', 'aria-hidden': 'true' }, 'Hi!'),
    el('span', { class: 'lay-orb' }, mark()),
    el('span', { class: 'lay-name' }, 'Lay AI'),
  );

  let busy = false;

  const scrollDown = () => {
    messages.scrollTop = messages.scrollHeight;
  };
  const say = (who, text, extra = []) => {
    const item = el('li', { class: `lay-msg ${who}` }, text, ...extra);
    messages.append(item);
    scrollDown();
    return item;
  };

  function sayLay(result) {
    const buttons = (result.actions ?? []).map((action) => el('button', { class: `btn btn-sm ${action.primary ? 'btn-primary' : 'btn-secondary'}`, type: 'button' }, action.label));
    const row = buttons.length ? el('div', { class: 'lay-msg-actions' }, ...buttons) : null;
    say('from-lay', result.reply, row ? [row] : []);
    (result.actions ?? []).forEach((action, index) => {
      buttons[index].addEventListener('click', () => {
        buttons.forEach((button) => {
          button.disabled = true;
        });
        const done = action.run();
        if (typeof done === 'string' && done) {
          say('from-lay', done);
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
    say('from-you', typed);
    input.value = '';
    const typing = say('from-lay is-typing', 'Lay AI is thinking…');
    await new Promise((resolve) => setTimeout(resolve, TYPING_MS));
    typing.remove();
    sayLay(answer(typed));
    busy = false;
  }

  function open() {
    panel.hidden = false;
    fab.hidden = true;
    fab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('lay-docked');
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
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
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

  say('from-lay', greeting);
  document.body.append(panel, fab);
  return { open, close: shut };
}
