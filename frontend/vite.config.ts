import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { sampleApi } from './dev/sample-api.mjs';

// `npm run dev` serves the app with the sample API from preview/mock-api.mjs, so every screen can be
// clicked through without the backend (open /preview to start a signed-in session).
// `BACKEND_URL=http://localhost:8080 npm run dev` sends /api to the real backend instead (the same
// path rewrite nginx does in production: /api/x becomes /x).
const backend = process.env.BACKEND_URL;

export default defineConfig({
  plugins: [react(), ...(backend ? [] : [sampleApi()])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app', import.meta.url)),
      // The DOM-free rules modules, still plain JavaScript and still tested by `npm test`.
      '@legacy': fileURLToPath(new URL('./src/js', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: backend ? { '/api': { target: backend, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } } : undefined,
  },
  build: { outDir: 'dist', sourcemap: true },
});
