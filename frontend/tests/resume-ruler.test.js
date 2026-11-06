import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rulerTicks } from '../src/js/pages/resume-ruler.js';

test('a centimetre ruler has a tick per millimetre, longer at 5 mm, numbered at each centimetre', () => {
  const ticks = rulerTicks(210, 'cm');
  assert.equal(ticks.length, 211);
  assert.deepEqual(ticks.slice(0, 11).map((t) => t.kind), ['major', 'minor', 'minor', 'minor', 'minor', 'mid', 'minor', 'minor', 'minor', 'minor', 'major']);
  const labels = ticks.filter((t) => t.label).map((t) => t.label);
  assert.equal(labels.length, 21);
  assert.deepEqual([labels[0], labels.at(-1)], ['1', '21']);
  assert.equal(ticks[0].label, null);
});

test('an inch ruler has a tick every eighth, longer at the half inch, numbered at each inch', () => {
  const ticks = rulerTicks(215.9, 'in'); // Letter is 8.5 in wide
  const majors = ticks.filter((t) => t.kind === 'major');
  assert.equal(majors.length, 9); // 0 to 8 inches
  assert.deepEqual(ticks.filter((t) => t.label).map((t) => t.label), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.equal(ticks[4].kind, 'mid');
  assert.ok(Math.abs(ticks[8].at - 25.4) < 1e-9);
  assert.equal(ticks.at(-1).kind, 'mid'); // the last tick is the 8.5 in mark
});

test('ticks never run past the end of the ruler', () => {
  for (const unit of ['cm', 'in']) {
    assert.ok(rulerTicks(297, unit).every((t) => t.at <= 297 + 1e-6));
  }
});
