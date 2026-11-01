// ROADMAP P0-07 acceptance: 100% branch coverage on frame.ts and classify.ts.
// `pnpm test` runs with coverage, so CI fails if a branch in either file loses
// its test. Every other protocol source (P0-07 and P0-08) is held to the same
// bar: the dialect data, the probe, the classifier and the manifest verifier
// are safety decisions, and an untested branch in them is a hole.
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
        'src/probe.ts': FULL,
        'src/approvedBuilds.ts': FULL,
        'src/releaseKeys.ts': FULL,
        'src/dialects/**/*.ts': FULL,
      },
    },
  },
});
