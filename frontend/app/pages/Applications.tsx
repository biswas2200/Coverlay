import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { PageHeader, PreviewBadge } from '@/components/PageHeader';
import { useLayPage } from '@/lay/pageStore';
import { usePageTitle } from '@/lib/hooks';
import { useUser } from '@/lib/session';
import { useStoredState } from '@/lib/storage';
import {
  NOTES_MAX,
  PORTALS,
  STATUSES,
  addApplication,
  boardColumns,
  dayLabel,
  dueReminders,
  isApplicationList,
  layApplicationsReply,
  moveTo,
  needsCheckIn,
  nextStatus,
  noteWords,
  notesOf,
  notesPlaceholder,
  outcomeRecord,
  sampleApplications,
  setNotes,
  snoozeCheckIn,
  statusLabel,
  validateApplication,
} from '@legacy/pages/applications-rules.js';

// The applications board preview: five columns, cards that drag between them (or a move control and button on each card,
// for the keyboard and touch), the reminders due soon, the "Did you hear back?" check-in, what the outcome insight keeps
// (no names), a small "+ Notes" on every card, and Lay AI answering from the board.

type App = ReturnType<typeof sampleApplications>[number];

// The sample analytics id and resume features the outcome record shows (no personal data).
const SUBJECT = { subjectId: '7f3a…c21e', experienceBand: '1-3 yrs', skills: ['Java', 'Spring Boot', 'SQL'] };
const NOTES_DELAY_MS = 500;

interface NoteBoxProps {
  app: App;
  open: boolean;
  onOpen: (open: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  onSave: (id: string, text: string, announce: boolean) => void;
}

/**
 * The small "+ Notes" under a card: one pill that opens a private text box. A note is kept as the person types (after
 * half a second, and at once when they leave the box or the card moves). The box keeps its own text, so the board is
 * not redrawn under the caret.
 */
function NoteBox({ app, open, onOpen, onFocusChange, onSave }: NoteBoxProps) {
  const [text, setText] = useState(() => notesOf(app));
  const pending = useRef<number | null>(null);
  const latest = useRef({ text, id: app.id, onSave });
  latest.current = { text, id: app.id, onSave };
  const words = noteWords(text);

  const flush = useCallback((announce: boolean) => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
    latest.current.onSave(latest.current.id, latest.current.text, announce);
  }, []);

  // Moving a card remounts it under its new column: what was typed is kept first.
  useEffect(() => () => {
    if (pending.current !== null) {
      flush(false);
    }
  }, [flush]);

  return (
    <details className="apps-notes" open={open} onToggle={(event) => onOpen(event.currentTarget.open)}>
      <summary>
        <span>{words ? 'Notes' : '+ Notes'}</span>
        {words ? <span className="apps-notes-count">{`${words} ${words === 1 ? 'word' : 'words'}`}</span> : null}
      </summary>
      <label className="sr-only" htmlFor={`notes-${app.id}`}>{`Notes for ${app.role} at ${app.company}`}</label>
      <textarea
        id={`notes-${app.id}`}
        className="input apps-notes-input"
        rows={4}
        maxLength={NOTES_MAX}
        spellCheck
        placeholder={notesPlaceholder(app.status)}
        value={text}
        autoFocus={open && text === ''}
        onChange={(event) => {
          setText(event.target.value);
          latest.current.text = event.target.value;
          if (pending.current !== null) {
            window.clearTimeout(pending.current);
          }
          pending.current = window.setTimeout(() => flush(false), NOTES_DELAY_MS);
        }}
        onFocus={() => onFocusChange(true)}
        onBlur={() => {
          onFocusChange(false);
          flush(true);
        }}
      />
      <p className="apps-notes-hint">Only you see this. It is not part of the insights.</p>
    </details>
  );
}

