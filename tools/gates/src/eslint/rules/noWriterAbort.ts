import { bannedNamesRule } from './bannedNames.ts';

/**
 * Bans every `abort` in the machine package. `WritableStreamDefaultWriter`'s
 * `abort()` discards queued data and can cut a line in half; the tail then
 * merges with the next line (TinyG) or a fragment executes (g2): SAFETY H2b,
 * PROTOCOL_NOTES §3.3. The Transport has no `abort()` at all (SAFETY §3), so
 * the rule bans the name outright rather than trying to tell writers apart
 * from other objects: a timeout uses `AbortSignal.timeout()`, which needs no
 * `abort` member access.
 */
export const noWriterAbort = bannedNamesRule({
  description: 'Ban abort() in the machine package (SAFETY H2b: no mid-line abort).',
  names: ['abort'],
  message:
    "'{{name}}' is banned in packages/machine: aborting a serial writer discards a partly sent line " +
    '(SAFETY H2b, PROTOCOL_NOTES §3.3). The Transport has no abort(); finish the current line write instead.',
});
