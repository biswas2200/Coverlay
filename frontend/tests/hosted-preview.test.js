import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { answer } from '../preview/mock-answers.js';
import { HOSTED_API_BASE, HOSTED_CONFIG, darkBlocks, hubAsMainPage, withExplicitDark } from '../preview/build-hosted.mjs';
import { server } from '../preview/server.mjs';

const CALLS = [
  ['GET', '/auth/me'],
  ['POST', '/auth/login'],
  ['GET', '/resumes'],
  ['POST', '/resumes'],
  ['GET', '/recommendations/dashboard'],
  ['GET', '/jobs/recommended?limit=50'],
  ['GET', '/jobs/in-demand'],
  ['PUT', '/jobs/job-1/saved'],
  ['GET', '/watchlist/limits'],
  ['POST', '/bug-reports'],
  ['GET', '/nope'],
];

// Dates in the answers are made from the clock, so compare without them.
const withoutTimes = (value) => JSON.parse(JSON.stringify(value ?? null, (key, v) => (/At$/.test(key) ? '<time>' : v)));

test('the hosted copy answers every API call the way the Node preview server does', async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [method, path] of CALLS) {
      const response = await fetch(`${base}/api${path}`, { method });
      const text = await response.text();
      const hosted = answer(method, `/api${path}`);
      assert.equal(hosted.status, response.status, `${method} ${path}`);
      assert.deepEqual(withoutTimes(hosted.body), withoutTimes(text ? JSON.parse(text) : undefined), `${method} ${path}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the hosted config sends API calls to a host that can never resolve', () => {
  assert.match(HOSTED_API_BASE, /^https:\/\/[a-z-]+\.invalid\/api$/);
  assert.match(HOSTED_CONFIG, /export const API_BASE_URL = 'https:\/\/coverlay-preview\.invalid\/api';/);
  assert.match(HOSTED_CONFIG, /import \{ answer \} from '\.\/preview-mock-answers\.js';/);
});

test('the hub becomes a main page with no document skeleton, title first', () => {
  const page = hubAsMainPage(readFileSync(new URL('../preview/hub.html', import.meta.url), 'utf8'));
  assert.ok(page.startsWith('<title>'));
  assert.doesNotMatch(page, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]|<\/body>/i);
  assert.match(page, /claude:viewport-fit-sides/);
  assert.match(page, /padding-left: max\(16px, env\(safe-area-inset-left, 0px\)\)/);
  assert.match(page, /Download PDF works only in the local preview/);
  assert.match(page, /<script type="module">/);
});

test('every dark block is guarded and gets a data-theme="dark" copy', () => {
  // The stylesheet itself has no dark theme now (one black, white and grey look), so this checks whatever
  // dark blocks it has, and proves the build's own functions on a stylesheet that does have some.
  const css = readFileSync(new URL('../src/css/app.css', import.meta.url), 'utf8');
  const blocks = darkBlocks(css);
  for (const block of blocks) {
    assert.match(block.inner, /:root:not\(\[data-theme="light"\]\)/);
  }
  assert.equal(withExplicitDark(css).split(':root[data-theme="dark"]').length - 1, blocks.length);

  const sample = '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    --bg: #0f1115;\n  }\n}\n'
    + '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) .x { color: #ffffff; }\n}\n';
  assert.equal(darkBlocks(sample).length, 2);
  const out = withExplicitDark(sample);
  assert.equal(out.split(':root[data-theme="dark"]').length - 1, 2);
  assert.match(out, /:root\[data-theme="dark"\] \{\s+--bg: #0f1115;/);
  assert.throws(() => withExplicitDark('@media (prefers-color-scheme: dark) { :root { --bg: #000; } }'), /guard/);
});
