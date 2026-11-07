import { build } from 'esbuild';
import { statSync } from 'node:fs';

const out = new URL('../src/vendor/tiptap.js', import.meta.url).pathname;
await build({
  entryPoints: [new URL('./entry.js', import.meta.url).pathname],
  outfile: out,
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  legalComments: 'none',
  banner: { js: '/* Tiptap 3.32.0 + ProseMirror, MIT licensed (https://tiptap.dev). Bundled by frontend/vendor-build. */' },
});
console.log(`wrote ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
