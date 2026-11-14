// Builds the hosted copy of the clickable preview: preview/dist/, a folder of static files that
// works with no server behind it, published as a private claude.ai artifact. It:
//   - copies src/
//   - replaces js/config.js with one that answers API calls in the page, from mock-answers.js,
//     so no request leaves the page
//   - renames the landing page to home.html (index.html is the artifact's main page) and points
//     its links there
//   - makes the hub the main page: no doctype/html/head/body, which the artifact adds itself
//   - adds an "All screens" link back to the hub on every other page, and the data-theme="dark"
//     copy of the dark colours (the viewer sets data-theme when someone picks a theme)
//
//   cd frontend && node preview/build-hosted.mjs        # writes preview/dist/

import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const DIST = fileURLToPath(new URL('./dist/', import.meta.url));
const HUB = fileURLToPath(new URL('./hub.html', import.meta.url));
const MOCK = fileURLToPath(new URL('./mock-answers.js', import.meta.url));

/** Where the hosted pages send API calls: a reserved .invalid host, answered by the fetch shim. */
export const HOSTED_API_BASE = 'https://coverlay-preview.invalid/api';

export const HOSTED_CONFIG = `// Hosted preview (built by preview/build-hosted.mjs): there is no backend, so API calls are
// answered here, in the page, from preview-mock-answers.js. Nothing leaves the page.
import { answer } from './preview-mock-answers.js';

export const API_BASE_URL = '${HOSTED_API_BASE}';

const API_ORIGIN = new URL(API_BASE_URL).origin;
const networkFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), location.href);
  if (url.origin !== API_ORIGIN) {
    return networkFetch(input, init);
  }
  const { status, body } = answer(init.method ?? request?.method ?? 'GET', url.pathname);
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
};
`;

const HUB_LINK = '<a class="hosted-hub" href="index.html">All screens</a>';

const HOSTED_CSS = `
/* ---------- hosted preview only (added by preview/build-hosted.mjs) ---------- */
.hosted-hub {
  position: fixed; z-index: 70; left: max(12px, env(safe-area-inset-left, 0px)); bottom: max(12px, env(safe-area-inset-bottom, 0px));
  padding: 6px 12px; border-radius: 999px; background: var(--text); color: var(--surface);
  font-size: 12.5px; font-weight: 600; box-shadow: var(--shadow); opacity: 0.92;
}
.hosted-hub:hover { color: var(--surface); opacity: 1; }
.hosted-hub:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (min-width: 901px) { body.app .hosted-hub { left: calc(var(--sidebar-w) + 16px); } }
`;

const HOSTED_NOTE = `<p class="alert alert-info" role="note">This copy runs on claude.ai with no server: the sample API answers come from the page itself. Download PDF works only in the local preview (<code>npm run preview</code>), because pages here can't open the print dialog.</p>`;

/** Every `@media (prefers-color-scheme: dark) { … }` block, with its start and end offsets. */
export function darkBlocks(css) {
  const blocks = [];
  const opener = '@media (prefers-color-scheme: dark) {';
  let from = 0;
  for (;;) {
    const start = css.indexOf(opener, from);
    if (start === -1) {
      return blocks;
    }
    let depth = 0;
    let end = start + opener.length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') {
        depth += 1;
      } else if (css[end] === '}') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    blocks.push({ start, end: end + 1, inner: css.slice(start + opener.length, end) });
    from = end + 1;
  }
}

/**
 * The stylesheet with a `:root[data-theme="dark"]` copy after each dark block, so a viewer's
 * explicit dark choice wins over a light system theme (the guarded block covers the other way).
 */
export function withExplicitDark(css) {
  let out = '';
  let last = 0;
  for (const block of darkBlocks(css)) {
    const copy = block.inner.replaceAll(':root:not([data-theme="light"])', ':root[data-theme="dark"]').trim();
    if (!copy.includes(':root[data-theme="dark"]')) {
      throw new Error('A dark block is missing its :root:not([data-theme="light"]) guard');
    }
    out += `${css.slice(last, block.end)}\n${copy}`;
    last = block.end;
  }
  return out + css.slice(last);
}

/** The hub as the artifact's main page: title and styles first, no document skeleton. */
export function hubAsMainPage(html) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? '';
  const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Coverlay preview</title>';
  const kept = [...head.matchAll(/<link [^>]*>|<style>[\s\S]*?<\/style>/g)].map((m) => m[0]);
  const content = body.replace(/(<p class="alert alert-success" id="started"[^>]*>[\s\S]*?<\/p>)/, `$1\n        ${HOSTED_NOTE}`);
  return [title, '<meta name="claude:viewport-fit-sides" content="cover" />', ...kept, content.trim(), ''].join('\n');
}

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));
}

export async function build() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(SRC, DIST, { recursive: true });

  await writeFile(join(DIST, 'js/config.js'), HOSTED_CONFIG);
  await writeFile(join(DIST, 'js/preview-mock-answers.js'), await readFile(MOCK, 'utf8'));
  await rename(join(DIST, 'index.html'), join(DIST, 'home.html'));

  for (const file of await filesUnder(DIST)) {
    if (file.endsWith('.html')) {
      const html = (await readFile(file, 'utf8')).replace(/\bindex\.html\b/g, 'home.html');
      await writeFile(file, html.replace('</body>', `    ${HUB_LINK}\n  </body>`));
    } else if (file.endsWith('.js')) {
      await writeFile(file, (await readFile(file, 'utf8')).replace(/\bindex\.html\b/g, 'home.html'));
    }
  }

  const css = join(DIST, 'css/app.css');
  await writeFile(css, withExplicitDark(await readFile(css, 'utf8')) + HOSTED_CSS);

  const hub = (await readFile(HUB, 'utf8')).replace(/\bindex\.html\b/g, 'home.html');
  await writeFile(join(DIST, 'index.html'), hubAsMainPage(hub));

  return (await filesUnder(DIST)).map((file) => relative(DIST, file)).sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = await build();
  console.log(`Wrote ${files.length} files to preview/dist/`);
}
