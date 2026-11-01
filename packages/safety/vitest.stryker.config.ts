// Mutation testing only (stryker.config.json): the same tests with fewer
// fast-check runs per property, so a full Stryker run fits CI's time limit.
// Every branch is also covered by a deterministic test (see vitest.config.ts).
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.ts';

export default mergeConfig(base, defineConfig({ test: { env: { RUN_PROPERTY_RUNS: '40' } } }));
