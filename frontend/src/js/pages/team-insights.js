import { byId, el, setText } from '../core/dom.js';
import { requireAuth } from '../core/session.js';
import { hydrateIcons, icon } from '../components/icons.js';
import { renderShell } from '../components/shell.js';
import { formatRupees } from './wallet-rules.js';
import { SAMPLE, compact, delta, funnelRates, outcomeGrid, pct, shareRows } from './team-insights-rules.js';

// Team insights preview (admins): KPI tiles, then product, outcomes, money and health. Bars are
// one hue (magnitude); the templates split and the money split use the first categorical slots
// in a fixed order, with a legend. Every chart has a table view, and every bar answers hover and
// keyboard focus with the same tooltip. All numbers are samples.

if (requireAuth()) {
  hydrateIcons();
  renderShell('admin-insights');
  render();
  wireTooltip();
}

function render() {
  setText(byId('insights-scope'), `${SAMPLE.month} · sample numbers · groups under 20 people are hidden`);
  renderKpis();
  const funnel = funnelRates(SAMPLE.funnel);
  bars(byId('funnel'), funnel.map((s) => ({ label: s.label, value: s.count, tip: `${compact(s.count)} people`, note: s.ofPrevious === null ? null : `${s.ofPrevious}% of the step before` })));
  table(byId('funnel-table'), ['Step', 'People', 'Of the step before'], funnel.map((s) => [s.label, compact(s.count), s.ofPrevious === null ? '–' : `${s.ofPrevious}%`]));
  setText(byId('prompt-example'), SAMPLE.promptExample);
  const prompts = shareRows(SAMPLE.prompts);
  bars(byId('prompts'), prompts.map((p) => ({ label: p.label, value: p.value, tip: `${compact(p.value)} messages`, note: `${p.share}%` })));
  table(byId('prompts-table'), ['Intent', 'Messages', 'Share'], prompts.map((p) => [p.label, compact(p.value), `${p.share}%`]));
  renderTemplates();
  renderOutcomes();
  renderMoney();
  renderHealth();
}

function renderKpis() {
  const { kpis } = SAMPLE;
  const tiles = [
    { label: 'Active users', value: compact(kpis.activeUsers.value), d: delta(kpis.activeUsers.value, kpis.activeUsers.previous) },
    { label: 'Revenue', value: formatRupees(kpis.revenue.value), d: delta(kpis.revenue.value, kpis.revenue.previous) },
    { label: 'AI cost', value: formatRupees(kpis.aiCost.value), d: delta(kpis.aiCost.value, kpis.aiCost.previous, { upIsGood: false }) },
    { label: 'AI cost per full journey', value: formatRupees(kpis.costPerJourney.value), d: delta(kpis.costPerJourney.value, kpis.costPerJourney.previous, { upIsGood: false }) },
  ];
  byId('kpis').replaceChildren(
    ...tiles.map((tile) =>
      el('article', { class: 'card insights-tile' },
        el('p', { class: 'insights-tile-label' }, tile.label),
        el('p', { class: 'insights-tile-value' }, tile.value),
        tile.d ? el('p', { class: `insights-delta is-${tile.d.good === null ? 'flat' : tile.d.good ? 'good' : 'bad'}` },
          icon(tile.d.direction === 'down' ? 'arrow-down' : 'arrow-up'), tile.d.text) : null)),
  );
}

/** Horizontal bars, one hue, value at the tip; each bar is a focusable hover target. */
function bars(list, rows) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  list.replaceChildren(
    ...rows.map((row) =>
      el('li', { class: 'viz-row', tabindex: '0', 'data-tip': `${row.label}: ${row.tip}`, 'aria-label': `${row.label}: ${row.tip}${row.note ? `, ${row.note}` : ''}` },
        el('span', { class: 'viz-label' }, row.label),
        el('span', { class: 'viz-track' },
          el('span', { class: 'viz-bar', style: `width:${Math.max((row.value / max) * 100, 1.5).toFixed(1)}%` }),
          el('span', { class: 'viz-value' }, row.short ?? compact(row.value))),
        row.note ? el('span', { class: 'viz-note' }, row.note) : null)),
  );
}

function table(node, head, rows) {
  node.replaceChildren(
    el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, ...rows.map((cells) => el('tr', {}, ...cells.map((c, i) => (i === 0 ? el('th', { scope: 'row' }, c) : el('td', { class: 'mono' }, c)))))),
  );
}

function legend(node, names) {
  node.replaceChildren(...names.map((name, i) => el('li', {}, el('span', { class: `viz-swatch viz-c${i + 1}`, 'aria-hidden': 'true' }), name)));
}