interface CardProps {
  app: App;
  now: number;
  dragging: boolean;
  notesOpen: boolean;
  notesFocused: boolean;
  onMove: (id: string, status: string) => void;
  onSnooze: (id: string) => void;
  onDragStart: (id: string, event: DragEvent) => void;
  onDragEnd: () => void;
  onNotesOpen: (id: string, open: boolean) => void;
  onNotesFocus: (id: string, focused: boolean) => void;
  onNotesSave: (id: string, text: string, announce: boolean) => void;
}

const Card = memo(function Card({ app, now, dragging, notesOpen, notesFocused, onMove, onSnooze, onDragStart, onDragEnd, onNotesOpen, onNotesFocus, onNotesSave }: CardProps) {
  const since = app.appliedAt ? `Applied ${dayLabel(app.appliedAt, now)}` : `Added ${dayLabel(app.createdAt, now)}`;
  const record = outcomeRecord(app, SUBJECT);
  const to = nextStatus(app.status);
  return (
    <li className={`card apps-card${dragging ? ' is-dragging' : ''}`} data-app={app.id} draggable={!notesFocused} onDragStart={(event) => onDragStart(app.id, event)} onDragEnd={onDragEnd}>
      <div className="apps-card-head">
        <h3>{app.role}</h3>
        <p className="apps-company">{app.company}</p>
      </div>
      <p className="apps-meta">{[app.portal, since, app.resumeVersion ? `resume v${app.resumeVersion}` : null].filter(Boolean).join(' · ')}</p>
      {app.reminder ? <p className="apps-reminder">{`Reminder ${dayLabel(app.reminder.dueAt, now)}: ${app.reminder.text}`}</p> : null}
      {needsCheckIn(app, now) ? (
        <div className="apps-checkin">
          <p><strong>Did you hear back?</strong> Your answer (no names) helps show what gets interviews.</p>
          <div className="row">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => onMove(app.id, 'INTERVIEW')}>Interview</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => onMove(app.id, 'REJECTED')}>No</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => onSnooze(app.id)}>Not yet</button>
          </div>
        </div>
      ) : null}
      {record ? (
        <details className="apps-stored">
          <summary>What the insights keep</summary>
          <pre className="mono">{JSON.stringify(record, null, 2)}</pre>
        </details>
      ) : null}
      <NoteBox app={app} open={notesOpen} onOpen={(open) => onNotesOpen(app.id, open)} onFocusChange={(focused) => onNotesFocus(app.id, focused)} onSave={onNotesSave} />
      <div className="apps-actions">
        <label className="sr-only" htmlFor={`move-${app.id}`}>Move to</label>
        <select className="select" id={`move-${app.id}`} value="" onChange={(event) => event.target.value && onMove(app.id, event.target.value)}>
          <option value="">Move to…</option>
          {STATUSES.filter((s: { value: string }) => s.value !== app.status).map((s: { value: string; label: string }) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {to ? (
          <button className="btn btn-primary btn-sm" type="button" onClick={() => onMove(app.id, to)}>{to === 'APPLIED' ? 'Mark applied' : `→ ${statusLabel(to)}`}</button>
        ) : null}
      </div>
    </li>
  );
});

