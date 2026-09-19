import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: Vite serves the client on 5173 and proxies API + WebSocket traffic to the
// Node server on 8787. Production: `vite build` emits dist/client, which the Node
// server serves itself (see src/server/index.ts). Same-origin `/api` and `/ws`
// paths work in both modes, so the client never hard-codes a backend URL.
const SERVER_PORT = Number(process.env.PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
    // Phaser alone is ~1.5 MB minified; a single chunk is fine for this project.
    chunkSizeWarningLimit: 2000,
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
