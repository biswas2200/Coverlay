import type { BuilderState } from '@/types/builder';
import type { Resume } from '@/types/resume';
import { currentResume, isSavedState, sampleResume } from '@legacy/pages/resume-builder-rules.js';
import { readJson } from './storage';

/** Where the Builder keeps its state for one person (their resume versions, messages and format). */
export const builderKey = (userId: string | undefined) => `coverlay.resumeBuilder.${userId ?? 'guest'}`;

/** The Builder's saved state, or null when there is none or it is not one the page can show. */
export function readBuilderState(userId: string | undefined): BuilderState | null {
  const saved = readJson(builderKey(userId));
  return isSavedState(saved) ? (saved as BuilderState) : null;
}

/** The resume from the Builder, so what is edited there shows up on the other pages; the sample resume until there is one. */
export function builderResume(userId: string | undefined): Resume {
  const saved = readBuilderState(userId);
  return (saved?.history ? currentResume(saved.history) : sampleResume()) as Resume;
}