function renderTemplates() {
  const { names, byRole } = SAMPLE.templates;
  legend(byId('templates-legend'), names);
  byId('templates').replaceChildren(
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Role'), el('th', { scope: 'col' }, 'Split'), ...names.map((n) => el('th', { scope: 'col' }, n)))),
    el('tbody', {}, ...byRole.map((row) => {
      const total = row.counts.reduce((a, b) => a + b, 0);
      const label = row.counts.map((c, i) => `${names[i]} ${pct(c, total)}%`).join(', ');
      return el('tr', {},
        el('th', { scope: 'row' }, row.role),
        el('td', {}, el('span', { class: 'viz-thin', role: 'img', 'aria-label': `${row.role}: ${label}`, tabindex: '0', 'data-tip': `${row.role}: ${label}` },
          ...row.counts.map((c, i) => el('span', { class: `viz-c${i + 1}`, style: `flex-grow:${c}` })))),
        ...row.counts.map((c) => el('td', { class: 'mono' }, `${pct(c, total)}%`)));
    })),
  );
}

function renderOutcomes() {
  const { bands } = SAMPLE.outcomes;
  const grid = outcomeGrid();
  byId('outcomes').replaceChildren(
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Role'), ...bands.map((b) => el('th', { scope: 'col' }, b)))),
    el('tbody', {}, ...grid.map((row) =>
      el('tr', {},
        el('th', { scope: 'row' }, row.role),
        ...row.cells.map((cell) =>
          el('td', { class: 'insights-cell' },
            cell.rate === null
              ? el('span', { class: 'insights-hidden', title: `Only ${cell.people} people: hidden` }, '–', el('span', { class: 'field-hint' }, ` under 20 people`))
              : el('span', {},
                el('span', { class: 'mono insights-rate' }, `${cell.rate}%`),
                el('span', { class: 'viz-meter viz-meter-sm', 'aria-hidden': 'true' }, el('span', { style: `width:${cell.rate}%` })))))))),
  );
}

function renderMoney() {
  const split = SAMPLE.split;
  const total = split.reduce((a, s) => a + s.value, 0);
  const tall = byId('split');
  tall.setAttribute('aria-label', split.map((s) => `${s.label} ₹${s.value}`).join(', '));
  tall.replaceChildren(
    ...split.map((s, i) => {
      const share = (s.value / total) * 100;
      return el('span', { class: `viz-c${i + 1}`, style: `flex-grow:${s.value}`, tabindex: '0', 'data-tip': `${s.label}: ₹${s.value} of ₹100` },
        share >= 9 ? el('span', { class: 'viz-tall-label' }, `₹${Math.round(s.value)}`) : null);
    }),
  );
  legend(byId('split-legend'), split.map((s) => s.label));
  table(byId('split-table'), ['Part', 'Of ₹100'], split.map((s) => [s.label, `₹${s.value}`]));

  const features = shareRows(SAMPLE.aiByFeature);
  bars(byId('features'), features.map((f) => ({ label: f.label, value: f.value, short: formatRupees(f.value), tip: `${formatRupees(f.value)} (${f.share}%)`, note: `${f.share}%` })));
  table(byId('features-table'), ['Feature', 'AI cost', 'Share'], features.map((f) => [f.label, formatRupees(f.value), `${f.share}%`]));

  bars(byId('types'), SAMPLE.spendByType.map((t) => ({ label: t.label, value: t.value, short: formatRupees(t.value), tip: `${formatRupees(t.value)} a month` })));
  table(byId('types-table'), ['Experience', 'Average spend'], SAMPLE.spendByType.map((t) => [t.label, formatRupees(t.value)]));

  setText(byId('top-share'), `${SAMPLE.topSpendersShare}%`);
  const meter = byId('top-meter');
  meter.setAttribute('aria-label', `${SAMPLE.topSpendersShare}% of AI cost from the top 5% of spenders`);
  meter.firstElementChild.style.width = `${SAMPLE.topSpendersShare}%`;
}

function renderHealth() {
  const STATE = { good: { icon: 'check', text: 'OK' }, warning: { icon: 'alert', text: 'Watch' }, critical: { icon: 'x', text: 'Act now' } };
  byId('health').replaceChildren(
    ...SAMPLE.health.map((item) =>
      el('article', { class: `card insights-health-tile is-${item.state}` },
        el('p', { class: 'insights-tile-label' }, item.label),
        el('p', { class: 'insights-tile-value' }, item.value),
        el('p', { class: 'insights-status' }, el('span', { class: 'insights-status-dot', 'aria-hidden': 'true' }), icon(STATE[item.state].icon), STATE[item.state].text),
        el('p', { class: 'field-hint' }, item.note))),
  );
}

/** One tooltip for every hover target: the same text on pointer hover and keyboard focus. */
function wireTooltip() {
  const tip = byId('viz-tooltip');
  const showFor = (target, x, y) => {
    setText(tip, target.dataset.tip);
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    const left = Math.min(Math.max(x - box.width / 2, 8), window.innerWidth - box.width - 8);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(y - box.height - 10, 8))}px)`;
  };
  const hide = () => {
    tip.hidden = true;
  };
  document.addEventListener('pointermove', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (target) {
      showFor(target, event.clientX, event.clientY);
    } else {
      hide();
    }
  });
  document.addEventListener('focusin', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (target) {
      const rect = target.getBoundingClientRect();
      showFor(target, rect.left + rect.width / 2, rect.top);
    } else {
      hide();
    }
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide();
    }
  });
}
