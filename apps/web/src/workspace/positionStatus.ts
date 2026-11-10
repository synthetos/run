/**
 * The Position panel's status line (owner, 2026-11-09): one line of plain text, "G54 · Not homed · Tool T0", in
 * place of a row of pills. "Not homed" opens W34 when clicked or hovered (SAFETY H51 as amended: on the pane W34 is
 * the Not homed word's help); the other homing words carry their own help (positionTag.ts).
 */
import { h, type ComponentChild } from 'preact';
import { w34 } from '@synthetos/safety';
import { ContextHelp } from '../shell/ContextHelp.ts';
import { signalText } from '../shell/signal.ts';
import { HomingTag } from './positionTag.ts';

export interface PositionStatusProps {
  /** The active coordinate system as reported ("G54"), or null when not known. */
  readonly wcs: string | null;
  /** All of X, Y and Z homed, false when not, null when not known. */
  readonly homed: boolean | null;
  /** How the session saw the position set on this link, if it did. */
  readonly by: 'homing' | 'hand' | undefined;
  /** The tool the board reports, if any. */
  readonly tool: number | null;
  /** The work units, shown in Simple (Advanced has them in the column head). */
  readonly units: string | null;
  /** A temporary offset (G92) is in force: the work positions are shifted by it. */
  readonly temporary?: boolean;
}

export function PositionStatus({ wcs, homed, by, tool, units, temporary = false }: PositionStatusProps): ComponentChild {
  const parts: ComponentChild[] = [
    h('span', { key: 'wcs', 'data-position': 'wcs' }, wcs ?? '—'),
    homed === false
      ? h('span', { key: 'homing', class: 'pos-word warn', 'data-position': 'homing' }, h(ContextHelp, { id: 'w34-help', label: 'Not homed: about moving before homing', safety: 'W34', trigger: 'Not homed', below: true }, ...signalText(w34())))
      : HomingTag(homed, by),
    temporary ? h('span', { key: 'g92', class: 'pos-word warn', 'data-position': 'g92', title: 'A temporary offset (G92) is in force: work positions are shifted by it.' }, 'G92 on') : null,
    tool === null ? null : h('span', { key: 'tool', 'data-position': 'tool' }, `Tool T${tool}`),
    units === null ? null : h('span', { key: 'units', 'data-position': 'units' }, units),
  ].filter((p) => p !== null);
  // Each part after the first carries its own separator, so a wrapped line never ends on a dot.
  return h('span', { class: 'pos-status-line', 'data-position': 'status' }, parts.map((p, i) => (i === 0 ? p : h('span', { key: `part${i}`, class: 'pos-part' }, h('span', { class: 'pos-sep', 'aria-hidden': 'true' }, ' · '), p))));
}
