import { activityKey, isJobActivity, newJobActivity, recordJobOpen } from '@legacy/pages/activity-rules.js';
import { readJson, writeJson } from '@/lib/storage';

// The job postings a person opened, for "My activity". Written straight to this browser's storage when Apply or View
// posting is pressed (no state, so the job list does not redraw). The real build keeps this list on the server,
// owner-only (RB-ACT-03).

export function noteJobOpened(userId: string | undefined, job: { id: string; title?: string; company?: string }): void {
  const key = activityKey(userId ?? 'guest');
  const saved = readJson(key);
  writeJson(key, recordJobOpen(isJobActivity(saved) ? saved : newJobActivity(), job, Date.now()));
}
