import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fileFor, server } from '../preview/server.mjs';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

test('the preview server serves only files under src/', () => {
  assert.ok(fileFor('/wallet.html').endsWith('wallet.html'));
  assert.ok(fileFor('/../package.json').startsWith(SRC), 'a parent path stays inside src/');
  assert.ok(fileFor('/%2e%2e/%2e%2e/etc/passwd').startsWith(SRC));
});

test('the preview answers the API with sample data and points the pages at it', async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const me = await (await fetch(`${base}/api/auth/me`)).json();
    assert.equal(me.email, 'preview@coverlay.app');
    const jobs = await (await fetch(`${base}/api/jobs/recommended?limit=50`)).json();
    assert.equal(jobs.jobs.length, jobs.openJobs);
    assert.equal((await fetch(`${base}/api/recommendations/dashboard`)).status, 204);
    assert.equal((await fetch(`${base}/api/resumes`, { method: 'POST' })).status, 503);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    assert.match(await (await fetch(`${base}/js/config.js`)).text(), /API_BASE_URL = '\/api'/);
    assert.match(await (await fetch(`${base}/`)).text(), /Coverlay, every screen/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('every sidebar link and every hub link points at a page that exists', () => {
  const shell = readFileSync(new URL('../src/js/components/shell.js', import.meta.url), 'utf8');
  const hub = readFileSync(new URL('../preview/hub.html', import.meta.url), 'utf8');
  const pages = new Set([...shell.matchAll(/href: '([a-z-]+\.html)/g), ...hub.matchAll(/href="([a-z-]+\.html)"/g)].map((m) => m[1]));
  assert.ok(pages.size >= 15, `${pages.size} pages`);
  for (const page of pages) {
    assert.ok(existsSync(new URL(`../src/${page}`, import.meta.url)), `${page} is missing`);
  }
});
