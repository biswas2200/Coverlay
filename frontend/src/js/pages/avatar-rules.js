// The profile picture (preview): a photo the person uploads, one of eight ready-made avatars, or their initials.
// The choice is kept per person in this browser; the real build stores the photo with the account and serves it
// from the API (docs/prototype-spec.md, RB-PIC). DOM-free, so tests/avatar-rules.test.js can run it in Node.

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_SIZE = 256; // the photo is cut to a 256 x 256 square, which is plenty for a 96 px circle on a sharp screen
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// A photo is stored as a JPEG, PNG or WebP data URL only: never SVG (it can carry script), never a web address.
const PHOTO_SRC = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const PHOTO_SRC_MAX = 400_000;

/** Ready-made avatars: a colour, a figure drawn in a second colour, a name for screen readers. Every pair is 4.5:1 or better. */
export const AVATARS = [
  { id: 'sky', label: 'Sky', bg: '#d6e2ff', fg: '#1f3fb8' },
  { id: 'mint', label: 'Mint', bg: '#c6f3d8', fg: '#0b5d2e' },
  { id: 'sun', label: 'Sun', bg: '#ffe9a8', fg: '#7a4a00' },
  { id: 'coral', label: 'Coral', bg: '#ffd4c4', fg: '#8a2c0d' },
  { id: 'violet', label: 'Violet', bg: '#e6dcff', fg: '#4a2a9e' },
  { id: 'slate', label: 'Slate', bg: '#e4e7ec', fg: '#2b3340' },
  { id: 'ink', label: 'Ink', bg: '#111111', fg: '#ffffff' },
  { id: 'sand', label: 'Sand', bg: '#f1e3cf', fg: '#5c3d12' },
];

export function validatePhotoFile(file) {
  if (!file) return 'Choose a photo first.';
  if (!PHOTO_TYPES.includes(file.type)) return 'Use a JPEG, PNG or WebP photo.';
  if (file.size === 0) return 'That photo is empty.';
  if (file.size > PHOTO_MAX_BYTES) return 'That photo is over 5 MB. Choose a smaller one.';
  return null;
}

/** The largest square in the middle of a width x height photo, so it fills a circle without being stretched. */
export function cropSquare(width, height) {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

export function avatarKey(userId) {
  return `coverlay.preview.avatar.${userId ?? 'guest'}`;
}

export function serialiseAvatar(choice) {
  if (choice?.kind === 'preset' || choice?.kind === 'photo') return JSON.stringify(choice);
  return null;
}

/** Reads a saved choice. Anything unexpected (damaged, edited by hand, a web address, an SVG) becomes "none": the initials. */
export function parseAvatar(raw) {
  const none = { kind: 'none' };
  if (!raw) return none;
  try {
    const value = JSON.parse(raw);
    if (value?.kind === 'preset' && AVATARS.some((a) => a.id === value.id)) return { kind: 'preset', id: value.id };
    if (value?.kind === 'photo' && typeof value.src === 'string' && value.src.length <= PHOTO_SRC_MAX && PHOTO_SRC.test(value.src)) {
      return { kind: 'photo', src: value.src };
    }
  } catch {
    /* fall through */
  }
  return none;
}

export const LINKEDIN_STEPS = [
  'On LinkedIn, open your profile and choose More, then Save to PDF.',
  'Choose that PDF here. Nothing else is read from LinkedIn, and there is no sign-in.',
  'We fill a new resume version from it. Check it, then open it in the Builder.',
];

export function validateLinkedinFile(file) {
  if (!file) return 'Choose the PDF you saved from LinkedIn.';
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name ?? '')) return 'LinkedIn saves your profile as a PDF. Choose that PDF.';
  return null;
}
