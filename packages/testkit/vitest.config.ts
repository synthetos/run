// The test kit is the oracle the machine-path tests trust, so its own code is
// held to a coverage floor. The firmware models carry the behaviour register:
// test/honesty.test.ts already requires a titled test per behaviour; this
// keeps the code around those behaviours exercised too.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { statements: 92, branches: 85, functions: 95, lines: 95 },
    },
  },
});
