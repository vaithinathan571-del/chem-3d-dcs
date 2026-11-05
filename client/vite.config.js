import { defineConfig } from 'vite';

const target = process.env.DCS_SERVER ?? 'http://localhost:8080';

export default defineConfig(({ mode }) => {
  // `--mode pages` builds the standalone client for static hosting (GitHub Pages):
  // the DCS runtime runs in a Web Worker, assets use relative URLs so the site
  // works under any sub-path, and output goes to dist-pages/.
  const pages = mode === 'pages';
  return {
    base: pages ? './' : '/',
    server: {
      port: 5173,
      proxy: {
        '/api': target,
        '/ws': { target: target.replace(/^http/, 'ws'), ws: true },
      },
    },
    worker: { format: 'es' },
    build: {
      target: 'es2022',
      outDir: pages ? 'dist-pages' : 'dist',
      // three.js is pulled in by the lazily-loaded 3D scene chunk.
      chunkSizeWarningLimit: 900,
    },
  };
});
