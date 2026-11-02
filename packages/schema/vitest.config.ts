// ROADMAP P0-09: the read allowlists, forbidden writes, settings schema,
// validation and write-plan gate are safety decisions (SAFETY §8: schema
// allowlists and schemas). Every source of P0-09 is held to 100% coverage,
// like protocol: an untested branch in a safety list is a hole. TB-01's
// profile and fact engine are held to the same bar.
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
        'src/allowlists/**/*.ts': FULL,
        'src/tables/**/*.ts': FULL,
        'src/overlays/**/*.ts': FULL,
        'src/generated/**/*.ts': FULL,
        'src/frozen.ts': FULL,
        'src/forbiddenWrites.ts': FULL,
        'src/settingsSchema.ts': FULL,
        'src/settingsRead.ts': FULL,
        'src/validate.ts': FULL,
        'src/travel.ts': FULL,
        'src/writePlan.ts': FULL,
        // TB-01: MachineProfile v2, the fact engine, invalidation rules and the gate DSL.
        'src/profile/**/*.ts': FULL,
        'src/facts/**/*.ts': FULL,
      },
    },
  },
});
