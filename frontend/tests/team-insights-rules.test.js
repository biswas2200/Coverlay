import { test } from 'node:test';
import assert from 'node:assert/strict';

import { K_MIN, SAMPLE, compact, delta, funnelRates, outcomeGrid, pct, shareRows, suppress } from '../src/js/pages/team-insights-rules.js';

test('no group under 20 people is ever shown', () => {
  assert.equal(K_MIN, 20);
  assert.equal(suppress({ people: 19 }), null);
  assert.deepEqual(suppress({ people: 20 }), { people: 20 });
  const grid = outcomeGrid();
  for (const [r, row] of grid.entries()) {
    for (const [b, cell] of row.cells.entries()) {
      const people = SAMPLE.outcomes.cells[r][b].people;
      assert.equal(cell.rate === null, people < K_MIN, `${row.role} / ${cell.band}`);
    }
  }
});

test('funnel rates, shares, compact figures and deltas', () => {
  const funnel = funnelRates([{ label: 'a', count: 200 }, { label: 'b', count: 150 }, { label: 'c', count: 30 }]);
  assert.deepEqual(funnel.map((s) => [s.ofFirst, s.ofPrevious]), [[100, null], [75, 75], [15, 20]]);
  assert.deepEqual(shareRows([{ label: 'x', value: 1 }, { label: 'y', value: 3 }]).map((r) => [r.label, r.share]), [['y', 75], ['x', 25]]);
  assert.equal(pct(1, 0), null);
  assert.equal(compact(1240), '1,240');
  assert.equal(compact(12900), '12.9K');
  assert.equal(compact(4200000), '4.2M');
  assert.deepEqual(delta(120, 100), { text: '+20% vs last month', direction: 'up', good: true });
  assert.deepEqual(delta(120, 100, { upIsGood: false }), { text: '+20% vs last month', direction: 'up', good: false });
  assert.equal(delta(5, 0), null);
});

test('the sample split of ₹100 adds up to ₹100', () => {
  const total = SAMPLE.split.reduce((sum, part) => sum + part.value, 0);
  assert.equal(Math.round(total * 100) / 100, 100);
});