export default function Applications() {
  usePageTitle('Applications');
  const user = useUser();
  const [apps, setApps] = useStoredState<App[]>(`coverlay.preview.applications.${user?.id ?? 'guest'}`, () => sampleApplications(Date.now()), isApplicationList);
  const [status, setStatus] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());
  const [notesFocus, setNotesFocus] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ company: '', role: '', portal: PORTALS[0] as string });
  const [formError, setFormError] = useState('');
  const now = Date.now();

  // Brings a card into view and outlines it for a moment, so the person sees which one a move or an answer is about.
  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    const card = document.querySelector<HTMLElement>(`[data-app="${focusRequest.id}"]`);
    if (!card) {
      return;
    }
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'center', inline: 'center', behavior: calm ? 'auto' : 'smooth' });
    card.classList.remove('is-moved');
    void card.offsetWidth; // restart the outline if the card was just outlined
    card.classList.add('is-moved');
  }, [focusRequest]);

  const focusCard = useCallback((id: string) => setFocusRequest((current) => ({ id, n: (current?.n ?? 0) + 1 })), []);

  const move = useCallback(
    (id: string, next: string) => {
      const moved = moveTo(apps, id, next, Date.now());
      setApps(moved);
      const app = moved.find((a: App) => a.id === id);
      if (app) {
        setStatus(`${app.role} at ${app.company} moved to ${statusLabel(next)}.`);
        focusCard(id);
      }
    },
    [apps, setApps, focusCard],
  );

  const saveNotes = useCallback(
    (id: string, text: string, announce: boolean) => {
      setApps((current) => {
        const next = setNotes(current, id, text, Date.now());
        if (announce && next !== current) {
          const app = next.find((a: App) => a.id === id);
          if (app) {
            setStatus(`Notes saved for ${app.role} at ${app.company}.`);
          }
        }
        return next;
      });
    },
    [setApps],
  );

  // Lay AI on this page: answers from the board, and moves a card only when the person says yes.
  useLayPage({
    sub: 'Preview: answers come from your board',
    greeting: "Hi, I'm Lay AI. Ask me about your applications: what is due, who has not replied, or how one company is going. I can also work on your resume and a job description.",
    prompts: ["What's due?", "Who hasn't replied?", 'Where are my rejections?', 'Status of Swiggy', 'Move Razorpay to Applied'],
    answer(text) {
      const result = layApplicationsReply(text, apps, Date.now());
      if (result.focus) {
        focusCard(result.focus);
      }
      const proposal = result.proposal;
      return {
        reply: result.reply,
        actions: proposal
          ? [
              { label: 'Move it', primary: true, run: () => { move(proposal.id, proposal.status); return `Done. It is in ${statusLabel(proposal.status)} now.`; } },
              { label: 'Not now', run: () => 'Fine, I left it where it is.' },
            ]
          : [],
      };
    },
  });

  function add(event: FormEvent) {
    event.preventDefault();
    const problem = validateApplication(form) as string | null;
    setFormError(problem ?? '');
    if (problem) {
      return;
    }
    setApps(addApplication(apps, form, Date.now(), 4));
    setForm({ company: '', role: '', portal: PORTALS[0] });
    setAddOpen(false);
    setStatus(`Added ${form.role} at ${form.company} to Preparing. Reminder set for 3 days.`);
  }

  const dragStart = useCallback((id: string, event: DragEvent) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    setDraggedId(id);
  }, []);
  const dragEnd = useCallback(() => {
    setDraggedId(null);
    setOverStatus(null);
  }, []);

  function onColumnOver(event: DragEvent, column: string) {
    if (!draggedId) {
      return;
    }
    event.preventDefault();
    const same = apps.find((a) => a.id === draggedId)?.status === column;
    event.dataTransfer.dropEffect = same ? 'none' : 'move';
    setOverStatus(same ? null : column);
  }

  function onColumnDrop(event: DragEvent, column: string) {
    if (!draggedId) {
      return;
    }
    event.preventDefault();
    const id = draggedId;
    dragEnd();
    if (apps.find((a) => a.id === id)?.status !== column) {
      move(id, column);
    }
  }

  const toggleNotes = useCallback((id: string, open: boolean) => {
    setNotesOpen((current) => {
      if (current.has(id) === open) {
        return current;
      }
      const next = new Set(current);
      if (open) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);
  const focusNotes = useCallback((id: string, focused: boolean) => setNotesFocus((current) => (focused ? id : current === id ? null : current)), []);
  const snooze = useCallback(
    (id: string) => {
      setApps((current) => snoozeCheckIn(current, id, Date.now()));
      setStatus("We'll ask again in a week.");
    },
    [setApps],
  );

  const due = dueReminders(apps, now);

  return (
    <>
      <PageHeader
        crumb="Jobs"
        title="Applications"
        actions={
          <>
            <PreviewBadge />
            <button className="btn btn-ghost" type="button" onClick={() => setApps(sampleApplications(Date.now()))}>
              <Icon name="refresh" />
              Reset sample
            </button>
          </>
        }
      />
      <div className="content">
        <p className="alert alert-info" role="note">
          Preview with sample data: applications and reminders live in this browser only. The real tracker also finds the portal and the application id for you (Lay AI on your phone, later).
        </p>
        <p className="sr-only" role="status">{status}</p>
        <section className="apps-top">
          <article className="card" aria-labelledby="due-title">
            <div className="card-head">
              <h2 id="due-title">Due soon</h2>
              {due.length ? <span className="badge badge-amber">{due.length} due</span> : null}
            </div>
            <ul className="apps-due">
              {due.length === 0 ? <li className="muted">No reminders in the next two days.</li> : null}
              {due.map(({ app, reminder, overdue }: { app: App; reminder: NonNullable<App['reminder']>; overdue: boolean }) => (
                <li key={app.id} className={overdue ? 'is-overdue' : ''}>
                  <span className="tl-what">{`${reminder.text}: ${app.role}, ${app.company}`}</span>
                  <span className="tl-when">{overdue ? `due ${dayLabel(reminder.dueAt, now)}` : dayLabel(reminder.dueAt, now)}</span>
                </li>
              ))}
            </ul>
          </article>
          <details className="card apps-add" open={addOpen} onToggle={(event) => setAddOpen(event.currentTarget.open)}>
            <summary><Icon name="plus" />Add an application</summary>
            <form className="apps-form" noValidate onSubmit={add}>
              <div className="field"><label htmlFor="add-company">Company</label><input className="input" id="add-company" maxLength={80} autoComplete="off" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></div>
              <div className="field"><label htmlFor="add-role">Role</label><input className="input" id="add-role" maxLength={80} autoComplete="off" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} /></div>
              <div className="field">
                <label htmlFor="add-portal">Where you apply</label>
                <select className="select" id="add-portal" value={form.portal} onChange={(event) => setForm({ ...form, portal: event.target.value })}>
                  {PORTALS.map((portal: string) => <option key={portal} value={portal}>{portal}</option>)}
                </select>
              </div>
              <p className="field-error" role="alert">{formError}</p>
              <button className="btn btn-primary" type="submit">Add to Preparing</button>
            </form>
          </details>
        </section>

        <p className="muted apps-hint">Drag a card to another column, or use <b>Move to…</b> and the button on the card. Lay AI (bottom right) can answer from your board.</p>
        <section className="apps-wrap" aria-label="Applications board">
          <div className={`apps-board${draggedId ? ' is-dragging-card' : ''}`}>
            {boardColumns(apps).map((column: { value: string; label: string; items: App[] }) => (
              <section
                key={column.value}
                className={`apps-col apps-col-${column.value.toLowerCase()}${overStatus === column.value ? ' is-over' : ''}`}
                aria-label={column.label}
                data-status={column.value}
                onDragOver={(event) => onColumnOver(event, column.value)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setOverStatus((current) => (current === column.value ? null : current));
                  }
                }}
                onDrop={(event) => onColumnDrop(event, column.value)}
              >
                <h2 className="apps-col-title">{column.label}<span className="count">{column.items.length}</span></h2>
                {column.items.length ? (
                  <ul className="apps-list">
                    {column.items.map((app) => (
                      <Card
                        key={app.id}
                        app={app}
                        now={now}
                        dragging={draggedId === app.id}
                        notesOpen={notesOpen.has(app.id)}
                        notesFocused={notesFocus === app.id}
                        onMove={move}
                        onSnooze={snooze}
                        onDragStart={dragStart}
                        onDragEnd={dragEnd}
                        onNotesOpen={toggleNotes}
                        onNotesFocus={focusNotes}
                        onNotesSave={saveNotes}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="apps-empty">Nothing here.</p>
                )}
              </section>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
