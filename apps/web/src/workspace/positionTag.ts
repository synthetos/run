/**
 * The Position panel's homing tag in plain words (first-time walk 2026-11-08, S2).
 *
 * The board reports `home` 1 after a homing cycle and after a G28.3 (Set machine zero here) alike, so `home` alone
 * cannot say "Homed". The session notes which of its own commands set the position on this link
 * (`notices.position`); without that note the position was set before this connection, by a homing or by hand.
 * "Homed" (green) is only for a homing cycle this session saw. Words and colour only: nothing decides on this.
 */
import { h, type ComponentChild } from 'preact';
import { ContextHelp } from '../shell/ContextHelp.ts';

export type PositionTone = 'ok' | 'warn' | 'neutral';

export interface PositionTag {
  readonly text: string;
  readonly tone: PositionTone;
  /** Shown in the tag's help, or null for none. */
  readonly help: string | null;
}

export const SET_BY_HAND_HELP =
  'You set the machine position by hand (Set machine zero here), not with the homing switches. Positions, Go to zero heights and soft limits count from the point you set. Home the machine to set it from the switches.';
export const SET_BEFORE_HELP =
  'The board says its position was set before this connection, by homing or by hand; this page did not see which. Home the machine to be sure it comes from the switches.';

/** The tag for `homed` (all of X, Y and Z, or null when unknown) and the session's note of how it was set. */
export function positionTag(homed: boolean | null, by: 'homing' | 'hand' | undefined): PositionTag | null {
  if (homed === null) return { text: 'Homing unknown', tone: 'neutral', help: null };
  if (!homed) return null; // The caller shows "Not homed" with W34.
  if (by === 'homing') return { text: 'Homed', tone: 'ok', help: null };
  if (by === 'hand') return { text: 'Position set by hand', tone: 'warn', help: SET_BY_HAND_HELP };
  return { text: 'Position set before connecting', tone: 'warn', help: SET_BEFORE_HELP };
}

/** The tag element for a known `homed` (the caller shows "Not homed" with W34 itself). */
export function HomingTag(homed: boolean | null, by: 'homing' | 'hand' | undefined): ComponentChild {
  const tag = positionTag(homed, by);
  if (tag === null) return null;
  const cls = tag.tone === 'ok' ? 'tag ok' : tag.tone === 'warn' ? 'tag warn' : 'tag';
  const help = tag.help === null ? null : h(ContextHelp, { id: 'position-set-help', label: 'About how the position was set', below: true }, tag.help);
  return h('span', { class: cls, 'data-position': 'homing', 'data-homed-by': by ?? 'unknown' }, tag.text, help);
}
