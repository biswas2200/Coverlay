import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { PageHeader, PreviewBadge } from '@/components/PageHeader';
import { usePageTitle } from '@/lib/hooks';
import { useStoredState } from '@/lib/storage';
import { getUser } from '@/lib/session';
import { relativeTime } from '@legacy/pages/resume-builder-rules.js';
import {
  ACTIONS,
  FREE_ACTIONS,
  MAX_RECHARGE,
  MIN_RECHARGE,
  RECHARGE_OPTIONS,
  applyRecharge,
  creditsFor,
  formatRupees,
  groupHistory,
  isWallet,
  journeyCost,
  journeysCovered,
  lowBalanceWarning,
  rupeesFor,
  sampleWallet,
  spend,
  validateRecharge,
  walletKey,
} from '@legacy/pages/wallet-rules.js';

// The wallet preview: balance, recharge (sample payment), the price of every action, what one full journey costs,
// and the history. The balance lives in this browser only.

const inr = new Intl.NumberFormat('en-IN');
const plural = (count: number) => `${count} full ${count === 1 ? 'journey' : 'journeys'}`;

export default function Wallet() {
  usePageTitle('Wallet');
  const [wallet, setWallet] = useStoredState(walletKey(getUser()?.id), () => sampleWallet(Date.now()), isWallet);
  const [amount, setAmount] = useState(100);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [status, setStatus] = useState('');

  const invalid = validateRecharge(amount);
  const journey = journeyCost();
  const warning = lowBalanceWarning(wallet.balance);
  const journeys = Math.floor(wallet.balance / journey.credits);

  function pay(event: FormEvent) {
    event.preventDefault();
    const problem = validateRecharge(amount);
    setError(problem ?? '');
    if (problem) {
      document.getElementById('recharge-custom')?.focus();
      return;
    }
    setWallet(applyRecharge(wallet, amount, Date.now()));
    setDone(`Paid ${formatRupees(amount)} (sample). ${creditsFor(amount)} credits added.`);
  }

  function trySpend(actionId: string) {
    const next = spend(wallet, actionId, Date.now());
    if (next === wallet) {
      setStatus('Not enough credits for that.');
    }
    setWallet(next);
  }

  const now = Date.now();
  // One row per action and day: thirteen messages to Lay AI are one row, "Lay AI message × 13", not thirteen.
  const history = wallet.history.length ? groupHistory(wallet.history).slice(0, 30) : [];

  return (
    <>
      <PageHeader crumb="Account" title="Wallet" actions={<PreviewBadge />} />
      <div className="content">
        <p className="alert alert-info" role="note">
          Preview with sample data: no money moves, and the balance lives in this browser only. Prices are the planned ones (Gemini list prices, November 2026).
        </p>
        <p className="sr-only" role="status">{status}</p>
        <section className="wallet-top">
          <article className="card wallet-balance" aria-labelledby="balance-title">
            <p className="section-label" id="balance-title">Balance</p>
            <p className="wallet-credits"><b className="mono">{inr.format(wallet.balance)}</b> <span>credits</span></p>
            <p className="muted">Worth {formatRupees(rupeesFor(wallet.balance))} · about {plural(journeys)}</p>
            {warning ? <p className="alert alert-error wallet-warning" role="alert">{warning}</p> : null}
            <div className="wallet-try">
              <p className="field-hint">Try spending in the preview (sample, nothing is charged):</p>
              <div className="row">
                {ACTIONS.slice(0, 3).map((action) => (
                  <button key={action.id} className="btn btn-secondary btn-sm" type="button" disabled={wallet.balance < action.credits} onClick={() => trySpend(action.id)}>
                    {action.label} · {action.credits}
                  </button>
                ))}
              </div>
            </div>
          </article>

          <article className="card wallet-recharge" aria-labelledby="recharge-title">
            <div className="card-head"><h2 id="recharge-title">Recharge</h2><span className="badge">UPI · cards</span></div>
            <form className="wallet-form" noValidate onSubmit={pay}>
              <fieldset className="rb-question">
                <legend>Amount</legend>
                <div className="rb-choices">
                  {RECHARGE_OPTIONS.map((value) => (
                    <label className="rb-choice" key={value}>
                      <input
                        type="radio"
                        name="amount"
                        value={value}
                        checked={custom === '' && amount === value}
                        onChange={() => {
                          setAmount(value);
                          setCustom('');
                          setError('');
                        }}
                      />
                      <span className="mono">{formatRupees(value)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor="recharge-custom">Or another amount (₹60 to ₹2,000)</label>
                <input
                  className="input mono"
                  id="recharge-custom"
                  type="number"
                  inputMode="numeric"
                  min={60}
                  max={2000}
                  step={1}
                  placeholder="e.g. 150"
                  value={custom}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    setCustom(value);
                    setAmount(value === '' ? 100 : Number(value));
                    setError('');
                  }}
                />
                <p className="field-error" role="alert">{error}</p>
              </div>
              <p className="wallet-gets">
                {invalid
                  ? `Choose ${formatRupees(MIN_RECHARGE)} to ${formatRupees(MAX_RECHARGE)}.`
                  : `You get ${inr.format(creditsFor(amount))} credits: about ${plural(journeysCovered(amount))}.`}
              </p>
              <button className="btn btn-primary" type="submit">{invalid ? 'Pay' : `Pay ${formatRupees(amount)} (sample)`}</button>
              <p className="field-hint">Prices include taxes. Credits work only on Coverlay and don&apos;t expire; any left over are refunded if you delete your account.</p>
            </form>
            {done ? <p className="alert alert-success" role="status">{done}</p> : null}
          </article>
        </section>

        <section className="grid-main">
          <article className="card" aria-labelledby="prices-title">
            <div className="card-head"><h2 id="prices-title">What each action costs</h2></div>
            <p className="muted wallet-lead">You see the price before anything runs. Only actions that use AI cost credits.</p>
            <ul className="wallet-prices">
              {ACTIONS.map((action) => (
                <li key={action.id}>
                  <div>
                    <p className="wallet-price-name">{action.label}</p>
                    <p className="field-hint">{action.note}</p>
                  </div>
                  <p className="wallet-price mono">{action.credits} credits<span className="muted">{formatRupees(rupeesFor(action.credits))}</span></p>
                </li>
              ))}
            </ul>
            <p className="section-label wallet-free-label">Always free</p>
            <ul className="tick-list">
              {FREE_ACTIONS.map((label) => (
                <li key={label}><Icon name="check" /><span>{label}</span></li>
              ))}
            </ul>
          </article>

          <article className="card" aria-labelledby="journey-title">
            <div className="card-head"><h2 id="journey-title">One full journey</h2><span className="badge badge-blue">{journey.credits} credits · {formatRupees(journey.rupees)}</span></div>
            <p className="muted wallet-lead">From the first upload to a few tailored applications. The smallest recharge covers about two.</p>
            <table className="wallet-table">
              <thead><tr><th scope="col">Step</th><th scope="col">Times</th><th scope="col">Credits</th></tr></thead>
              <tbody>
                {journey.rows.map((row) => (
                  <tr key={row.action?.id}>
                    <td>{row.action?.label}</td>
                    <td className="mono">{row.count} × {row.action?.credits}</td>
                    <td className="mono">{row.credits}</td>
                  </tr>
                ))}
                <tr className="wallet-total"><td>Total</td><td /><td className="mono">{journey.credits}</td></tr>
              </tbody>
            </table>
          </article>
        </section>

        <article className="card" aria-labelledby="history-title">
          <div className="card-head">
            <h2 id="history-title">History</h2>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                setWallet(sampleWallet(Date.now()));
                setDone('');
              }}
            >
              <Icon name="refresh" />
              Reset sample
            </button>
          </div>
          <ul className="timeline">
            {history.length === 0 ? <li className="muted">Nothing yet.</li> : null}
            {history.map((entry) => (
              <li key={`${entry.label}-${entry.at}`} title={entry.count > 1 ? `${entry.count} times in a day, ${Math.abs(entry.credits) / entry.count} credits each` : undefined}>
                <span className="tl-what">{entry.count > 1 ? `${entry.label} × ${entry.count}` : entry.label}</span>
                <span className={`mono wallet-delta ${entry.credits > 0 ? 'is-plus' : ''}`}>{entry.credits > 0 ? '+' : ''}{entry.credits}</span>
                <span className="tl-when">{relativeTime(entry.at, now)}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </>
  );
}
