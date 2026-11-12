import { readJson, writeJson } from '../core/local-store.js';
import { getUser } from '../core/session.js';
import { isApplicationList, sampleApplications } from './applications-rules.js';
import { connectionsKey, isConnected, normalizeConnections } from './connections-rules.js';
import {
  builderHandoffKey,
  chatKey,
  cleanChat,
  cleanJd,
  lettersHandoffKey,
  memoryKey,
  readBuilderHandoff,
  readLettersHandoff,
} from './lay-agent-rules.js';
import { guardText, knownValues, resolveText } from './privacy-guard-rules.js';
import { currentResume, isSavedState, normalizeFormat } from './resume-builder-rules.js';

// The browser side of Lay AI's work across pages (the rules are in lay-agent-rules.js): what it reads from this
// device (the Builder's resume, whether Gmail is connected, the board, the last job description it read), what it
// leaves for the next page (the request for the Builder, the job for Letters), and the chat history. Everything
// stays in this browser in the preview; the real build keeps the same things in the account.

const userId = () => getUser()?.id ?? 'guest';
const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

/** The Builder's saved state: `{ resume, style }`, or null when there is no resume yet. */
export function builderResume() {
  const saved = readJson(`coverlay.resumeBuilder.${userId()}`);
  if (!isSavedState(saved) || !saved.history) {
    return null;
  }
  return { resume: currentResume(saved.history), style: normalizeFormat(saved.format).style };
}

export const gmailConnected = () => isConnected(normalizeConnections(readJson(connectionsKey(userId()))), 'gmail');

/** The last job description Lay AI read (its role, company and skills only), for a day. */
export function rememberedJd(now = Date.now()) {
  const memory = readJson(memoryKey(userId()));
  return memory && typeof memory.at === 'number' && now - memory.at <= MEMORY_TTL_MS ? cleanJd(memory.jd) : null;
}

export function rememberJd(jd, now = Date.now()) {
  const clean = cleanJd(jd);
  if (clean) {
    writeJson(memoryKey(userId()), { at: now, jd: clean });
  }
}

/** The applications board as the page keeps it (the sample board until the person has changed it). */
export function boardApplications(now = Date.now()) {
  const saved = readJson(`coverlay.preview.applications.${userId()}`);
  return isApplicationList(saved) ? saved : sampleApplications(now);
}

/** What the rules need to know from this device. */
export function readEnvironment() {
  const found = builderResume();
  return {
    resume: found?.resume ?? null,
    style: found?.style ?? 'formal',
    jd: rememberedJd(),
    gmail: gmailConnected(),
    applications: boardApplications(),
  };
}

/** The personal values for this screen: the Builder resume's, and "there" for the person the email greets. */
export function vaultFor(resume) {
  return { ...knownValues(resume), 'other.person_1': 'there' };
}

/** Text with its placeholders filled in for this screen, and the placeholders of a guard (text to placeholders). */
export const fillFor = (resume) => (text) => resolveText(text ?? '', vaultFor(resume), (key) => `{${key}}`);
export const guardFor = (resume) => (text) => guardText(text, knownValues(resume));

// ---------- what is left for the next page ----------

/** Stores what a step hands to another page (`{ key: 'builder' | 'letters', value }`). */
export function leaveHandoff(handoff) {
  if (handoff?.key === 'builder') {
    writeJson(builderHandoffKey(userId()), handoff.value);
  } else if (handoff?.key === 'letters') {
    writeJson(lettersHandoffKey(userId()), handoff.value);
  }
}

function takeOrPeek(key, read, { take }) {
  const value = read(readJson(key), Date.now());
  if (take) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage blocked: the page works without it.
    }
  }
  return value;
}

/** The request waiting for the Builder, if there is a fresh one. `take` removes it, as the Builder does once it has acted. */
export const builderHandoff = ({ take = false } = {}) => takeOrPeek(builderHandoffKey(userId()), readBuilderHandoff, { take });

/** The cold email job waiting for Letters, if there is a fresh one. */
export const lettersHandoff = ({ take = false } = {}) => takeOrPeek(lettersHandoffKey(userId()), readLettersHandoff, { take });

// ---------- the chat history ----------

export const chatHistory = {
  load: () => cleanChat(readJson(chatKey(userId()))),
  save: (list) => writeJson(chatKey(userId()), cleanChat(list)),
};
