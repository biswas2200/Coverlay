import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { PageHeader, PreviewBadge } from '@/components/PageHeader';
import { VersionMenu } from '@/components/VersionMenu';
import { useLetterEditor } from '@/editor/useLetterEditor';
import { builderResume, readBuilderState } from '@/lib/builderStore';
import { usePageTitle } from '@/lib/hooks';
import { useUser } from '@/lib/session';
import { useStoredState, useStoredValue } from '@/lib/storage';
import { lettersHandoff } from '@/lay/rules';
import type { Resume } from '@/types/resume';
import { downloadBytes } from '@legacy/core/download.js';
import { DOCX_MIME } from '@legacy/pages/docx-writer.js';
import { buildLetterDocx, letterDocxName } from '@legacy/pages/letter-docx.js';
import { blocksPlain, blocksText, blocksToDoc, docToBlocks } from '@legacy/pages/letter-doc.js';
import { SAMPLE_GMAIL, attachmentName, buildMailRequest, mailSummary } from '@legacy/pages/mail-rules.js';
import { connectionsKey, emptyConnections, isConnected, setConnected } from '@legacy/pages/connections-rules.js';
import { guardText, knownValues, resolveText } from '@legacy/pages/privacy-guard-rules.js';
import { safeHref, templateById } from '@legacy/pages/resume-builder-rules.js';
import {
  LETTER_TYPES,
  SAMPLE_JOBS,
  addSuggestion,
  addSuggestionToBlocks,
  draftLetter,
  jobById,
  lengthNote,
  letterSuggestions,
  skillFit,
  templatesFor,
  toBlocks,
  wordCount,
} from '@legacy/pages/letters-rules.js';

// Letters & emails preview: pick a type, a template and a job; the draft is built with placeholders (what Gemini would
// see) and filled in here from the vault. The draft is the editing surface: click anywhere in it and type, with undo and
// redo, bold, italic, underline and links, new paragraphs and line breaks; an edit goes back through the guard before it
// is kept (names and contacts become placeholders again). Suggestions add one sentence each, and only when the person
// adds them. A cover letter downloads as PDF or Word. A cold email is not a file: it goes into the person's Gmail with
// the resume and the cover letter attached, as a draft or sent. The edited text is kept per type, template and job until
// the person starts from the template again.

const SAVE_DELAY = 350;

interface Job {
  id: string;
  title: string;
  company: string;
  skills: string[];
}
type LetterType = 'cover' | 'email';
interface Doc {
  subject: string;
  blocks: string[];
}
interface MailState {
  to: string;
  attachResume: boolean;
  resumeFormat: 'pdf' | 'docx';
  attachCover: boolean;
  coverFormat: 'pdf' | 'docx';
}
interface LetterState {
  type: LetterType;
  templateId: string;
  coverTemplateId: string;
  jobId: string;
  customJob: Job | null;
  recipient: string;
  decided: Record<string, 'added' | 'skipped'>;
  docs: Record<string, Doc>;
  gemini: boolean;
  mail: MailState;
}
type Connections = ReturnType<typeof emptyConnections>;
type MailRequest = Extract<ReturnType<typeof buildMailRequest>, { ok: true }>['request'];

const fresh = (): LetterState => ({
  type: 'cover',
  templateId: 'standard',
  coverTemplateId: 'standard',
  jobId: SAMPLE_JOBS[0].id,
  customJob: null,
  recipient: '',
  decided: {},
  docs: {},
  gemini: false,
  mail: { to: '', attachResume: true, resumeFormat: 'pdf', attachCover: true, coverFormat: 'pdf' },
});

/** The job Lay AI brought, as kept in this browser: only its own shape, or null. */
function cleanCustomJob(job: unknown): Job | null {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null);
  const raw = job as Partial<Job> | null;
  if (!raw || typeof raw !== 'object' || !/^lay-[a-z0-9-]{1,44}$/.test(raw.id ?? '') || !text(raw.title) || !text(raw.company)) {
    return null;
  }
  return {
    id: raw.id as string,
    title: text(raw.title) as string,
    company: text(raw.company) as string,
    skills: Array.isArray(raw.skills) ? raw.skills.map(text).filter((s): s is string => Boolean(s)).slice(0, 12) : [],
  };
}

