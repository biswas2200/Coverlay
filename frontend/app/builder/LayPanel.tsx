import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Icon } from '@/components/Icon';
import { LayMark } from '@/components/LayMark';
import { fillFor } from '@/lay/rules';
import { MAX_INPUT } from '@/lay/text';
import { readJson, writeJson } from '@/lib/storage';
import type { BuilderMessage, BuilderState, SuggestionItem } from '@/types/builder';
import type { Resume } from '@/types/resume';
import { privacyNote, resolveText } from '@legacy/pages/privacy-guard-rules.js';
import { parseInline, relativeTime, versionsNewestFirst, WRITING_STYLE_LABELS } from '@legacy/pages/resume-builder-rules.js';
import { PANEL_SIZE_KEY } from './model';

// The Lay AI panel beside the resume: Chat and Versions, with its edges to drag. The chat shows what the person typed (as
// their own screen sees it), Lay AI's replies, its suggestions (Add or Skip, one by one) and its proposals with buttons.

const GREETING = "Hi! I'm Lay AI. Tell me what to change in your resume, or edit it yourself on the left.";
const PROMPTS = [
  ['Fit my resume on one page', 'Fit on one page'],
  ['Make it fit a DevOps role', 'Fit a DevOps role'],
  ['Add Docker and Kubernetes to my skills', 'Add Docker and Kubernetes'],
  ['Shorten my summary', 'Shorten my summary'],
  ['Rewrite my summary for a senior backend role', 'Fit a senior backend role'],
] as const;

const markupText = (markup: string) => (parseInline(markup) as { text: string }[]).map((s) => s.text).join('');
const percent = (share: number) => `${Math.round(share * 100)}%`;

// ---------- one message ----------

function UserMessage({ message, open, onToggle }: { message: BuilderMessage; open: boolean; onToggle: (id: string) => void }) {
  // Your own screen: the placeholders filled back in from this message's vault.
  const shown = resolveText(message.text, message.vault ?? {}, (key: string) => `{${key}}`);
  const note = privacyNote(message.found ?? []) as string | null;
  const key = message.id ?? message.text;
  return (
    <>
      <li className="lay-msg from-you">{shown}</li>
      {note ? (
        <li className="lay-privacy">
          <p className="lay-privacy-note"><Icon name="lock" />{note}</p>
          <button className="rb-link lay-privacy-toggle" type="button" aria-expanded={open} onClick={() => onToggle(key)}>{open ? 'Hide what we store' : 'What we store'}</button>
          {open ? (
            <dl className="lay-stored">
              <div><dt>Stored, and what Gemini sees</dt><dd className="mono">{message.text}</dd></div>
              <div><dt>If you delete your account</dt><dd className="mono">{resolveText(message.text, null)}</dd></div>
            </dl>
          ) : null}
        </li>
      ) : null}
    </>
  );
}

function SuggestionMessage({ message, onDecide }: { message: BuilderMessage; onDecide: (messageId: string, itemId: string, action: 'add' | 'skip') => void }) {
  return (
    <li className="lay-msg from-lay lay-suggest">
      <p>{message.text}</p>
      <ul className="lay-suggest-list">
        {(message.items ?? []).map((item: SuggestionItem) => {
          const status = item.status === 'have' ? <span className="badge badge-green">You have it</span>
            : item.status === 'added' ? <span className="badge badge-green"><Icon name="check" />Added</span>
              : item.status === 'skipped' ? <span className="badge">Skipped</span>
                : (
                  <span className="lay-suggest-actions">
                    <button className="btn btn-sm btn-primary" type="button" onClick={() => onDecide(message.id, item.id, 'add')}>Add</button>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => onDecide(message.id, item.id, 'skip')}>Skip</button>
                  </span>
                );
          if (item.kind === 'summary') {
            return (
              <li className={`lay-suggest-item is-${item.status}`} key={item.id}>
                <div className="lay-suggest-top"><strong>Summary</strong>{status}</div>
                <p className="lay-diff-old">{markupText(item.before ?? '')}</p>
                <p className="lay-diff-new">{markupText(item.after ?? '')}</p>
              </li>
            );
          }
          return (
            <li className={`lay-suggest-item is-${item.status}`} key={item.id}>
              <div className="lay-suggest-top"><strong>{item.skill}</strong><span className="mono lay-share">{percent(item.share ?? 0)}</span>{status}</div>
              <div className="bar" aria-hidden="true"><span style={{ width: percent(item.share ?? 0) }} /></div>
              <p className="lay-suggest-why">{item.evidence}</p>
            </li>
          );
        })}
      </ul>
      <p className="lay-suggest-foot">{`Share of ${message.role} postings asking for it (sample data). Nothing changes until you press Add.`}</p>
    </li>
  );
}

