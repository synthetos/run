// ROADMAP P0-07 acceptance: 100% branch coverage on frame.ts and classify.ts.
// `pnpm test` runs with coverage, so CI fails if a branch in either file loses
// its test. The other P0-07 sources (json.ts, inbound.ts) are held to the
// same bar.
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
        'src/frame.ts': FULL,
        'src/classify.ts': FULL,
        'src/inbound.ts': FULL,
        'src/json.ts': FULL,
      },
    },
  },
});
