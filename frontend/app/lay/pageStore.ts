import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { AnswerLike } from './types';

// A page that knows more than Lay AI does (the Applications board) adds its own quick questions and answers.
// Lay AI's own work (a job description, a skill, a match, an email) is answered first; the page answers the rest.

export interface LayPage {
  sub: string;
  greeting: string;
  prompts: string[];
}

type PageAnswer = (text: string) => AnswerLike | Promise<AnswerLike | null | undefined> | null | undefined;

const DEFAULT_PAGE: LayPage = {
  sub: 'Preview: answers from your own data',
  greeting:
    "Hi, I'm Lay AI. Tell me what you have learned and paste a job description, and I can update your resume, match it to the job and draft the email to the recruiter. I ask before I change anything.",
  prompts: ['I learned Docker, add it to my resume', 'Match my resume to a job', 'Draft a cold email'],
};

let page: LayPage = DEFAULT_PAGE;
let answer: PageAnswer | null = null;
const listeners = new Set<() => void>();

function set(next: LayPage, nextAnswer: PageAnswer | null) {
  page = next;
  answer = nextAnswer;
  listeners.forEach((listener) => listener());
}

export const pageAnswer = (text: string) => (answer ? answer(text) : null);

export function useLayPageConfig(): LayPage {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => page,
    () => DEFAULT_PAGE,
  );
}

/**
 * A page registers its own Lay AI answers while it is shown. `answer` may close over the page's state: the latest one
 * is always used, and the page's quick questions change only when its own text does.
 */
export function useLayPage(config: LayPage & { answer: PageAnswer }): void {
  const latest = useRef(config.answer);
  latest.current = config.answer;
  const { sub, greeting } = config;
  const promptsKey = config.prompts.join('\n');
  useEffect(() => {
    set({ sub, greeting, prompts: promptsKey.split('\n') }, (text) => latest.current(text));
    return () => set(DEFAULT_PAGE, null);
  }, [sub, greeting, promptsKey]);
}
