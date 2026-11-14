import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { usePageTitle } from '@/lib/hooks';
import { formatRupees } from '@legacy/pages/wallet-rules.js';
import { SAMPLE, compact, delta, funnelRates, outcomeGrid, pct, shareRows } from '@legacy/pages/team-insights-rules.js';

// Team insights preview (admins): KPI tiles, then product, outcomes, money and health. Bars are one hue (magnitude); the
// templates split and the money split use the first categorical slots in a fixed order, with a legend. Every chart has
// a table view, and every bar answers hover and keyboard focus with the same tooltip. All numbers are samples. It is a
// mock-up that is not part of the product (RB-PRE-01), so only a preview build has it.

interface BarRow {
  label: string;
  value: number;
  tip: string;
  note?: string | null;
  short?: string;
}

function Bars({ rows }: { rows: BarRow[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="viz-bars">
      {rows.map((row) => (
        <li key={row.label} className="viz-row" tabIndex={0} data-tip={`${row.label}: ${row.tip}`} aria-label={`${row.label}: ${row.tip}${row.note ? `, ${row.note}` : ''}`}>
          <span className="viz-label">{row.label}</span>
          <span className="viz-track">
            <span className="viz-bar" style={{ width: `${Math.max((row.value / max) * 100, 1.5).toFixed(1)}%` }} />
            <span className="viz-value">{row.short ?? compact(row.value)}</span>
          </span>
          {row.note ? <span className="viz-note">{row.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function TableView({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <details className="viz-table">
      <summary>Table</summary>
      <table>
        <thead><tr>{head.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((cells) => (
            <tr key={cells[0]}>
              {cells.map((cell, index) => (index === 0 ? <th scope="row" key={index}>{cell}</th> : <td className="mono" key={index}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Legend({ names }: { names: string[] }) {
  return (
    <ul className="viz-legend">
      {names.map((name, index) => (
        <li key={name}><span className={`viz-swatch viz-c${index + 1}`} aria-hidden="true" />{name}</li>
      ))}
    </ul>
  );
}

const HEALTH: Record<string, { icon: IconName; text: string }> = { good: { icon: 'check', text: 'OK' }, warning: { icon: 'alert', text: 'Watch' }, critical: { icon: 'x', text: 'Act now' } };

/** One tooltip for every hover target: the same text on pointer hover and keyboard focus. */
function useTooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const at = (target: Element, x: number, y: number) => setTip({ text: (target as HTMLElement).dataset.tip ?? '', x, y });
    const onMove = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest?.('[data-tip]');
      if (target) {
        at(target, event.clientX, event.clientY);
      } else {
        setTip(null);
      }
    };
    const onFocus = (event: FocusEvent) => {
      const target = (event.target as Element | null)?.closest?.('[data-tip]');
      if (target) {
        const rect = target.getBoundingClientRect();
        at(target, rect.left + rect.width / 2, rect.top);
      } else {
        setTip(null);
      }
    };
    const hide = () => setTip(null);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && hide();
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return tip;
}

export default function TeamInsights() {
  usePageTitle('Admin analytics');
  const tip = useTooltip();
  const { kpis } = SAMPLE;
  const tiles = [
    { label: 'Active users', value: compact(kpis.activeUsers.value), d: delta(kpis.activeUsers.value, kpis.activeUsers.previous) },
    { label: 'Revenue', value: formatRupees(kpis.revenue.value), d: delta(kpis.revenue.value, kpis.revenue.previous) },
    { label: 'AI cost', value: formatRupees(kpis.aiCost.value), d: delta(kpis.aiCost.value, kpis.aiCost.previous, { upIsGood: false }) },
    { label: 'AI cost per full journey', value: formatRupees(kpis.costPerJourney.value), d: delta(kpis.costPerJourney.value, kpis.costPerJourney.previous, { upIsGood: false }) },
  ];
  const funnel = funnelRates(SAMPLE.funnel);
  const prompts = shareRows(SAMPLE.prompts);
  const { names, byRole } = SAMPLE.templates;
  const { bands } = SAMPLE.outcomes;
  const grid = outcomeGrid();
  const split = SAMPLE.split;
  const splitTotal = split.reduce((sum: number, part: { value: number }) => sum + part.value, 0);
  const features = shareRows(SAMPLE.aiByFeature);

  // The tooltip sits above the pointer, kept inside the window.
  const tipStyle = tip
    ? { transform: `translate(${Math.round(Math.min(Math.max(tip.x - 80, 8), window.innerWidth - 168))}px, ${Math.round(Math.max(tip.y - 44, 8))}px)` }
    : undefined;

  return (
    <>
      <PageHeader crumb="Admin console" title="Admin analytics" actions={<span className="badge badge-violet">Mock-up</span>} />
      <div className="content">
        <p className="alert alert-info" role="note">
          <strong>A mock-up, not part of the product.</strong> It shows what an internal dashboard could look like, with sample numbers. It will not be built as it is: you decide what your internal dashboard shows from how Coverlay is really used.
        </p>
        <p className="muted insights-scope">{SAMPLE.month} · sample numbers · groups under 20 people are hidden</p>
        <section className="insights-kpis" aria-label="This month">
          {tiles.map((tile) => (
            <article className="card insights-tile" key={tile.label}>
              <p className="insights-tile-label">{tile.label}</p>
              <p className="insights-tile-value">{tile.value}</p>
              {tile.d ? (
                <p className={`insights-delta is-${tile.d.good === null ? 'flat' : tile.d.good ? 'good' : 'bad'}`}>
                  <Icon name={tile.d.direction === 'down' ? 'arrow-down' : 'arrow-up'} />
                  {tile.d.text}
                </p>
              ) : null}
            </article>
          ))}
        </section>

        <h2 className="insights-section">Product</h2>
        <section className="grid-main">
          <article className="card viz-card" aria-labelledby="funnel-title">
            <div className="card-head"><h3 className="viz-title" id="funnel-title">From sign-up to interview</h3></div>
            <p className="viz-sub">People who reached each step this month</p>
            <Bars rows={funnel.map((s: { label: string; count: number; ofPrevious: number | null }) => ({ label: s.label, value: s.count, tip: `${compact(s.count)} people`, note: s.ofPrevious === null ? null : `${s.ofPrevious}% of the step before` }))} />
            <TableView head={['Step', 'People', 'Of the step before']} rows={funnel.map((s: { label: string; count: number; ofPrevious: number | null }) => [s.label, compact(s.count), s.ofPrevious === null ? '–' : `${s.ofPrevious}%`])} />
          </article>
          <article className="card viz-card" aria-labelledby="prompts-title">
            <div className="card-head"><h3 className="viz-title" id="prompts-title">What people ask Lay AI</h3></div>
            <p className="viz-sub">Messages by intent. Stored with placeholders, for example:</p>
            <p className="insights-example mono">{SAMPLE.promptExample}</p>
            <Bars rows={prompts.map((p: { label: string; value: number; share: number }) => ({ label: p.label, value: p.value, tip: `${compact(p.value)} messages`, note: `${p.share}%` }))} />
            <TableView head={['Intent', 'Messages', 'Share']} rows={prompts.map((p: { label: string; value: number; share: number }) => [p.label, compact(p.value), `${p.share}%`])} />
          </article>
        </section>
        <article className="card viz-card" aria-labelledby="templates-title">
          <div className="card-head"><h3 className="viz-title" id="templates-title">Templates people choose, by target role</h3><Legend names={names} /></div>
          <div className="table-scroll">
            <table className="insights-table">
              <thead><tr><th scope="col">Role</th><th scope="col">Split</th>{names.map((n: string) => <th scope="col" key={n}>{n}</th>)}</tr></thead>
              <tbody>
                {byRole.map((row: { role: string; counts: number[] }) => {
                  const total = row.counts.reduce((a, b) => a + b, 0);
                  const label = row.counts.map((c, i) => `${names[i]} ${pct(c, total)}%`).join(', ');
                  return (
                    <tr key={row.role}>
                      <th scope="row">{row.role}</th>
                      <td>
                        <span className="viz-thin" role="img" aria-label={`${row.role}: ${label}`} tabIndex={0} data-tip={`${row.role}: ${label}`}>
                          {row.counts.map((c, i) => <span key={i} className={`viz-c${i + 1}`} style={{ flexGrow: c }} />)}
                        </span>
                      </td>
                      {row.counts.map((c, i) => <td className="mono" key={i}>{pct(c, total)}%</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>

        <h2 className="insights-section">Outcomes</h2>
        <article className="card viz-card" aria-labelledby="outcomes-title">
          <div className="card-head"><h3 className="viz-title" id="outcomes-title">Interview rate by experience and role</h3></div>
          <p className="viz-sub">Interviews per application, from people who answered &quot;Did you hear back?&quot;. A cell needs at least 20 people, so no result points at one person.</p>
          <div className="table-scroll">
            <table className="insights-table insights-grid">
              <thead><tr><th scope="col">Role</th>{bands.map((b: string) => <th scope="col" key={b}>{b}</th>)}</tr></thead>
              <tbody>
                {grid.map((row: { role: string; cells: { rate: number | null; people: number }[] }) => (
                  <tr key={row.role}>
                    <th scope="row">{row.role}</th>
                    {row.cells.map((cell, index) => (
                      <td className="insights-cell" key={index}>
                        {cell.rate === null ? (
                          <span className="insights-hidden" title={`Only ${cell.people} people: hidden`}>–<span className="field-hint"> under 20 people</span></span>
                        ) : (
                          <span>
                            <span className="mono insights-rate">{cell.rate}%</span>
                            <span className="viz-meter viz-meter-sm" aria-hidden="true"><span style={{ width: `${cell.rate}%` }} /></span>
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <h2 className="insights-section">Money</h2>
        <section className="grid-main">
          <article className="card viz-card" aria-labelledby="split-title">
            <div className="card-head"><h3 className="viz-title" id="split-title">Where ₹100 of spent credits goes</h3></div>
            <div className="viz-tall" role="img" aria-label={split.map((s: { label: string; value: number }) => `${s.label} ₹${s.value}`).join(', ')}>
              {split.map((s: { label: string; value: number }, i: number) => (
                <span key={s.label} className={`viz-c${i + 1}`} style={{ flexGrow: s.value }} tabIndex={0} data-tip={`${s.label}: ₹${s.value} of ₹100`}>
                  {(s.value / splitTotal) * 100 >= 9 ? <span className="viz-tall-label">₹{Math.round(s.value)}</span> : null}
                </span>
              ))}
            </div>
            <Legend names={split.map((s: { label: string }) => s.label)} />
            <TableView head={['Part', 'Of ₹100']} rows={split.map((s: { label: string; value: number }) => [s.label, `₹${s.value}`])} />
          </article>
          <article className="card viz-card" aria-labelledby="feature-title">
            <div className="card-head"><h3 className="viz-title" id="feature-title">AI cost by feature</h3></div>
            <p className="viz-sub">This month, in rupees</p>
            <Bars rows={features.map((f: { label: string; value: number; share: number }) => ({ label: f.label, value: f.value, short: formatRupees(f.value), tip: `${formatRupees(f.value)} (${f.share}%)`, note: `${f.share}%` }))} />
            <TableView head={['Feature', 'AI cost', 'Share']} rows={features.map((f: { label: string; value: number; share: number }) => [f.label, formatRupees(f.value), `${f.share}%`])} />
          </article>
        </section>
        <section className="grid-main">
          <article className="card viz-card" aria-labelledby="types-title">
            <div className="card-head"><h3 className="viz-title" id="types-title">Average spend per person, by experience</h3></div>
            <p className="viz-sub">Rupees this month</p>
            <Bars rows={SAMPLE.spendByType.map((t: { label: string; value: number }) => ({ label: t.label, value: t.value, short: formatRupees(t.value), tip: `${formatRupees(t.value)} a month` }))} />
            <TableView head={['Experience', 'Average spend']} rows={SAMPLE.spendByType.map((t: { label: string; value: number }) => [t.label, formatRupees(t.value)])} />
          </article>
          <article className="card viz-card" aria-labelledby="top-title">
            <div className="card-head"><h3 className="viz-title" id="top-title">Who spends most</h3></div>
            <p className="insights-hero">{SAMPLE.topSpendersShare}%</p>
            <p className="viz-sub">of AI cost comes from the top 5% of spenders: serious, daily appliers. No names: spend is counted under the analytics id.</p>
            <div className="viz-meter" role="img" aria-label={`${SAMPLE.topSpendersShare}% of AI cost from the top 5% of spenders`}><span style={{ width: `${SAMPLE.topSpendersShare}%` }} /></div>
          </article>
        </section>

        <h2 className="insights-section">Health</h2>
        <section className="insights-health" aria-label="Health">
          {SAMPLE.health.map((item: { label: string; value: string; state: string; note: string }) => (
            <article className={`card insights-health-tile is-${item.state}`} key={item.label}>
              <p className="insights-tile-label">{item.label}</p>
              <p className="insights-tile-value">{item.value}</p>
              <p className="insights-status"><span className="insights-status-dot" aria-hidden="true" /><Icon name={HEALTH[item.state].icon} />{HEALTH[item.state].text}</p>
              <p className="field-hint">{item.note}</p>
            </article>
          ))}
        </section>
        <div className="viz-tooltip" role="tooltip" hidden={!tip} style={tipStyle}>{tip?.text}</div>
      </div>
    </>
  );
}
