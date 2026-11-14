import { agentStep, agentTurn, HELP_REPLY } from '../pages/lay-agent-rules.js';
import { chatHistory, fillFor, guardFor, leaveHandoff, readEnvironment, rememberJd } from '../pages/lay-agent.js';
import { mountLayChat } from './lay-chat.js';

// Lay AI on every signed-in page except the Builder (which has its own panel). One chat, the same everywhere: the
// conversation follows the person from page to page. What it can do, with the person's yes at each step, is in
// lay-agent-rules.js: add skills they have learned to the resume, tailor it to a job description they paste, match
// it, and draft a cold email. A page that knows more (the Applications board) adds its own answers with
// setLayPage(); Lay AI's own work comes first when a message asks for it.

const GREETING = "Hi, I'm Lay AI. Tell me what you have learned and paste a job description, and I can update your resume, match it to the job and draft the email to the recruiter. I ask before I change anything.";
const PROMPTS = ['I learned Docker, add it to my resume', 'Match my resume to a job', 'Draft a cold email'];
const SUB = 'Preview: answers from your own data';

let instance = null;
let pageAnswer = null;

/** Mounts the chat once; later calls return it. */
export function mountGlobalLay() {
  if (instance) {
    return instance;
  }
  instance = mountLayChat({
    sub: SUB,
    greeting: GREETING,
    prompts: PROMPTS,
    answer,
    history: chatHistory,
    encode: (text) => guardFor(readEnvironment().resume)(text).stored,
    decode: (text) => fillFor(readEnvironment().resume)(text),
  });
  return instance;
}

/**
 * A page adds its own answers: `answer(text)` returns `{ reply, actions? }` or nothing when the message is not
 * about the page. Lay AI's own work (a job description, a skill, a match, an email) is answered first.
 */
export function setLayPage({ sub, greeting, prompts, answer: own }) {
  pageAnswer = own ?? null;
  mountGlobalLay().setPage({ sub, greeting, prompts });
}

async function answer(text) {
  const env = readEnvironment();
  // What Lay AI would send on is the guarded text: the person's name, college and contacts are placeholders.
  const guarded = guardFor(env.resume)(text).stored;
  const turn = agentTurn(guarded, { ...env, claim: 'all', onBuilder: false, fill: fillFor(env.resume) });
  if (turn?.strong) {
    return present(turn, env);
  }
  const own = pageAnswer ? await pageAnswer(text) : null;
  if (own) {
    return own;
  }
  return turn ? present(turn, env) : { reply: HELP_REPLY };
}

/** An answer of the rules as the chat shows it: the card filled in for this screen, the buttons running their steps. */
function present(turn, env) {
  if (turn.payload?.jd) {
    rememberJd(turn.payload.jd);
  }
  const fill = fillFor(env.resume);
  return {
    reply: turn.reply,
    card: turn.card ? { subject: fill(turn.card.subject), body: fill(turn.card.body) } : null,
    actions: (turn.actions ?? []).map((item) => ({ label: item.label, primary: item.primary, run: () => runStep(item.id, turn.payload) })),
  };
}

function runStep(id, payload) {
  const env = readEnvironment();
  const fill = fillFor(env.resume);
  const step = agentStep(id, payload, { ...env, onBuilder: false, fill }, Date.now());
  if (step.payload?.jd) {
    rememberJd(step.payload.jd);
  }
  if (step.effect?.type === 'navigate') {
    leaveHandoff(step.effect.handoff);
    // A moment to read the line first; the next page picks the request up.
    setTimeout(() => {
      location.href = step.effect.href;
    }, 900);
  }
  return {
    reply: step.reply,
    card: step.card ? { subject: fill(step.card.subject), body: fill(step.card.body) } : null,
    actions: (step.actions ?? []).map((item) => ({ label: item.label, primary: item.primary, run: () => runStep(item.id, step.payload) })),
  };
}
