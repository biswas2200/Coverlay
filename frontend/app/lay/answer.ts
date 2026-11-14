import { toRoute } from '@/lib/routes';
import { pageAnswer } from './pageStore';
import { HELP_REPLY, agentStep, agentTurn, fillFor, guardFor, leaveHandoff, readEnvironment, rememberJd } from './rules';
import type { AgentPayload, AgentStepResult, AgentTurn, AnswerLike, ChatAction } from './types';

// Lay AI on every page except the Builder: one answerer, the same everywhere. What it can do, with the person's yes
// at each step, is in lay-agent-rules.js: add skills they have learned to the resume, tailor it to a job description
// they paste, match it, and draft a cold email. A page that knows more adds its own answers (pageStore.ts); Lay AI's
// own work comes first when a message asks for it.

const OPENING_MS = 900; // a moment to read "Opening the Builder" before the page changes

/** The answer to one message. `navigate` opens a page of the app (a step that hands a request to the Builder or Letters). */
export function createAnswerer(navigate: (to: string) => void) {
  function actionsOf(turn: { actions?: AgentTurn['actions'] }, payload: AgentPayload | undefined): ChatAction[] {
    return (turn.actions ?? []).map((item) => ({ label: item.label, primary: item.primary, run: () => runStep(item.id, payload) }));
  }

  function fillCard(card: AgentTurn['card'], fill: (text: string) => string) {
    return card ? { subject: fill(card.subject), body: fill(card.body) } : null;
  }

  function runStep(id: string, payload: AgentPayload | undefined): AnswerLike {
    const env = readEnvironment();
    const fill = fillFor(env.resume);
    const step: AgentStepResult = agentStep(id, payload, { ...env, onBuilder: false, fill }, Date.now());
    if (step.payload?.jd) {
      rememberJd(step.payload.jd);
    }
    if (step.effect?.type === 'navigate') {
      const { href, handoff } = step.effect;
      leaveHandoff(handoff);
      window.setTimeout(() => navigate(toRoute(href)), OPENING_MS);
    }
    return { reply: step.reply, card: fillCard(step.card, fill), actions: actionsOf(step, step.payload) };
  }

  function present(turn: AgentTurn, fill: (text: string) => string): AnswerLike {
    if (turn.payload?.jd) {
      rememberJd(turn.payload.jd);
    }
    return { reply: turn.reply, card: fillCard(turn.card, fill), actions: actionsOf(turn, turn.payload) };
  }

  return async function answer(text: string): Promise<AnswerLike> {
    const env = readEnvironment();
    const fill = fillFor(env.resume);
    // What Lay AI would send on is the guarded text: the person's name, college and contacts are placeholders.
    const guarded = guardFor(env.resume)(text).stored;
    const turn = agentTurn(guarded, { ...env, claim: 'all', onBuilder: false, fill });
    if (turn?.strong) {
      return present(turn, fill);
    }
    const own = await pageAnswer(text);
    if (own) {
      return own;
    }
    return turn ? present(turn, fill) : { reply: HELP_REPLY };
  };
}
