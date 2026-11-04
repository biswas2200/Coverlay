// The clickable preview of the whole app, with no backend: serves frontend/src, answers the
// API with sample data (mock-api.mjs), and puts a hub page at / that starts a preview session
// and links every screen. A design-review tool: nothing is saved anywhere but this browser.
//
//   cd frontend && npm run preview        # then open http://localhost:4300
//   PORT=4400 npm run preview             # another port

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './mock-api.mjs';

const ROOT = resolve(fileURLToPath(new URL('../src/', import.meta.url)));
const HUB = fileURLToPath(new URL('./hub.html', import.meta.url));
const PORT = Number(process.env.PORT ?? 4300);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** The file under src/ a URL path names, or null when it would leave src/. */
export function fileFor(pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const file = join(ROOT, relative);
  return file === ROOT || file.startsWith(ROOT + sep) ? file : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://preview.local');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url);
    return;
  }
  if (url.pathname === '/js/config.js') {
    // What nginx does in production: the pages call the API on the same origin.
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
    res.end("export const API_BASE_URL = '/api';\n");
    return;
  }
  const file = url.pathname === '/' || url.pathname === '/preview.html' ? HUB : fileFor(url.pathname);
  if (!file) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': TYPES['.txt'] });
    res.end('Not found');
  }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Coverlay preview: http://localhost:${PORT}`));
}

export { server };
