/**
 * The Run step's words. The safety strings (the start tick's phrases, C40 and C41 as the travel modal asks them) are
 * the registered ones in packages/safety/src/strings.ts (OD-32, owner 2026-11-09: "approve with fire risk"); this
 * module only picks which apply. The marks and the refused-start body are presentation.
 *
 * Pure.
 */
import { c31Tick, c32Tick, c36Tick, c40Body, c40Title, c41Body, c41Title, startAttestTick, startTick } from '@synthetos/safety';
/** The marks of the list: done, needs you, blocked, still checking. */
export type Mark = 'done' | 'needs' | 'blocked' | 'waiting';

export const MARK_TEXT: Readonly<Record<Mark, string>> = { done: '✓', needs: '!', blocked: '✕', waiting: '…' };
export const MARK_WORDS: Readonly<Record<Mark, string>> = { done: 'Done', needs: 'Needs you', blocked: 'Blocked', waiting: 'Checking' };

/** The confirmations the one start tick can carry: C31, C36, C32 and the attestation (§4.4). */
export type TickPart = 'workZero' | 'unhomed' | 'spindle' | 'attended';

const PHRASE: Readonly<Record<TickPart, () => string>> = { workZero: c31Tick, unhomed: c36Tick, spindle: c32Tick, attended: startAttestTick };

/** The one tick's words (OD-32): "I confirm: <phrase> · <phrase>." */
export function tickText(parts: readonly TickPart[]): string {
  return startTick({ phrases: parts.map((p) => PHRASE[p]()) });
}

/** C41 as the travel modal asks it. */
export function travelPastText(p: { readonly axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'; readonly line: number; readonly reach: number; readonly limit: number; readonly unit: 'mm' | '°'; readonly more: number }): { readonly title: string; readonly body: string } {
  return { title: c41Title({ axis: p.axis }), body: c41Body(p) };
}

/** C40 as the travel modal asks it. */
export function travelUncheckedText(why: string): { readonly title: string; readonly body: string } {
  return { title: c40Title(), body: c40Body({ why }) };
}

/**
 * A refused start in plain words for the modal's body (owner, 2026-11-09): the session's own sentence without its
 * "The job did not start" lead-in and its instructions about confirmation numbers.
 */
export function refusedBody(message: string): string {
  const text = message.replace(/^The job did not start[.:]\s*/i, '').replace(/\s*Confirm C\d+ to start\.?$/, '').trim();
  return text.length === 0 ? 'Run stopped before the first line.' : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
