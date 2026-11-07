import { mergeSegments, parseInline, serializeSegments } from './resume-builder-rules.js';
import { safeFileName } from './docx-writer.js';

// Sending a cold email from the person's own mail account (preview, sample data). The email, the
// resume and the cover letter go out as ONE message, so nobody downloads three files and attaches
// them by hand. Only Gmail for now; the provider is a field of the request so Outlook and others can
// be added later. The person always presses the button: Lay AI never sends anything, and a send asks
// for a second confirmation. DOM-free so tests/mail-rules.test.js can run it in Node; the real build's
// backend repeats these checks (docs/prototype-spec.md, RB-LET).

export const MAIL_PROVIDERS = [
  { id: 'gmail', label: 'Gmail', available: true },
  { id: 'outlook', label: 'Outlook', available: false },
];

/** The account the preview pretends to be connected to; no mail is read, saved or sent in the preview. */
export const SAMPLE_GMAIL = 'jane.doe@gmail.com';

export const ATTACHMENT_KINDS = { resume: 'Resume', cover: 'Cover letter' };
export const ATTACHMENT_FORMATS = ['pdf', 'docx'];
export const LIMITS = { subject: 200, body: 20000, markup: 40000, address: 254 };

/** A single address, lower-cased, or null (a list, a name with brackets, or anything that is not an address). */
export function cleanRecipient(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text || text.length > LIMITS.address) {
    return null;
  }
  return /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]{2,}$/.test(text) ? text : null;
}

/** One line of at most 200 characters, with no line breaks (a break in a subject could add a mail header). */
export function cleanSubject(raw) {
  return String(raw ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.subject);
}

/** "Jane-Doe-Resume.pdf" or "Jane-Doe-Cover-Letter.docx". */
export function attachmentName(kind, format, personName) {
  return safeFileName([personName, kind === 'cover' ? 'Cover-Letter' : 'Resume'], format);
}

/**
 * Checks a request to put an email in the person's mailbox and returns `{ ok: true, request }` with
 * everything cleaned, or `{ ok: false, error }` in words for the person. `action` is `draft`
 * (saved in the Drafts folder, nothing sent) or `send`. `attachments` is `[{ kind, format }]`.
 */
export function buildMailRequest({ provider = 'gmail', action, to, subject, body, bodyMarkup, attachments = [] }, personName = '') {
  const found = MAIL_PROVIDERS.find((p) => p.id === provider);
  if (!found?.available) {
    return { ok: false, error: `${found?.label ?? 'That mail service'} is not available yet. Gmail is.` };
  }
  if (action !== 'draft' && action !== 'send') {
    return { ok: false, error: 'Choose to save a draft or to send.' };
  }
  const address = String(to ?? '').trim() ? cleanRecipient(to) : null;
  if (String(to ?? '').trim() && !address) {
    return { ok: false, error: 'That does not look like one email address. Use a single address like recruiter@company.com.' };
  }
  if (action === 'send' && !address) {
    return { ok: false, error: 'Add the address to send to. A draft can wait for it, a send cannot.' };
  }
  const cleanedSubject = cleanSubject(subject);
  if (!cleanedSubject) {
    return { ok: false, error: 'The email needs a subject.' };
  }
  const text = String(body ?? '').trim();
  if (!text) {
    return { ok: false, error: 'The email is empty.' };
  }
  if (text.length > LIMITS.body) {
    return { ok: false, error: 'The email is too long to send.' };
  }
  // The same email with its bold, italics, underline and links: the real backend sends it as the HTML part, next
  // to the plain text above. Only the resume's small markup survives (RB-DATA-03), written one way.
  const markup = String(bodyMarkup ?? '').trim();
  if (markup.length > LIMITS.markup) {
    return { ok: false, error: 'The email is too long to send.' };
  }
  const seen = new Set();
  const files = [];
  for (const item of attachments) {
    if (!(item.kind in ATTACHMENT_KINDS) || !ATTACHMENT_FORMATS.includes(item.format)) {
      return { ok: false, error: 'One of the attachments is not something Coverlay can attach.' };
    }
    if (!seen.has(item.kind)) {
      seen.add(item.kind);
      files.push({ kind: item.kind, format: item.format, fileName: attachmentName(item.kind, item.format, personName) });
    }
  }
  return {
    ok: true,
    request: {
      provider, action, to: address, subject: cleanedSubject, body: text,
      ...(markup ? { bodyMarkup: serializeSegments(mergeSegments(parseInline(markup))) } : {}),
      attachments: files,
    },
  };
}

/**
 * What a request does, in one sentence: before it runs ("Send from ... to ...") for the confirmation, or
 * after it ran (`done: true`: "Sent from ... to ...") for the result.
 */
export function mailSummary(request, account, { done = false } = {}) {
  const files = request.attachments.map((a) => `${ATTACHMENT_KINDS[a.kind]} ${a.format.toUpperCase()}`);
  const withFiles = files.length ? ` with ${files.length === 1 ? 'one attachment' : `${files.length} attachments`} (${files.join(', ')})` : ' with no attachments';
  if (request.action === 'send') {
    return `${done ? 'Sent' : 'Send'} from ${account} to ${request.to}${withFiles}.`;
  }
  return `${done ? 'Saved' : 'Save'} in the Drafts of ${account}${request.to ? ` for ${request.to}` : ''}${withFiles}. ${done ? 'Nothing was sent.' : 'Nothing is sent.'}`;
}
