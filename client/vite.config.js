import { defineConfig } from 'vite';

const target = process.env.DCS_SERVER ?? 'http://localhost:8080';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/ws': { target: target.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    // three.js is pulled in by the lazily-loaded 3D scene chunk.
    chunkSizeWarningLimit: 900,
  },
});