function load(stored: unknown): LetterState {
  const found = stored as Partial<LetterState> | null;
  const base = fresh();
  const loaded: LetterState =
    found && typeof found === 'object' && LETTER_TYPES.some((t) => t.id === found.type)
      ? { ...base, ...found, docs: found.docs && typeof found.docs === 'object' ? found.docs : {}, mail: { ...base.mail, ...(found.mail ?? {}) } }
      : base;
  loaded.customJob = cleanCustomJob(loaded.customJob);
  // Lay AI left a cold email for a job (the person agreed in its chat): open it, ready to read and send from here. It is
  // only looked at here, and taken away in an effect, so a second run of this function in development sees it too.
  const handoff = lettersHandoff();
  if (handoff) {
    loaded.customJob = handoff.job;
    loaded.jobId = handoff.job.id;
    loaded.type = 'email';
    loaded.templateId = 'hiring-manager';
  }
  return loaded;
}

const docKeyFor = (state: LetterState, type: LetterType = state.type) => {
  const templateId = type === state.type ? state.templateId : type === 'cover' ? state.coverTemplateId : templatesFor(type)[0].id;
  return `${type}.${templateId}.${state.jobId}`;
};
const hasGreeting = (type: LetterType) => type === 'cover';
const jobOf = (state: LetterState): Job => (state.customJob && state.customJob.id === state.jobId ? state.customJob : (jobById(state.jobId) as Job));

/** The template's draft with the suggestions added so far: `{ subject, blocks }` in placeholder form. */
function templateDoc(state: LetterState, resume: Resume, type: LetterType): Doc {
  const job = jobOf(state);
  const templateId = type === state.type ? state.templateId : type === 'cover' ? state.coverTemplateId : templatesFor(type)[0].id;
  let letter = draftLetter({ type, templateId, resume, job });
  for (const item of letterSuggestions({ type, resume, job })) {
    if (state.decided[`${type}.${item.id}`] === 'added') {
      letter = addSuggestion(letter, item);
    }
  }
  return { subject: letter.subject, blocks: toBlocks(letter) };
}

/** What the person is working on: their edited text if they have edited it, else the template's draft. */
const letterDocOf = (state: LetterState, resume: Resume, type: LetterType = state.type): Doc => state.docs[docKeyFor(state, type)] ?? templateDoc(state, resume, type);

/** Placeholder text with each {placeholder} marked, for "What Gemini sees". */
function PlaceholderText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[a-z_.0-9]+\})/g).filter(Boolean).map((part, index) => (/^\{[a-z_.0-9]+\}$/.test(part) ? <mark key={index} className="letters-ph mono">{part}</mark> : part))}
    </>
  );
}

