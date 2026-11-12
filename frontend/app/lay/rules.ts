import * as agentRules from '@legacy/pages/lay-agent-rules.js';
import * as agent from '@legacy/pages/lay-agent.js';
import type { Resume } from '@/types/resume';
import type { AgentContext, AgentPayload, AgentStepResult, AgentTurn, Handoff, JobDescription } from './types';

// The rules and the device glue are plain JavaScript (tested with `npm test`); this file gives their edges types.

export const agentTurn = agentRules.agentTurn as unknown as (text: string, ctx?: AgentContext) => AgentTurn | null;
export const agentStep = agentRules.agentStep as unknown as (id: string, payload?: AgentPayload, ctx?: AgentContext, now?: number) => AgentStepResult;
export const HELP_REPLY: string = agentRules.HELP_REPLY;

interface Environment {
  resume: Resume | null;
  style: string;
  jd: JobDescription | null;
  gmail: boolean;
  applications: unknown[];
}

export const readEnvironment = agent.readEnvironment as unknown as () => Environment;
export const rememberJd = agent.rememberJd as unknown as (jd: JobDescription) => void;
export const rememberedJd = agent.rememberedJd as unknown as () => JobDescription | null;
export const gmailConnected = agent.gmailConnected as unknown as () => boolean;
export const leaveHandoff = agent.leaveHandoff as unknown as (handoff: Handoff | undefined) => void;
export const builderHandoff = agent.builderHandoff as unknown as (options?: { take?: boolean }) => { skills: string[]; jd: JobDescription | null } | null;
export const fillFor = agent.fillFor as unknown as (resume: Resume | null) => (text: string) => string;
export const guardFor = agent.guardFor as unknown as (resume: Resume | null) => (text: string) => { stored: string };
export const chatHistory = agent.chatHistory as unknown as {
  load: () => { who: 'you' | 'lay'; text: string; card?: { subject: string; body: string } }[];
  save: (list: { who: 'you' | 'lay'; text: string; card?: { subject: string; body: string } }[]) => void;
};

export const lettersHandoff = agent.lettersHandoff as unknown as (options?: { take?: boolean }) => {
  job: { id: string; title: string; company: string; skills: string[] };
} | null;
