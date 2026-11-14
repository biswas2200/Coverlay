import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { createAnswerer } from '@/lay/answer';
import { useLayPageConfig } from '@/lay/pageStore';
import { chatHistory, fillFor, guardFor, readEnvironment } from '@/lay/rules';
import { MAX_INPUT, shortened } from '@/lay/text';
import type { AnswerLike, ChatAction, ChatMessage } from '@/lay/types';
import { useBodyClass } from '@/lib/hooks';
import { Icon } from './Icon';
import { LayMark } from './LayMark';

// Lay AI as a floating chat on every signed-in page except the Builder (which has its own panel): the black-square
// button with the white triangle (bottom right), and a panel docked to the right edge that opens over it. Lay AI only
// proposes: nothing changes until the person presses an action. The box takes several lines (Enter sends,
// Shift+Enter adds a line) and up to MAX_INPUT characters, so a job description can be pasted into it. The
// conversation is kept on this device between pages, as the personal-data guard made it, and a long message is kept
// only as its first lines, never the whole paste.

const TYPING_MS = 650;
let counter = 0;
const newId = () => `m${Date.now().toString(36)}${(counter += 1)}`;

/** The kept conversation, filled in again for this screen (the placeholders become the person's own details). */
function loadLog(): ChatMessage[] {
  const fill = fillFor(readEnvironment().resume);
  return chatHistory.load().map((message) => ({
    id: newId(),
    who: message.who,
    text: fill(message.text),
    card: message.card ? { subject: fill(message.card.subject), body: fill(message.card.body) } : null,
    settled: true,
  }));
}

function MessageView({ message, onPress }: { message: ChatMessage; onPress: (message: ChatMessage, action: ChatAction) => void }) {
  return (
    <li className={`lay-msg ${message.who === 'you' ? 'from-you' : 'from-lay'}`}>
      {message.text}
      {message.card ? (
        <div className="lay-card">
          <p className="lay-card-subject">
            <span className="lay-card-label">Subject</span>
            {message.card.subject}
          </p>
          <p className="lay-card-body">{message.card.body}</p>
        </div>
      ) : null}
      {message.actions?.length ? (
        <div className="lay-msg-actions">
          {message.actions.map((action) => (
            <button key={action.label} className={`btn btn-sm ${action.primary ? 'btn-primary' : 'btn-secondary'}`} type="button" disabled={message.settled} onClick={() => onPress(message, action)}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function LayChat() {
  const navigate = useNavigate();
  const page = useLayPageConfig();
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<ChatMessage[]>(loadLog);
  const [thinking, setThinking] = useState(false);
  const [text, setText] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const answer = useMemo(() => createAnswerer(navigate), [navigate]);

  useBodyClass('lay-docked', open);

  // What is kept goes through the guard first; the buttons are not kept (a decision belongs to the moment it was asked).
  useEffect(() => {
    const encode = guardFor(readEnvironment().resume);
    chatHistory.save(
      log.map(({ who, text: body, card }) => ({
        who,
        text: encode(body).stored,
        ...(card ? { card: { subject: encode(card.subject).stored, body: encode(card.body).stored } } : {}),
      })),
    );
  }, [log]);

  useEffect(() => {
    if (open && list.current) {
      list.current.scrollTop = list.current.scrollHeight;
    }
  }, [log, thinking, open]);

  // The box grows to a few lines, then scrolls.
  useEffect(() => {
    const box = input.current;
    if (box) {
      box.style.height = 'auto';
      box.style.height = `${Math.min(box.scrollHeight, 150)}px`;
    }
  }, [text, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !document.body.classList.contains('nav-open') && !document.querySelector('dialog[open]')) {
        setOpen(false);
        fab.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const add = (message: Omit<ChatMessage, 'id'>) => setLog((current) => [...current, { id: newId(), ...message }].slice(-60));

  const addAnswer = (result: AnswerLike) => add({ who: 'lay', text: result.reply, card: result.card ?? null, actions: result.actions ?? [] });

  async function send(raw: string) {
    const typed = raw.trim();
    if (!typed || thinking) {
      return;
    }
    setThinking(true);
    add({ who: 'you', text: shortened(typed) });
    setText('');
    await new Promise((resolve) => setTimeout(resolve, TYPING_MS));
    let result: AnswerLike;
    try {
      result = await answer(typed);
    } catch (error) {
      console.error('Lay AI could not answer', error);
      result = { reply: 'Something went wrong on my side. Nothing was changed. Try again.' };
    }
    addAnswer(result);
    setThinking(false);
  }

  async function press(message: ChatMessage, action: ChatAction) {
    setLog((current) => current.map((m) => (m.id === message.id ? { ...m, settled: true } : m)));
    const done = await action.run();
    if (typeof done === 'string' && done) {
      add({ who: 'lay', text: done });
    } else if (done && typeof done === 'object') {
      addAnswer(done);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(text);
    }
  }

  function openPanel() {
    setOpen(true);
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  }

  return (
    <>
      <aside className="lay-panel lay-dock" id="lay-chat" aria-label="Lay AI" hidden={!open}>
        <div className="lay-panel-head">
          <span className="lay-avatar" aria-hidden="true"><LayMark /></span>
          <div>
            <p className="lay-title">Lay AI</p>
            <p className="lay-sub">{page.sub}</p>
          </div>
          {log.length > 0 ? (
            <button className="btn btn-ghost btn-sm lay-clear" type="button" onClick={() => setLog([])}>New chat</button>
          ) : null}
          <button
            className="icon-btn lay-close"
            type="button"
            aria-label="Close Lay AI"
            onClick={() => {
              setOpen(false);
              fab.current?.focus({ preventScroll: true });
            }}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="lay-body">
          <ul className="lay-messages" role="log" aria-live="polite" ref={list}>
            {log.length === 0 ? <li className="lay-msg from-lay">{page.greeting}</li> : null}
            {log.map((message) => (
              <MessageView key={message.id} message={message} onPress={press} />
            ))}
            {thinking ? <li className="lay-msg from-lay is-typing">Lay AI is thinking…</li> : null}
          </ul>
          <div className="lay-suggestions">
            {page.prompts.map((prompt) => (
              <button key={prompt} className="lay-suggestion" type="button" onClick={() => void send(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
          <form className="lay-form" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="lay-chat-input">Ask Lay AI</label>
            <textarea
              ref={input}
              className="input lay-input"
              id="lay-chat-input"
              rows={1}
              maxLength={MAX_INPUT}
              autoComplete="off"
              placeholder="Ask Lay AI, or paste a job description…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="btn btn-primary" type="submit">Send</button>
          </form>
        </div>
      </aside>
      <button ref={fab} className="lay-fab" type="button" aria-controls="lay-chat" aria-expanded={open} hidden={open} onClick={openPanel}>
        <span className="lay-hi" aria-hidden="true">Hi!</span>
        <span className="lay-orb"><LayMark /></span>
        <span className="lay-name">Lay AI</span>
      </button>
    </>
  );
}
