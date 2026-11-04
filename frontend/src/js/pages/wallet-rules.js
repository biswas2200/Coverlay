// The pay-as-you-go wallet (preview, sample data): recharge in rupees, spend credits on the
// actions that use AI. Everything else is free. Prices are set from what each action costs in
// AI (Gemini list prices, measured token counts, about 2x for servers, the payment gateway, a
// buffer and a small fee), and every price is shown before the action runs -- nothing is
// added at checkout. DOM-free so tests/wallet-rules.test.js can run it in Node.

export const RUPEES_PER_CREDIT = 0.1;
export const MIN_RECHARGE = 60;
export const MAX_RECHARGE = 2000;
export const RECHARGE_OPTIONS = [60, 100, 250, 500, 1000, 2000];

/** What each AI action costs, in credits (1 credit = ₹0.10). */
export const ACTIONS = [
  { id: 'analysis', label: 'Resume analysis', credits: 8, note: 'Reads your resume, scores it, matches roles' },
  { id: 'chat', label: 'Lay AI message', credits: 3, note: 'One question and its answer' },
  { id: 'tailor', label: 'Resume tailored to a job', credits: 25, note: 'Written by Gemini 3.8 Flash' },
  { id: 'cover_letter', label: 'Cover letter', credits: 18, note: 'Written by Gemini 3.8 Flash' },
  { id: 'cold_email', label: 'Cold email', credits: 11, note: 'Written by Gemini 3.8 Flash' },
];

export const FREE_ACTIONS = [
  'Downloading your resume as PDF',
  'Jobs for you, saved jobs and the watchlist',
  'The applications tracker and its reminders',
  'Community posts',
  'Keeping your resumes and every version',
];

/** One full journey: from the first upload to a few tailored applications. */
export const JOURNEY = { analysis: 1, chat: 30, tailor: 3, cover_letter: 3, cold_email: 5 };

export function actionById(id) {
  return ACTIONS.find((a) => a.id === id) ?? null;
}

export function creditsFor(rupees) {
  return Math.round(rupees / RUPEES_PER_CREDIT);
}

export function rupeesFor(credits) {
  return Math.round(credits * RUPEES_PER_CREDIT * 100) / 100;
}

/** "₹1,000" or "₹28.20": Indian digit grouping, paise only when there are some. */
export function formatRupees(amount) {
  const whole = Number.isInteger(amount);
  return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount)}`;
}

/** The journey line by line: `{ rows: [{ action, count, credits }], credits, rupees }`. */
export function journeyCost(journey = JOURNEY) {
  const rows = Object.entries(journey).map(([id, count]) => {
    const action = actionById(id);
    return { action, count, credits: action.credits * count };
  });
  const credits = rows.reduce((sum, row) => sum + row.credits, 0);
  return { rows, credits, rupees: rupeesFor(credits) };
}

/** How many full journeys a recharge covers. */
export function journeysCovered(rupees) {
  return Math.floor(creditsFor(rupees) / journeyCost().credits);
}

/** Why a recharge amount can't be used, or null when it can. */
export function validateRecharge(amount) {
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return 'Enter an amount in rupees.';
  }
  if (!Number.isInteger(amount)) {
    return 'Whole rupees only.';
  }
  if (amount < MIN_RECHARGE) {
    return `The smallest recharge is ${formatRupees(MIN_RECHARGE)}: about two full journeys.`;
  }
  if (amount > MAX_RECHARGE) {
    return `The largest recharge is ${formatRupees(MAX_RECHARGE)} at a time: about a month of heavy use.`;
  }
  return null;
}

/** The actions the balance can no longer pay for. */
export function unaffordable(balance) {
  return ACTIONS.filter((a) => balance < a.credits);
}

/** A warning for a low balance, or null. Shown before an action, never after it failed. */
export function lowBalanceWarning(balance) {
  const missing = unaffordable(balance);
  if (missing.length === 0) {
    return balance < journeyCost().credits ? `${balance} credits left: less than one full journey (${journeyCost().credits}).` : null;
  }
  const names = missing.map((a) => a.label.toLowerCase());
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${balance} credits can't pay for a ${list}. Recharge from ${formatRupees(MIN_RECHARGE)}.`;
}

export function emptyWallet() {
  return { balance: 0, history: [] };
}

/** The wallet after a recharge (a new object); unchanged when the amount isn't valid. */
export function applyRecharge(wallet, rupees, at) {
  if (validateRecharge(rupees)) {
    return wallet;
  }
  const credits = creditsFor(rupees);
  return {
    balance: wallet.balance + credits,
    history: [{ kind: 'recharge', label: `Recharge ${formatRupees(rupees)}`, credits, at }, ...wallet.history],
  };
}

/** The wallet after an action is paid for; unchanged when the balance is too low. */
export function spend(wallet, actionId, at) {
  const action = actionById(actionId);
  if (!action || wallet.balance < action.credits) {
    return wallet;
  }
  return {
    balance: wallet.balance - action.credits,
    history: [{ kind: 'spend', label: action.label, credits: -action.credits, at }, ...wallet.history],
  };
}

/** Community points moved into the wallet (1 point = 1 credit). */
export function addPoints(wallet, points, at) {
  if (!Number.isInteger(points) || points <= 0) {
    return wallet;
  }
  return {
    balance: wallet.balance + points,
    history: [{ kind: 'points', label: 'Community points', credits: points, at }, ...wallet.history],
  };
}

/** A believable starting wallet for the preview: one ₹60 recharge, partly spent. */
export function sampleWallet(now) {
  const day = 24 * 60 * 60 * 1000;
  let wallet = applyRecharge(emptyWallet(), 60, now - 6 * day);
  wallet = spend(wallet, 'analysis', now - 6 * day + 60_000);
  for (let i = 0; i < 12; i += 1) {
    wallet = spend(wallet, 'chat', now - 5 * day + i * 60_000);
  }
  wallet = spend(wallet, 'tailor', now - 2 * day);
  wallet = spend(wallet, 'cover_letter', now - 2 * day + 120_000);
  return wallet;
}

export function isWallet(value) {
  return !!value && Number.isInteger(value.balance) && value.balance >= 0 && Array.isArray(value.history);
}

export function walletKey(userId) {
  return `coverlay.preview.wallet.${userId ?? 'guest'}`;
}
