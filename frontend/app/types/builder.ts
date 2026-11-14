import type { normalizeFormat } from '@legacy/pages/resume-builder-rules.js';
import type { Resume } from './resume';

// What the Resume Builder keeps in this browser (docs/prototype-spec.md, RB-VER and RB-DATA): the questions answered, the
// template, every version of the resume, the chat with Lay AI and the page format.

/** The page format (docs/prototype-spec.md, RB-FMT); `hidden` names the built-in sections that are not shown. */
export type BuilderFormat = Omit<ReturnType<typeof normalizeFormat>, 'hidden'> & { hidden: string[] };
export type BuilderStep = 'start' | 'templates' | 'editor' | 'finished';

export interface BuilderAnswers {
  role: string;
  level: string;
  style: string;
  pages: number;
}

export interface BuilderVersion {
  number: number;
  source: 'you' | 'ai' | 'template' | 'restore' | 'import';
  summary: string;
  at: number;
  resume: Resume;
}

export interface BuilderHistory {
  versions: BuilderVersion[];
  current: number;
}

export interface SuggestionItem {
  id: string;
  kind: 'skill' | 'summary';
  status: 'open' | 'have' | 'added' | 'skipped';
  skill?: string;
  share?: number;
  evidence?: string;
  before?: string;
  after?: string;
}

export interface AgentButton {
  id: string;
  label: string;
  primary: boolean;
}

/** A line in the Lay AI panel's chat. `stored` text has placeholders; the person's own screen fills them in from `vault`. */
export interface BuilderMessage {
  id: string;
  from: 'you' | 'lay';
  text: string;
  kind?: 'suggest' | 'agent';
  vault?: Record<string, string>;
  found?: string[];
  role?: string;
  items?: SuggestionItem[];
  card?: { subject: string; body: string } | null;
  actions?: AgentButton[];
  payload?: unknown;
  chosen?: string | null;
}

export interface BuilderState {
  step: BuilderStep;
  answers: BuilderAnswers;
  fromUpload: boolean;
  templateId: string | null;
  history: BuilderHistory | null;
  messages: BuilderMessage[];
  format: BuilderFormat;
}
