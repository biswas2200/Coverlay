import { useSyncExternalStore } from 'react';
import { PHOTO_SIZE, avatarKey, cropSquare, parseAvatar, serialiseAvatar } from '@legacy/pages/avatar-rules.js';

// The profile picture, kept per person in this browser (the clickable preview). The real build stores the photo with
// the account. A tiny external store: choosing a picture in Settings changes the sidebar at once, with no reload.

export type AvatarChoice = { kind: 'none' } | { kind: 'preset'; id: string } | { kind: 'photo'; src: string };

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: AvatarChoice }>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function read(userId: string | undefined): AvatarChoice {
  const key = avatarKey(userId) as string;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    /* storage blocked: the initials show */
  }
  // useSyncExternalStore needs the same object back while nothing changed.
  const hit = cache.get(key);
  if (hit && hit.raw === raw) {
    return hit.value;
  }
  const value = parseAvatar(raw) as AvatarChoice;
  cache.set(key, { raw, value });
  return value;
}

export function useAvatar(userId: string | undefined): AvatarChoice {
  return useSyncExternalStore(subscribe, () => read(userId), () => ({ kind: 'none' }) as AvatarChoice);
}

export function setAvatar(userId: string | undefined, choice: AvatarChoice): boolean {
  try {
    const raw = serialiseAvatar(choice) as string | null;
    if (raw === null) {
      localStorage.removeItem(avatarKey(userId) as string);
    } else {
      localStorage.setItem(avatarKey(userId) as string, raw);
    }
    listeners.forEach((listener) => listener());
    return true;
  } catch {
    return false;
  }
}

/** Cuts the middle square out of a photo and shrinks it to PHOTO_SIZE, as a JPEG data URL: small enough to keep, sharp enough for the circle. */
export async function squarePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('That file could not be read as a photo.'));
      element.src = url;
    });
    const { sx, sy, size } = cropSquare(image.naturalWidth, image.naturalHeight) as { sx: number; sy: number; size: number };
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('This browser cannot resize photos.');
    }
    context.fillStyle = '#ffffff'; // a transparent PNG gets a white background instead of black
    context.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    context.drawImage(image, sx, sy, size, size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}
