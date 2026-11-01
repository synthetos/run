import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  // Preact automatic JSX runtime, configured directly (no extra plugin).
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      // Multi-page app: one HTML input per page, relative to the project root.
      // /safety/ and the other static pages join in P0-05.
      input: {
        workspace: 'index.html',
      },
    },
  },
});
