/**
 * A paste of more than one line (H91, owner 2026-11-09): the terminal sends one line at a time, so the view offers
 * "Open as a job" instead, where the whole program is checked before anything runs.
 *
 * Pure.
 */

/** The non-blank lines of `input` when there are two or more, else null (one line, or nothing). */
export function pastedLines(input: string): readonly string[] | null {
  if (!/[\r\n]/.test(input)) return null;
  const lines = input
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines.length > 1 ? lines : null;
}

/** The pasted lines as one program text, for "Open as a job". */
export function asProgram(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
