// Mutation testing only (stryker.config.json): the same tests with fewer
// fast-check runs per property, so a full Stryker run fits CI's time limit.
// Every branch is also covered by a deterministic test (see vitest.config.ts).
//
// A longer per-test timeout: Stryker's instrumented code (every expression behind a mutant switch, with per-test
// coverage) runs the allow-matrix sweep in allowMatrix.test.ts (about 2.2 million cells) 4-6 times slower than
// plain code: 0.4 s plain and 1.5-2.5 s instrumented on a 10-core Mac, past vitest's 5 s default on a 4-core GitHub
// runner with four Stryker runners at once, which failed the initial test run (CI run 42706629535). The mutant runs
// have their own timeout (stryker.config.json timeoutMS, on top of each test's dry-run time).
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.ts';

// Killed mutants are expected test failures. An explicit reporter list prevents Vitest from
// adding its GitHub Actions reporter and publishing the last mutant as a job-summary failure.
export default mergeConfig(base, defineConfig({ test: { reporters: ['default'], env: { RUN_PROPERTY_RUNS: '40' }, testTimeout: 60_000 } }));
