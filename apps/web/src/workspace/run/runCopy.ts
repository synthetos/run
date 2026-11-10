/**
 * The Run step's short wording (owner, 2026-11-09: "short sentences everywhere"). Every text here that stands in for a
 * registered safety string (C30, C31, C32, C36, C40, C41, W5, the attestation) is PROPOSED: it waits for the owner's
 * approval in the strings table sent with this change. Until then the registered texts stay one click away, under
 * Details in the start confirmation, and in the Notes tab. When the owner approves, these move into
 * packages/safety/src/strings.ts and the SAFETY §5/§6 rows; if a text is refused, the registered one is used here.
 *
 * Pure.
 */

/** The marks of the list: done, needs you, blocked, still checking. */
export type Mark = 'done' | 'needs' | 'blocked' | 'waiting';

export const MARK_TEXT: Readonly<Record<Mark, string>> = { done: '✓', needs: '!', blocked: '✕', waiting: '…' };
export const MARK_WORDS: Readonly<Record<Mark, string>> = { done: 'Done', needs: 'Needs you', blocked: 'Blocked', waiting: 'Checking' };

/** The phrases the one start tick confirms, one per confirmation that applies (proposed short C31, C36, C32, W5). */
export const TICK_PHRASE = {
  workZero: 'cut from the board’s work zero',
  unhomed: 'I checked where every axis is',
  spindle: 'hands clear when the spindle starts',
  attended: 'I’ll stay at the machine, with sleep off',
} as const;

export type TickPart = keyof typeof TICK_PHRASE;

/** The one tick's words: "I confirm: <phrase> · <phrase>." */
export function tickText(parts: readonly TickPart[]): string {
  return `I confirm: ${parts.map((p) => TICK_PHRASE[p]).join(' · ')}.`;
}

/**
 * The start confirmation's short C30 is used only once the owner approves it (strings table); until then the
 * registered C30 is shown. W5 is always the registered text (its short form goes into strings.ts on approval).
 */
export const SHORT_C30_APPROVED = false;

/** Proposed short C30, the start confirmation. */
export function startQuestion(p: { readonly file: string; readonly workZero: string; readonly spindle: string }): string {
  return `Start ${p.file}? Work zero: ${p.workZero}. Spindle: ${p.spindle}. Keep a hand on the E-stop.`;
}

/** Proposed short C41 (a move past the travel of an axis that is not homed), as the travel modal says it. */
export function travelPastText(p: { readonly axis: string; readonly line: number; readonly reach: number; readonly limit: number; readonly unit: string; readonly more: number }): { readonly title: string; readonly body: string } {
  const n = (v: number): string => (Math.round(v * 1000) / 1000).toString().replace('-', '−');
  return {
    title: `This job goes past the ${p.axis} limit.`,
    body: `Line ${p.line.toLocaleString('en-US')} moves ${p.axis} to ${n(p.reach)} ${p.unit}. ${p.axis} stops at ${n(p.limit)} ${p.unit}. ${p.axis} isn’t homed, so its position may be off.${p.more > 0 ? ` ${p.more.toLocaleString('en-US')} more ${p.more === 1 ? 'move goes' : 'moves go'} past too.` : ''}`,
  };
}

/** Proposed short C40 (the travel could not be checked), as the travel modal says it. */
export function travelUncheckedText(why: string): { readonly title: string; readonly body: string } {
  return { title: 'Run can’t check this job against the travel.', body: `${why.charAt(0).toUpperCase()}${why.slice(1).replace(/\.$/, '')}. Start only if every move fits.` };
}

/**
 * A refused start in plain words for the modal's body (owner, 2026-11-09): the session's own sentence without its
 * "The job did not start" lead-in and its instructions about confirmation numbers.
 */
export function refusedBody(message: string): string {
  const text = message.replace(/^The job did not start[.:]\s*/i, '').replace(/\s*Confirm C\d+ to start\.?$/, '').trim();
  return text.length === 0 ? 'Run stopped before the first line.' : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
