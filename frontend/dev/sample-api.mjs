// A Vite plugin: answers /api/* with the sample data of preview/mock-api.mjs and serves /config.js, the way
// nginx does in production. Only `npm run dev` uses it; a production build never contains it.

import { handleApi } from '../preview/mock-api.mjs';

export function sampleApi() {
  return {
    name: 'coverlay-sample-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://dev.local');
        if (url.pathname.startsWith('/api/')) {
          handleApi(req, res, url);
          return;
        }
        if (url.pathname === '/config.js') {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
          res.end("window.__COVERLAY__ = { apiBaseUrl: '/api' };\n");
          return;
        }
        next();
      });
    },
  };
}
