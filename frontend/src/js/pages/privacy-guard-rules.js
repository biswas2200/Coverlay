// The personal-data guard, as the preview shows it (the real one runs in the ML service and the
// backend before anything is stored, logged or sent to Gemini). Personal details a user types
// -- their name, college, company, email, phone, links -- are replaced by placeholders such as
// {user.college} that point to the account's own values. Only the account (the "vault") holds
// the real values: the user's screen fills them back in, and once the account is deleted every
// placeholder resolves to null while the rest of the record stays useful
// ("subject 7f3a asked about the {user.college} hackathon; resume v3 got an interview").
//
// Detection, in order: the account's own known values (exact, case-insensitive), then
// patterns for other emails, phone numbers and links. DOM-free so tests can run it in Node.

export const PLACEHOLDER_LABELS = {
  'user.name': 'your name',
  'user.first_name': 'your name',
  'user.email': 'your email',
  'user.phone': 'your phone number',
  'user.college': 'your college',
  'user.company': 'your company',
  'user.link': 'your link',
};

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?<![\w+])\+?\d[\d -]{8,}\d(?!\w)/g;
// A link ends before trailing punctuation ("see linkedin.com/in/x." keeps its full stop).
const LINK = /\b(?:https?:\/\/|www\.|(?:linkedin|github)\.com\/)[^\s<>"']*[^\s<>"'.,;:!?)]/gi;
const PLACEHOLDER = /\{((?:user|other)\.[a-z_]+(?:_\d+)?)\}/g;

function plain(text) {
  // Strips the builder's tiny markup (<b>, <a href> ...) so values are matched as text.
  return String(text ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

/** "Software Engineer, Acme Corp" -> "Acme Corp": the part after the last comma. */
function afterComma(text) {
  const parts = plain(text).split(',');
  return parts.length > 1 ? parts.at(-1).trim() : '';
}

/**
 * The account's personal values the guard looks for, from a builder resume
 * (`{ name, contact, experience[], education[] }`): `{ 'user.name': 'Jane Doe', ... }`.
 * Missing values are left out.
 */
export function knownValues(resume) {
  if (!resume) {
    return {};
  }
  const values = {};
  const name = plain(resume.name);
  if (name) {
    values['user.name'] = name;
    const first = name.split(/\s+/)[0];
    if (first.length >= 3 && first !== name) {
      values['user.first_name'] = first;
    }
  }
  const contact = plain(resume.contact);
  const email = contact.match(EMAIL)?.[0];
  if (email) {
    values['user.email'] = email;
  }
  const phone = contact.match(PHONE)?.[0];
  if (phone) {
    values['user.phone'] = phone.trim();
  }
  const link = String(resume.contact ?? '').match(/href="([^"]+)"/)?.[1] ?? contact.match(LINK)?.[0];
  if (link) {
    values['user.link'] = link;
  }
  const college = afterComma(resume.education?.[0]?.degree);
  if (college.length >= 2) {
    values['user.college'] = college;
  }
  const company = afterComma(resume.experience?.[0]?.role);
  if (company.length >= 2) {
    values['user.company'] = company;
  }
  return values;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Phone numbers have 10 to 15 digits; "2019 - 2021" is a date range, not a phone. */
function isPhone(text) {
  const digits = text.replace(/\D/g, '').length;
  return digits >= 10 && digits <= 15;
}

/**
 * The text as it would be stored: `{ stored, found, vault }`.
 * - `stored` has every personal detail replaced by a placeholder. It is what analytics, logs
 *   and Gemini get.
 * - `found` lists the placeholder keys, in order of first appearance.
 * - `vault` maps each key to the text it replaced. It belongs to the account (it is deleted
 *   with it) and fills the placeholders back in on the user's own screen.
 * Known values are matched whole-word and case-insensitive, longest first (so "Jane Doe" wins
 * over "Jane"); other emails, phone numbers and links become {other.email_1}, {other.phone_1},
 * {other.link_1}.
 */
export function guardText(text, values = {}) {
  let stored = String(text ?? '');
  const vault = {};
  const note = (key, original) => {
    if (!(key in vault)) {
      vault[key] = original;
    }
  };
  const known = Object.entries(values)
    .filter(([, value]) => value)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, value] of known) {
    const pattern = new RegExp(`(?<![\\w@])${escapeRegExp(value)}(?![\\w@])`, 'gi');
    stored = stored.replace(pattern, (original) => {
      note(key, original);
      return `{${key}}`;
    });
  }
  const counters = { email: 0, phone: 0, link: 0 };
  const other = (kind, accept = () => true) => (original) => {
    if (!accept(original)) {
      return original;
    }
    counters[kind] += 1;
    const key = `other.${kind}_${counters[kind]}`;
    note(key, original);
    return `{${key}}`;
  };
  stored = stored.replace(EMAIL, other('email')).replace(LINK, other('link')).replace(PHONE, other('phone', isPhone));
  const found = [...new Set([...stored.matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((key) => key in vault);
  return { stored, found, vault };
}

/**
 * Fills placeholders back in from a vault (guardText's, or knownValues of the account). With no
 * value for a key -- the account was deleted, so its vault is gone -- the placeholder becomes
 * `missing(key)`: "null" by default.
 */
export function resolveText(stored, values = {}, missing = () => 'null') {
  return String(stored ?? '').replace(PLACEHOLDER, (_, key) => values?.[key] ?? missing(key));
}

/** "Your name and college stay private." for the lock chip, or null when nothing was found. */
export function privacyNote(found) {
  const labels = [...new Set(found.map((key) => PLACEHOLDER_LABELS[key] ?? labelForOther(key)))];
  if (labels.length === 0) {
    return null;
  }
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  const text = `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
  return `${text} ${labels.length === 1 ? 'stays' : 'stay'} private.`;
}

function labelForOther(key) {
  if (key.startsWith('other.email')) {
    return 'an email address';
  }
  if (key.startsWith('other.phone')) {
    return 'a phone number';
  }
  return 'a link';
}
