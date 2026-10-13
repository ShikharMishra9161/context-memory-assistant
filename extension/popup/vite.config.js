import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // The popup imports ../lib (shared with the service worker) and ../../shared/handoff-core.
  server: {
    fs: { allow: [resolve(here, '../..')] },
  },
  build: {
    outDir: resolve(here, '../dist-popup'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(here, 'index.html'),
    },
  },
});
