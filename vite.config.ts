import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 1000 },
  test: { environment: 'node' },
} as never);
