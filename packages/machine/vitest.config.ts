// ROADMAP P0-12: the Transport guard is the last check before bytes leave
// the host (SAFETY H2b, T-S16). Every machine source is held to 100% so an
// untested branch in it cannot exist.
import { defineConfig } from 'vitest/config';

const FULL = { branches: 100, functions: 100, lines: 100, statements: 100 };

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        'src/**/*.ts': FULL,
      },
    },
  },
});
