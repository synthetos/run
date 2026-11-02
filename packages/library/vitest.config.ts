// MACHINING_ASSISTANT §8, §9: URL sanitising, validation and the
// placeholder flags decide what reaches the user as a link or as advice.
// Every library source is held to 100%, like the safety-path packages.
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
