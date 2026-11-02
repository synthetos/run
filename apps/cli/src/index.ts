/**
 * @synthetos/cli: bench tooling (ROADMAP P1-08). `run-cli bench` is the
 * bench runner (bench/runner.ts); the transcript recorder is the machine
 * session's EventLog (packages/machine), replayed by the test kit's
 * ReplayTransport.
 */
import { BENCH_USAGE } from './bench/args.ts';

export const VERSION = '0.0.0';

/** Text printed by `run-cli` with no command. Pure, so it is testable without a process. */
export function usage(): string {
  return `run-cli ${VERSION}\n\nCommands:\n  ${BENCH_USAGE}`;
}

export { BENCH_USAGE, DEFAULT_PYTHON, DEFAULT_URL, parseBenchArgs } from './bench/args.ts';
export type { BenchArgs } from './bench/args.ts';
export { parseChecklist, selectItems } from './bench/checklist.ts';
export type { ChecklistItem } from './bench/checklist.ts';
export { EXIT, checkTargetUrl, parseAnswer, runBench } from './bench/runner.ts';
export type { BenchBrowser, BenchDeps, BenchOptions, BenchRecord, ItemResult } from './bench/runner.ts';
export { HELPER_PATH, acquireHilLock } from './bench/hilLock.ts';
export type { HilLock, HilLockOptions, HilLockOutcome } from './bench/hilLock.ts';
