/**
 * The limits this Worker enforces before a request reaches the data Worker. The Worker artifact is built from
 * local modules only (tools/gates/src/build/worker.ts), so these are copies of the contracts' values; the test
 * workers/run/test/limits.test.ts holds them equal.
 */
export const RECORD_KINDS = ['tool', 'material', 'machine', 'project', 'setup'] as const;
export const RECORD_MAX_BYTES = 64 * 1024;
export const PROJECT_RECORD_MAX_BYTES = 512 * 1024;
export const recordMaxBytes = (kind: string): number => (kind === 'project' ? PROJECT_RECORD_MAX_BYTES : RECORD_MAX_BYTES);
export const FILE_MAX_BYTES = 50 * 1024 * 1024;
