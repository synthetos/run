// ROADMAP P0-10 acceptance: 100% branch coverage on `safety`. `pnpm test` runs
// with coverage, so CI fails if any branch of any safety source loses its test.
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
