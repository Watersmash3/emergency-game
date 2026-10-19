import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      allow: [repoRoot],
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@emergency/simulation', '@emergency/protocol', '@emergency/content'],
  },
});
