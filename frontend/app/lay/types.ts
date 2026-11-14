import type { Resume } from '@/types/resume';

// What Lay AI's rules (src/js/pages/lay-agent-rules.js) take and answer with, typed once here.

export interface JobDescription {
  role: string | null;
  company: string | null;
  skills: string[];
  nice: string[];
}

export interface AgentContext {
  resume: Resume | null;
  style?: string;
  jd?: JobDescription | null;
  gmail?: boolean;
  onBuilder?: boolean;
  claim?: 'all' | 'builder';
  applications?: unknown[];
  fill?: (text: string) => string;
}

export interface AgentAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface EmailCard {
  subject: string;
  body: string;
}

export interface AgentTurn {
  strong?: boolean;
  reply: string;
  actions: AgentAction[];
  payload: AgentPayload;
  card?: EmailCard | null;
}

export interface AgentPayload {
  skills?: string[];
  jd?: JobDescription | null;
  href?: string;
}

export interface Handoff {
  key: 'builder' | 'letters';
  value: unknown;
}

export interface AgentStepResult {
  reply: string;
  actions?: AgentAction[];
  card?: EmailCard | null;
  payload?: AgentPayload;
  resume?: Resume;
  summary?: string;
  effect?: { type: 'navigate'; href: string; handoff?: Handoff };
}

/** A message in a Lay AI chat. Buttons are only on the message they were asked in; they are not kept with the history. */
export interface ChatMessage {
  id: string;
  who: 'you' | 'lay';
  text: string;
  card?: EmailCard | null;
  actions?: ChatAction[];
  settled?: boolean;
}

export interface ChatAction {
  label: string;
  primary?: boolean;
  /** What pressing it does; may answer with another message. */
  run: () => string | AnswerLike | void | Promise<string | AnswerLike | void>;
}

export interface AnswerLike {
  reply: string;
  actions?: ChatAction[];
  card?: EmailCard | null;
}
