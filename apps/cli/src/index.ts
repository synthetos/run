/**
 * @synthetos/cli: bench tooling. Empty in P0-01; the recorder, replayer and
 * bench runner arrive in P1-08.
 */

export const VERSION = '0.0.0';

/** Text printed by `run-cli`. Pure, so it is testable without a process. */
export function usage(): string {
  return `run-cli ${VERSION}\nNo commands yet. Bench tooling arrives in P1-08.\n`;
}