function AgentMessage({ message, resume, onAgent }: { message: BuilderMessage; resume: Resume; onAgent: (messageId: string, actionId: string) => void }) {
  const fill = fillFor(resume);
  return (
    <li className="lay-msg from-lay">
      {message.text}
      {message.card ? (
        <div className="lay-card">
          <p className="lay-card-subject"><span className="lay-card-label">Subject</span>{fill(message.card.subject)}</p>
          <p className="lay-card-body">{fill(message.card.body)}</p>
        </div>
      ) : null}
      {message.actions?.length ? (
        <div className="lay-msg-actions">
          {message.actions.map((action) => (
            <button key={action.id} className={`btn btn-sm ${action.primary ? 'btn-primary' : 'btn-secondary'}`} type="button" disabled={Boolean(message.chosen)} onClick={() => onAgent(message.id, action.id)}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

// ---------- resizing ----------

/** Drag the panel's left or bottom edge to resize it (keys: arrows change it by 24 px, Home resets it, double-click resets too). */
function usePanelResize(rootRef: RefObject<HTMLElement | null>, panelRef: RefObject<HTMLElement | null>) {
  const size = useRef<{ w?: number; h?: number }>({});
  const [dragging, setDragging] = useState<'w' | 'h' | null>(null);
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const apply = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    for (const [key, name] of [['w', '--lay-w'], ['h', '--lay-h']] as const) {
      const value = size.current[key];
      if (value) {
        root.style.setProperty(name, `${value}px`);
      } else {
        root.style.removeProperty(name);
      }
    }
  }, [rootRef]);

  useEffect(() => {
    size.current = (readJson(PANEL_SIZE_KEY) as { w?: number; h?: number } | null) ?? {};
    apply();
  }, [apply]);

  const limits = (key: 'w' | 'h'): [number, number] => {
    const root = rootRef.current;
    return key === 'w' ? [300, Math.max(300, Math.min(720, (root?.clientWidth ?? 0) - 340))] : [420, Math.max(420, window.innerHeight - 32)];
  };
  const set = (key: 'w' | 'h', value: number) => {
    size.current[key] = Math.round(clamp(value, ...limits(key)));
    apply();
  };
  const remember = () => writeJson(PANEL_SIZE_KEY, size.current);
  const current = (key: 'w' | 'h') => (key === 'w' ? panelRef.current?.offsetWidth : panelRef.current?.offsetHeight) ?? 0;

  function pointerDown(key: 'w' | 'h') {
    return (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setDragging(key);
      const start = { x: event.clientX, y: event.clientY, w: current('w'), h: current('h') };
      const move = (moveEvent: PointerEvent) => (key === 'w' ? set('w', start.w + (start.x - moveEvent.clientX)) : set('h', start.h + (moveEvent.clientY - start.y)));
      const stop = () => {
        setDragging(null);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        remember();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    };
  }

  function keyDown(key: 'w' | 'h', grow: string, shrink: string) {
    return (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === grow || event.key === shrink) {
        event.preventDefault();
        set(key, current(key) + (event.key === grow ? 24 : -24));
        remember();
      } else if (event.key === 'Home') {
        delete size.current[key];
        apply();
        remember();
      }
    };
  }
  const reset = (key: 'w' | 'h') => () => {
    delete size.current[key];
    apply();
    remember();
  };

  return {
    dragging,
    handleProps: (key: 'w' | 'h') => ({
      onPointerDown: pointerDown(key),
      onKeyDown: key === 'w' ? keyDown('w', 'ArrowLeft', 'ArrowRight') : keyDown('h', 'ArrowDown', 'ArrowUp'),
      onDoubleClick: reset(key),
    }),
  };
}

// ---------- the panel ----------

interface Props {
  open: boolean;
  tab: 'chat' | 'versions';
  onTab: (tab: 'chat' | 'versions') => void;
  onClose: () => void;
  rootRef: RefObject<HTMLElement | null>;
  state: BuilderState;
  resume: Resume;
  replying: boolean;
  onSend: (text: string) => void;
  onDecide: (messageId: string, itemId: string, action: 'add' | 'skip') => void;
  onAgent: (messageId: string, actionId: string) => void;
  viewing: number | null;
  onView: (number: number) => void;
  onRestore: (number: number) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function LayPanel({ open, tab, onTab, onClose, rootRef, state, resume, replying, onSend, onDecide, onAgent, viewing, onView, onRestore, inputRef }: Props) {
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [text, setText] = useState('');
  const [storedOpen, setStoredOpen] = useState<Set<string>>(new Set());
  const { dragging, handleProps } = usePanelResize(rootRef, panel);
  const history = state.history;

  useEffect(() => {
    if (list.current) {
      list.current.scrollTop = list.current.scrollHeight;
    }
  }, [state.messages, replying, tab, open]);

  useEffect(() => {
    const box = inputRef.current;
    if (box) {
      box.style.height = 'auto';
      box.style.height = `${Math.min(box.scrollHeight, 150)}px`;
    }
  }, [text, inputRef, open]);

  const toggleStored = (key: string) =>
    setStoredOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim() && !replying) {
      onSend(text);
      setText('');
    }
  }

  const now = Date.now();
  return (
    <aside className="lay-panel" ref={panel} aria-label="Lay AI" hidden={!open}>
      <div className={`lay-resize lay-resize-x${dragging === 'w' ? ' is-dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize the Lay AI panel width. Arrow keys change it, Home resets it." tabIndex={0} title="Drag to resize. Double-click to reset." {...handleProps('w')} />
      <div className={`lay-resize lay-resize-y${dragging === 'h' ? ' is-dragging' : ''}`} role="separator" aria-orientation="horizontal" aria-label="Resize the Lay AI panel height. Arrow keys change it, Home resets it." tabIndex={0} title="Drag to resize. Double-click to reset." {...handleProps('h')} />
      <div className="lay-panel-head">
        <span className="lay-avatar" aria-hidden="true"><LayMark /></span>
        <div>
          <p className="lay-title">Lay AI</p>
          <p className="lay-sub">{`Preview: sample replies · ${WRITING_STYLE_LABELS[state.format.style as keyof typeof WRITING_STYLE_LABELS]} style`}</p>
        </div>
        <button className="icon-btn lay-close" type="button" aria-label="Close Lay AI" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="lay-tabs" role="tablist" aria-label="Lay AI">
        <button className="lay-tab" type="button" role="tab" aria-controls="lay-chat" aria-selected={tab === 'chat'} onClick={() => onTab('chat')}>Chat</button>
        <button className="lay-tab" type="button" role="tab" aria-controls="lay-versions" aria-selected={tab === 'versions'} onClick={() => onTab('versions')}>
          Versions <span className="count">{history?.versions.length ?? ''}</span>
        </button>
      </div>
      <div className="lay-body" id="lay-chat" role="tabpanel" hidden={tab !== 'chat'}>
        <ul className="lay-messages" role="log" aria-live="polite" ref={list}>
          <li className="lay-msg from-lay">{GREETING}</li>
          {state.messages.map((message) => (
            <Fragment key={message.id}>
              {message.from === 'you' ? <UserMessage message={message} open={storedOpen.has(message.id ?? message.text)} onToggle={toggleStored} />
                : message.kind === 'suggest' ? <SuggestionMessage message={message} onDecide={onDecide} />
                  : message.kind === 'agent' ? <AgentMessage message={message} resume={resume} onAgent={onAgent} />
                    : <li className="lay-msg from-lay">{message.text}</li>}
            </Fragment>
          ))}
          {replying ? <li className="lay-msg from-lay is-typing">Lay AI is typing…</li> : null}
        </ul>
        <div className="lay-suggestions">
          {PROMPTS.map(([prompt, label]) => (
            <button key={prompt} className="lay-suggestion" type="button" onClick={() => onSend(prompt)}>{label}</button>
          ))}
        </div>
        <form className="lay-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="lay-input">Ask Lay AI</label>
          <textarea
            ref={inputRef}
            className="input lay-input"
            id="lay-input"
            rows={1}
            maxLength={MAX_INPUT}
            placeholder="Ask Lay AI to change your resume, or paste a job description…"
            autoComplete="off"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // A few lines for a pasted job description: Enter sends, Shift+Enter adds a line.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit(event);
              }
            }}
          />
          <button className="btn btn-primary" type="submit" disabled={replying}>Send</button>
        </form>
      </div>
      <div className="lay-body" id="lay-versions" role="tabpanel" hidden={tab !== 'versions'}>
        <ul className="lay-version-list">
          {history ? versionsNewestFirst(history).map((version: { number: number; summary: string; at: number }) => {
            const isCurrent = version.number === history.current;
            return (
              <li className={`lay-version${isCurrent ? ' is-current' : ''}${viewing === version.number ? ' is-viewing' : ''}`} key={version.number}>
                <div className="lay-version-top">
                  <span className={`badge${isCurrent ? ' badge-green' : ''}`}>{`v${version.number}`}</span>
                  <span className="lay-version-summary">{version.summary}</span>
                </div>
                <div className="lay-version-meta">
                  <span>{relativeTime(version.at, now)}</span>
                  {isCurrent ? (
                    <span className="lay-version-current">Current</span>
                  ) : (
                    <span className="lay-version-actions">
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => onView(version.number)}><Icon name="eye" />View</button>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => onRestore(version.number)}>Restore</button>
                    </span>
                  )}
                </div>
              </li>
            );
          }) : null}
        </ul>
      </div>
    </aside>
  );
}