export default function Letters() {
  usePageTitle('Letters & emails');
  const user = useUser();
  const userId = user?.id ?? 'guest';
  const resume = useMemo(() => builderResume(user?.id), [user?.id]);
  /** Classic is typeset like LaTeX, so its resume is PDF only. */
  const resumeIsPdfOnly = Boolean(templateById(readBuilderState(user?.id)?.templateId)?.pdfOnly);

  const [state, setState] = useStoredValue<LetterState>(`coverlay.preview.letters.${userId}`, load);
  const [connections, setConnections] = useStoredState<Connections>(connectionsKey(userId), emptyConnections, (v) => typeof (v as { connected?: unknown })?.connected === 'object');
  const gmail = isConnected(connections, 'gmail');

  const [saved, setSaved] = useState('');
  const [words, setWords] = useState(0);
  const [status, setStatus] = useState('');
  const [resetArmed, setResetArmed] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const [tools, setTools] = useState({ undo: false, redo: false, bold: false, italic: false, underline: false });
  const [subject, setSubject] = useState('');
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const [pendingSend, setPendingSend] = useState<MailRequest | null>(null);
  const [mailResult, setMailResult] = useState('');
  const saveTimer = useRef<number | null>(null);

  // A cold email Lay AI left is taken away now that it has been read (see load()).
  useEffect(() => {
    lettersHandoff({ take: true });
  }, []);

  const vault = useMemo(() => ({ ...knownValues(resume), 'other.person_1': state.recipient.trim() || 'there' }), [resume, state.recipient]);
  /** Text with the placeholders filled in from the vault, as the person sees it. */
  const fillText = useCallback((text: string) => resolveText(text ?? '', vault, (key: string) => `{${key}}`), [vault]);
  /** Text the person typed, with their name, college and contacts turned back into placeholders. */
  const guardPiece = useCallback((text: string) => guardText(text, vault).stored as string, [vault]);

  const docKey = docKeyFor(state);
  const job = jobOf(state);
  const letterDoc = letterDocOf(state, resume);
  const isEmail = state.type === 'email';

  // The editor is made again when the draft, the recipient or a reset changes, never while the person types.
  const { host, editor } = useLetterEditor({
    mountKey: `${docKey}|${state.recipient}|${reload}`,
    label: isEmail ? 'Your cold email' : 'Your cover letter',
    makeDoc: () => blocksToDoc(letterDoc.blocks, fillText),
    onChange: () => {
      scheduleSave();
      refreshLength();
    },
    onSelection: () => {
      const e = editor.current;
      if (e) {
        setTools({ undo: e.canUndo(), redo: e.canRedo(), bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline') });
      }
    },
    onBlur: (to) => {
      if (!to?.closest?.('#letter-toolbar, #letter-linkbar')) {
        flush();
      }
    },
  });

  // The subject of a cold email is its own box above the draft, also edited in place; it starts from the draft's subject.
  useEffect(() => {
    setSubject(isEmail ? fillText(letterDocOf(state, resume).subject) : '');
    setSaved(state.docs[docKey] ? 'All changes kept' : '');
    setWords(wordCount(blocksPlain(letterDocOf(state, resume).blocks)));
    // Only a different draft or recipient resets these; typing keeps them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, state.recipient, reload]);

  function refreshLength() {
    const e = editor.current;
    setWords(wordCount(e ? blocksPlain(docToBlocks(e.getJSON())) : ''));
  }

  function scheduleSave() {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(flushRef.current, SAVE_DELAY);
    setSaved('Editing…');
  }

  /** Keeps the edit that is waiting: the text goes back through the guard, then is stored for this draft. */
  const flush = () => flushRef.current();
  const flushRef = useRef<() => void>(() => undefined);
  flushRef.current = () => {
    if (saveTimer.current === null || !editor.current) {
      return;
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const next: Doc = {
      subject: isEmail ? guardPiece(subject.replace(/\s+/g, ' ').trim().slice(0, 200)) : letterDoc.subject,
      blocks: docToBlocks(editor.current.getJSON(), guardPiece),
    };
    setState((current) => ({ ...current, docs: { ...current.docs, [docKey]: next } }));
    setSaved('All changes kept');
  };

  // A page that is left with an edit waiting keeps it.
  useEffect(() => () => flushRef.current(), []);

  const update = (change: Partial<LetterState>) => {
    flush();
    setResetArmed(false);
    setState((current) => ({ ...current, ...change }));
  };

  function addLink(event: FormEvent) {
    event.preventDefault();
    const typed = linkUrl.trim();
    const href = safeHref(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) ? `mailto:${typed}` : typed);
    if (!href) {
      setLinkError('Use a web address like linkedin.com/in/your-name, or an email address.');
      return;
    }
    setLinkOpen(false);
    editor.current?.setLink(href, typed.replace(/^mailto:/, ''));
    setStatus('Link added.');
  }

  function runTool(command: string) {
    const e = editor.current;
    if (!e) {
      return;
    }
    if (command === 'undo') {
      e.undo();
    } else if (command === 'redo') {
      e.redo();
    } else if (command === 'link') {
      setLinkError('');
      setLinkUrl('');
      setLinkOpen(true);
    } else {
      e.toggle(command);
    }
  }

  function startOver() {
    if (!state.docs[docKey]) {
      setStatus('This draft is still the template.');
      return;
    }
    if (!resetArmed) {
      setResetArmed(true);
      window.setTimeout(() => setResetArmed(false), 4000);
      return;
    }
    flush();
    setResetArmed(false);
    setState((current) => {
      const docs = { ...current.docs };
      delete docs[docKey];
      const decided = Object.fromEntries(Object.entries(current.decided).filter(([name]) => !name.startsWith(`${current.type}.`)));
      return { ...current, docs, decided };
    });
    setReload((n) => n + 1); // the key is the same, so the editor must be told to take the template's text
    setStatus('Back to the template.');
  }

  function decide(id: string, added: boolean) {
    flush();
    // Edited text is its own copy: the sentence goes into that copy. Untouched, the template picks it up itself.
    setState((current) => {
      const next: LetterState = { ...current, decided: { ...current.decided, [`${current.type}.${id}`]: added ? 'added' : 'skipped' } };
      const kept = current.docs[docKeyFor(current)];
      if (added && kept) {
        const item = letterSuggestions({ type: current.type, resume, job: jobOf(current) }).find((i: { id: string }) => i.id === id);
        next.docs = { ...current.docs, [docKeyFor(current)]: { ...kept, blocks: addSuggestionToBlocks(kept.blocks, item, hasGreeting(current.type)) } };
      }
      return next;
    });
    setReload((n) => n + 1);
    setStatus(added ? 'Added to the draft.' : 'Skipped.');
  }

  /** A draft with the real values filled in, as a file or an email carries it. Keeps any pending edit first. */
  function filled(type: LetterType = state.type): Doc {
    flush();
    const doc = type === state.type && saveTimer.current === null ? letterDocOf(state, resume, type) : letterDocOf(state, resume, type);
    return { subject: fillText(doc.subject), blocks: doc.blocks.map(fillText) };
  }

  async function copy() {
    const made = filled();
    try {
      await navigator.clipboard.writeText(blocksText(made.blocks, isEmail ? made.subject : ''));
      setStatus('Copied.');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus('Copy is blocked in this browser: select the text instead.');
    }
  }

  function downloadDocx() {
    downloadBytes(buildLetterDocx({ blocks: filled('cover').blocks }, { title: `Cover letter for ${job.company}` }), letterDocxName(resume.name, job.company), DOCX_MIME);
    setStatus('Your Word file is downloading.');
  }

  // ---------- sending the cold email from Gmail (sample: the preview sends and saves nothing) ----------

  /** The email, the resume and the cover letter as one request: `{ ok, request }` or `{ ok: false, error }`. */
  function mailRequest(action: 'draft' | 'send') {
    const letter = filled('email');
    const mail = state.mail;
    const attachments: { kind: string; format: string }[] = [];
    if (mail.attachResume) {
      attachments.push({ kind: 'resume', format: resumeIsPdfOnly ? 'pdf' : mail.resumeFormat });
    }
    if (mail.attachCover) {
      attachments.push({ kind: 'cover', format: mail.coverFormat });
    }
    return buildMailRequest({ provider: 'gmail', action, to: mail.to, subject: letter.subject, body: blocksPlain(letter.blocks), bodyMarkup: letter.blocks.join('\n\n'), attachments }, resume.name);
  }

  const setMail = (change: Partial<MailState>) => {
    setPendingSend(null);
    setState((current) => ({ ...current, mail: { ...current.mail, ...change } }));
  };

  function saveDraft() {
    const made = mailRequest('draft');
    if (!made.ok) {
      setMailResult(made.error);
      return;
    }
    setPendingSend(null);
    setMailResult(`${mailSummary(made.request, SAMPLE_GMAIL, { done: true })} Subject: ${made.request.subject} (Sample: the preview saves nothing in Gmail.)`);
    setStatus('Draft saved.');
  }

  function askToSend() {
    const made = mailRequest('send');
    if (!made.ok) {
      setMailResult(made.error);
      setPendingSend(null);
      return;
    }
    setPendingSend(made.request);
    setMailResult('');
    requestAnimationFrame(() => document.getElementById('mail-send-cancel')?.focus()); // not on "Send now": Enter must not send by accident
  }

  function sendNow() {
    if (!pendingSend) {
      return;
    }
    setMailResult(`${mailSummary(pendingSend, SAMPLE_GMAIL, { done: true })} Subject: ${pendingSend.subject} (Sample: the preview sends nothing.)`);
    setStatus('Email sent.');
    setPendingSend(null);
  }

  const setGmail = (on: boolean) => {
    setConnections(setConnected(connections, 'gmail', on));
    setMailResult('');
    setPendingSend(null);
    setStatus(on ? `Gmail connected as ${SAMPLE_GMAIL}.` : 'Gmail disconnected.');
  };

  const fit = skillFit(resume, job);
  const type = LETTER_TYPES.find((t) => t.id === state.type) ?? LETTER_TYPES[0];
  const suggestions = letterSuggestions({ type: state.type, resume, job }) as { id: string; label: string; text: string }[];
  const fromLay = isEmail && state.customJob?.id === state.jobId;
  const mail = state.mail;
  const names = [
    mail.attachResume ? attachmentName('resume', resumeIsPdfOnly ? 'pdf' : mail.resumeFormat, resume.name) : null,
    mail.attachCover ? attachmentName('cover', mail.coverFormat, resume.name) : null,
  ].filter(Boolean);
  const gemini = state.gemini;

  return (
    <>
      <PageHeader crumb="Resume" title="Letters & emails" actions={<><VersionMenu label="Written from" /><PreviewBadge /></>} />
      <div className="content">
        <p className="alert alert-info" role="note">
          Preview with sample data: drafts are written here from your sample resume, no AI is called and nothing is charged. The real drafts come from Gemini 3.8 Flash.
        </p>
        <p className="sr-only" role="status">{status}</p>
        {fromLay ? (
          <p className="alert alert-info" role="note">
            {`Lay AI prepared this email for ${state.customJob?.title} at ${state.customJob?.company}, after you agreed in its chat. Read it, add the address below and press Send when it is right. Nothing has been sent.`}
          </p>
        ) : null}
        <section className="letters">
          <article className="card letters-controls" aria-labelledby="letters-setup">
            <h2 className="sr-only" id="letters-setup">What to write</h2>
            <div className="seg" role="tablist" aria-label="Type">
              {LETTER_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === state.type}
                  onClick={() => update({ type: t.id, templateId: t.id === 'cover' ? state.coverTemplateId : templatesFor(t.id)[0].id })}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <fieldset className="rb-question">
              <legend>Template</legend>
              <ul className="letters-templates">
                {templatesFor(state.type).map((template: { id: string; label: string; blurb: string }) => (
                  <li key={template.id}>
                    <label className="letters-template">
                      <input
                        type="radio"
                        name="template"
                        value={template.id}
                        checked={template.id === state.templateId}
                        onChange={() => update({ templateId: template.id, ...(state.type === 'cover' ? { coverTemplateId: template.id } : {}) })}
                      />
                      <span><strong>{template.label}</strong><span className="field-hint">{template.blurb}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="field">
              <label htmlFor="job-select">For which job</label>
              <select className="select" id="job-select" value={state.jobId} onChange={(event) => update({ jobId: event.target.value, decided: {} })}>
                {[...(state.customJob ? [state.customJob] : []), ...SAMPLE_JOBS].map((j: Job) => <option key={j.id} value={j.id}>{`${j.title} · ${j.company}`}</option>)}
              </select>
              <p className="field-hint">{`You have ${fit.matched.length} of the ${fit.matched.length + fit.missing.length} skills it asks for${fit.missing.length ? ` (not yet: ${fit.missing.join(', ')})` : ''}.`}</p>
            </div>
            {isEmail ? (
              <div className="field">
                <label htmlFor="recipient">Who you&apos;re writing to (first name)</label>
                <input
                  className="input"
                  id="recipient"
                  maxLength={40}
                  autoComplete="off"
                  placeholder="e.g. Priya"
                  value={state.recipient}
                  onChange={(event) => {
                    flush();
                    setState((current) => ({ ...current, recipient: event.target.value.slice(0, 40) }));
                  }}
                />
                <p className="field-hint"><Icon name="lock" /> Stays on your screen: Gemini only sees {'{other.person_1}'}.</p>
              </div>
            ) : null}
            <p className="letters-cost">{`Writing this costs ${type.credits} credits with the real AI. Free in the preview.`}</p>
          </article>

          <article className="card letters-doc" aria-labelledby="doc-title">
            <div className="card-head">
              <h2 id="doc-title">Draft</h2>
              <div className="card-head-actions">
                <button className="btn btn-ghost btn-sm" type="button" aria-pressed={gemini} onClick={() => { flush(); setState((current) => ({ ...current, gemini: !current.gemini })); }}>
                  <Icon name="eye" />What Gemini sees
                </button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
                {!isEmail ? (
                  <>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => { flush(); window.print(); }}><Icon name="file" />PDF</button>
                    <button className="btn btn-primary btn-sm" type="button" onClick={downloadDocx}><Icon name="file" />DOCX</button>
                  </>
                ) : null}
              </div>
            </div>
            {gemini ? (
              <p className="alert alert-info letters-gemini-note">This is the draft as Gemini gets and writes it: placeholders, no personal details. Your screen fills them in.</p>
            ) : (
              <p className="letters-edit-hint"><strong>Edit it right here.</strong> Click anywhere in the draft and type. The toolbar stays with you as you scroll.</p>
            )}
            <div className="letters-toolbar" id="letter-toolbar" role="toolbar" aria-label="Edit the draft" aria-controls="letter-editor" hidden={gemini} onMouseDown={(event) => { if ((event.target as Element).closest('button')) { event.preventDefault(); } }}>
              <div className="rb-tool-group" role="group" aria-label="History">
                <button className="rb-tool" type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!tools.undo} onClick={() => runTool('undo')}><Icon name="undo" /></button>
                <button className="rb-tool" type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!tools.redo} onClick={() => runTool('redo')}><Icon name="redo" /></button>
              </div>
              <div className="rb-tool-group" role="group" aria-label="Text style">
                <button className="rb-tool" type="button" aria-pressed={tools.bold} aria-label="Bold" title="Bold (Ctrl+B)" onClick={() => runTool('bold')}><b>B</b></button>
                <button className="rb-tool" type="button" aria-pressed={tools.italic} aria-label="Italic" title="Italic (Ctrl+I)" onClick={() => runTool('italic')}><i>I</i></button>
                <button className="rb-tool" type="button" aria-pressed={tools.underline} aria-label="Underline" title="Underline (Ctrl+U)" onClick={() => runTool('underline')}><u>U</u></button>
                <button className="rb-tool" type="button" aria-label="Add a link" title="Add a link" onClick={() => runTool('link')}><Icon name="link" /></button>
              </div>
              <div className="rb-tool-group letters-toolbar-end">
                <span className="letters-saved" role="status">{saved}</span>
                <button className="btn btn-ghost btn-sm" type="button" title="Throw away your edits and write the draft again from the template" onClick={startOver}>{resetArmed ? 'Discard edits?' : 'Start over'}</button>
              </div>
            </div>
            <form className="rb-linkbar" id="letter-linkbar" hidden={!linkOpen || gemini} onSubmit={addLink}>
              <label htmlFor="letter-link-url">Link for the selected text</label>
              <input className="input" id="letter-link-url" placeholder="linkedin.com/in/your-name or you@email.com" autoComplete="off" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} autoFocus={linkOpen} />
              <button className="btn btn-primary btn-sm" type="submit">Add link</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setLinkOpen(false); editor.current?.focus(); }}>Cancel</button>
              <p className="field-hint">{linkError}</p>
            </form>
            <div className="field letters-subject-field" hidden={gemini || !isEmail}>
              <label htmlFor="letter-subject">Subject</label>
              <input className="input" id="letter-subject" maxLength={200} autoComplete="off" value={subject} onChange={(event) => { setSubject(event.target.value); scheduleSave(); }} />
            </div>
            <div className="letters-paper">
              <div id="letter-editor" ref={host} hidden={gemini} />
              {gemini ? (
                <div id="letter-gemini">
                  {[...(isEmail ? [`Subject: ${letterDoc.subject}`] : []), ...letterDoc.blocks.map((block) => blocksPlain([block]) as string)].map((text, index) => (
                    <p className="letters-p preserve-lines" key={index}><PlaceholderText text={text} /></p>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="field-hint">{lengthNote(state.type, words)}</p>

            {isEmail ? (
              <section className="letters-mail" aria-labelledby="mail-title">
                <h3 id="mail-title">Send it from your Gmail</h3>
                <p className="field-hint">
                  Coverlay puts this email, your resume and your cover letter into one message in your own Gmail, so there is nothing to download and attach by hand. Only Gmail for now; Outlook and other mail services come later.
                </p>
                {!gmail ? (
                  <div className="letters-mail-connect">
                    <button className="btn btn-primary" type="button" onClick={() => setGmail(true)}>Connect Gmail</button>
                    <p className="field-hint">
                      Coverlay asks Google for permission to save drafts and to send the messages you choose. It cannot read your inbox, and you can disconnect at any time, here or in <a href="/settings">Settings, Connected apps</a>.
                    </p>
                  </div>
                ) : (
                  <div className="letters-mail-ready">
                    <p className="letters-mail-account"><span>{`Gmail: ${SAMPLE_GMAIL}`}</span><button className="btn btn-ghost btn-sm" type="button" onClick={() => setGmail(false)}>Disconnect</button></p>
                    <div className="field">
                      <label htmlFor="mail-to">To</label>
                      <input className="input" id="mail-to" type="email" maxLength={254} autoComplete="off" placeholder="recruiter@company.com" value={mail.to} onChange={(event) => setMail({ to: event.target.value.slice(0, 254) })} />
                      <p className="field-hint">Needed to send. A draft can wait for it.</p>
                    </div>
                    <fieldset className="letters-attach">
                      <legend>Attach</legend>
                      <div className="letters-attach-row">
                        <label><input type="checkbox" checked={mail.attachResume} onChange={(event) => setMail({ attachResume: event.target.checked })} /> <span>Resume</span></label>
                        <label className="sr-only" htmlFor="attach-resume-format">Resume format</label>
                        <select className="select" id="attach-resume-format" value={resumeIsPdfOnly ? 'pdf' : mail.resumeFormat} onChange={(event) => setMail({ resumeFormat: event.target.value as 'pdf' | 'docx' })}>
                          <option value="pdf">PDF</option>
                          <option value="docx" disabled={resumeIsPdfOnly}>DOCX</option>
                        </select>
                      </div>
                      <div className="letters-attach-row">
                        <label><input type="checkbox" checked={mail.attachCover} onChange={(event) => setMail({ attachCover: event.target.checked })} /> <span>{`Cover letter for ${job.company}`}</span></label>
                        <label className="sr-only" htmlFor="attach-cover-format">Cover letter format</label>
                        <select className="select" id="attach-cover-format" value={mail.coverFormat} onChange={(event) => setMail({ coverFormat: event.target.value as 'pdf' | 'docx' })}>
                          <option value="pdf">PDF</option>
                          <option value="docx">DOCX</option>
                        </select>
                      </div>
                      <p className="field-hint">{`${names.length ? `Attached: ${names.join(', ')}.` : 'No attachments.'}${resumeIsPdfOnly ? ' Your Classic resume is PDF only.' : ''} Both are made from your current resume and your cover letter.`}</p>
                    </fieldset>
                    <div className="letters-mail-actions">
                      <button className="btn btn-primary" type="button" onClick={saveDraft}>Save as Gmail draft</button>
                      <button className="btn btn-secondary" type="button" onClick={askToSend}>Send with Gmail</button>
                    </div>
                    {pendingSend ? (
                      <div className="alert alert-info letters-mail-confirm" role="alertdialog" aria-labelledby="mail-confirm-text">
                        <p id="mail-confirm-text">{`${mailSummary(pendingSend, SAMPLE_GMAIL)} Subject: ${pendingSend.subject}. Coverlay sends it when you press Send now, and nothing sooner.`}</p>
                        <div className="letters-mail-actions">
                          <button className="btn btn-primary btn-sm" type="button" onClick={sendNow}>Send now</button>
                          <button className="btn btn-ghost btn-sm" id="mail-send-cancel" type="button" onClick={() => setPendingSend(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : null}
                    <p className="field-hint" role="status">{mailResult}</p>
                  </div>
                )}
              </section>
            ) : null}
          </article>

          <article className="card letters-suggest" aria-labelledby="suggest-title">
            <div className="card-head"><h2 id="suggest-title">Lay AI suggests</h2></div>
            <p className="muted letters-lead">Only facts from your resume. Nothing changes until you add it.</p>
            <ul className="lay-suggest-list">
              {suggestions.length === 0 ? <li className="muted">No suggestions for this draft.</li> : null}
              {suggestions.map((item) => {
                const decided = state.decided[`${state.type}.${item.id}`];
                return (
                  <li className={`lay-suggest-item is-${decided ?? 'open'}`} key={item.id}>
                    <div className="lay-suggest-top">
                      <strong>{item.label}</strong>
                      {decided === 'added' ? <span className="badge badge-green"><Icon name="check" />Added</span> : decided === 'skipped' ? <span className="badge">Skipped</span> : null}
                    </div>
                    <p className="lay-diff-new">{`+ ${item.text}`}</p>
                    {!decided ? (
                      <span className="lay-suggest-actions">
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => decide(item.id, true)}>Add</button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => decide(item.id, false)}>Skip</button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </article>
        </section>
      </div>
    </>
  );
}
