import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATARS, PHOTO_MAX_BYTES, PHOTO_SIZE, LINKEDIN_STEPS,
  avatarKey, cropSquare, parseAvatar, serialiseAvatar, validateLinkedinFile, validatePhotoFile,
} from '../src/js/pages/avatar-rules.js';

const file = (name, type, size) => ({ name, type, size });

test('there are eight ready-made avatars, each with a unique id, a label and readable colours', () => {
  assert.equal(AVATARS.length, 8);
  assert.equal(new Set(AVATARS.map((a) => a.id)).size, 8);
  for (const a of AVATARS) {
    assert.ok(a.label && /^#[0-9a-f]{6}$/.test(a.bg) && /^#[0-9a-f]{6}$/.test(a.fg), a.id);
  }
});

test('a photo must be a JPEG, PNG or WebP of at most 5 MB', () => {
  assert.equal(validatePhotoFile(file('me.jpg', 'image/jpeg', 1000)), null);
  assert.equal(validatePhotoFile(file('me.png', 'image/png', PHOTO_MAX_BYTES)), null);
  assert.equal(validatePhotoFile(file('me.webp', 'image/webp', 10)), null);
  assert.match(validatePhotoFile(file('me.gif', 'image/gif', 10)), /JPEG, PNG or WebP/);
  assert.match(validatePhotoFile(file('me.svg', 'image/svg+xml', 10)), /JPEG, PNG or WebP/);
  assert.match(validatePhotoFile(file('cv.pdf', 'application/pdf', 10)), /JPEG, PNG or WebP/);
  assert.match(validatePhotoFile(file('big.jpg', 'image/jpeg', PHOTO_MAX_BYTES + 1)), /5 MB/);
  assert.match(validatePhotoFile(file('empty.jpg', 'image/jpeg', 0)), /empty/);
  assert.match(validatePhotoFile(null), /Choose/);
});

test('the crop is the largest centred square, so a wide or tall photo fits the circle without stretching', () => {
  assert.deepEqual(cropSquare(1000, 500), { sx: 250, sy: 0, size: 500 });
  assert.deepEqual(cropSquare(400, 900), { sx: 0, sy: 250, size: 400 });
  assert.deepEqual(cropSquare(300, 300), { sx: 0, sy: 0, size: 300 });
  assert.equal(PHOTO_SIZE, 256);
});

test('a saved choice round-trips, and anything unexpected falls back to the initials', () => {
  assert.deepEqual(parseAvatar(null), { kind: 'none' });
  assert.deepEqual(parseAvatar('not json'), { kind: 'none' });
  assert.deepEqual(parseAvatar(serialiseAvatar({ kind: 'preset', id: AVATARS[2].id })), { kind: 'preset', id: AVATARS[2].id });
  const src = 'data:image/jpeg;base64,/9j/AAAA';
  assert.deepEqual(parseAvatar(serialiseAvatar({ kind: 'photo', src })), { kind: 'photo', src });
  assert.deepEqual(parseAvatar(JSON.stringify({ kind: 'preset', id: 'nope' })), { kind: 'none' });
  assert.deepEqual(parseAvatar(JSON.stringify({ kind: 'photo', src: 'https://evil.example/x.png' })), { kind: 'none' });
  assert.deepEqual(parseAvatar(JSON.stringify({ kind: 'photo', src: 'data:image/svg+xml;base64,PHN2Zz4=' })), { kind: 'none' });
  assert.deepEqual(parseAvatar(JSON.stringify({ kind: 'photo', src: 'javascript:alert(1)' })), { kind: 'none' });
  assert.equal(serialiseAvatar({ kind: 'none' }), null);
});

test('the choice is stored per person', () => {
  assert.equal(avatarKey('u1'), 'coverlay.preview.avatar.u1');
  assert.equal(avatarKey(undefined), 'coverlay.preview.avatar.guest');
});

test('LinkedIn import takes a PDF only, and tells the person the three steps', () => {
  assert.equal(validateLinkedinFile(file('Profile.pdf', 'application/pdf', 1000)), null);
  assert.match(validateLinkedinFile(file('cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10)), /PDF/);
  assert.match(validateLinkedinFile(null), /Choose/);
  assert.equal(LINKEDIN_STEPS.length, 3);
});
