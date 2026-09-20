import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: Vite serves the client on 5173 and proxies API + WebSocket traffic to the
// Node server on 8787. Production: `vite build` emits dist/client, which the Node
// server serves itself (see src/server/index.ts). Same-origin `/api` and `/ws`
// paths work in both modes, so the client never hard-codes a backend URL.
const SERVER_PORT = Number(process.env.PORT ?? 8787);

// Static hosting under a sub-path (GitHub Pages serves this repo at /HackMIT2026/). The
// Node server always serves at '/', so leave unset for `npm start`.
const BASE_PATH = process.env.RELAY_BASE_PATH ?? '/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
    // Phaser alone is ~1.5 MB minified; keep it in its own vendor chunk.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: (id) => id.includes('/node_modules/phaser/') ? 'phaser' : undefined,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true },
    },
  },
});
