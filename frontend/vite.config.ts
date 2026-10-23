import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Splits the heavy vendor code out of the entry chunk.
 *
 * Only the CodeMirror packages that are imported statically end up in the
 * `codemirror` chunk. Everything that is reached through the lazy
 * `@codemirror/language-data` import (the ~100 single language modes and
 * their `@lezer/*` parsers) must stay out of it, otherwise the eager chunk
 * would grow to more than 1.5 MB and every language mode would be loaded up
 * front.
 */
const CODEMIRROR_PACKAGES = [
  '@codemirror/commands',
  '@codemirror/lang-markdown',
  '@codemirror/language',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  '@lezer/markdown',
];

function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  const normalized = id.replace(/\\/g, '/');

  for (const pkg of CODEMIRROR_PACKAGES) {
    if (normalized.includes(`/node_modules/${pkg}/`)) return 'codemirror';
  }
  if (/\/node_modules\/marked\//.test(normalized)) return 'markdown';
  if (/\/node_modules\/dompurify\//.test(normalized)) return 'markdown';
  if (/\/node_modules\/idb\//.test(normalized)) return 'idb';
  if (/\/node_modules\/preact\//.test(normalized)) return 'preact';
  return undefined;
}

export default defineConfig({
  plugins: [preact()],
  server: {
    // `npm run dev` talks to a locally running backend.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    // The vendor chunks are intentionally big; they are cached separately.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
