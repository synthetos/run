// MACHINING_ASSISTANT §6.4: the envelope bounds every suggestion from every
// engine before it can reach the board, and the rules model decides what is
// shown as advice. Every advisor source is held to 100%, like the
// safety-path packages: an untested branch in the envelope is a hole.
import { defineConfig } from 'vitest/config';

const FULL = { branches: 100, functions: 100, lines: 100, statements: 100 };

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { 'src/**/*.ts': FULL },
    },
  },
});
