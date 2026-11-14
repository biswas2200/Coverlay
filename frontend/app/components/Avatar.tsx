import { AVATARS } from '@legacy/pages/avatar-rules.js';
import type { AvatarChoice } from '@/lib/avatar';

type Preset = { id: string; label: string; bg: string; fg: string };

/** A ready-made avatar: a round head and shoulders in one colour on another. Drawn, not an image file, so it is sharp at any size. */
export function PresetFigure({ preset }: { preset: Preset }) {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
      <rect width="64" height="64" fill={preset.bg} />
      <circle cx="32" cy="25" r="11" fill={preset.fg} />
      <path d="M10 64c0-13 9.8-21 22-21s22 8 22 21z" fill={preset.fg} />
    </svg>
  );
}

/**
 * The person's picture in a round frame of `size` px. A photo is already cut square, and `object-fit: cover` keeps it
 * filling the circle whatever the frame; a ready-made avatar is drawn to the frame; with neither, the initials.
 */
export function Avatar({ choice, initials, size = 38, className = '' }: { choice: AvatarChoice; initials: string; size?: number; className?: string }) {
  const preset = choice.kind === 'preset' ? (AVATARS as Preset[]).find((a) => a.id === choice.id) : undefined;
  return (
    <span className={`avatar ${className}`.trim()} style={{ width: size, height: size, fontSize: Math.round(size * 0.37) }} aria-hidden="true">
      {choice.kind === 'photo' ? <img src={choice.src} alt="" /> : preset ? <PresetFigure preset={preset} /> : initials}
    </span>
  );
}
