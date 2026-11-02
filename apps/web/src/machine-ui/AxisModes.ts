/**
 * The axis-mode facts for read-only sessions (Phase 0 finding row 35, its
 * Phase 1 consequence; BENCH-P100-5; packages/safety/src/axisModeFacts.ts).
 *
 * Phase 1 sends no motion, but an axis-mode configuration that is unsafe
 * for LATER motion is shown, never hidden: an inhibited axis away from 0, a
 * mode that was not read or is not recognised, a disabled or radius-mode
 * linear axis. Every fact is one plain sentence from @synthetos/safety,
 * rendered as a text node. An axis whose mode was not read is reported as
 * such, never assumed standard.
 *
 * `axisModeView` turns the settings read (`xam`..`cam`) and the polled
 * machine position into the facts; `AxisModes` renders them. Both are pure.
 */
import { h, type ComponentChild } from 'preact';
import { axisModeFacts, type AxisModeFact, type AxisModeSession } from '@synthetos/safety';
import type { Family } from '@synthetos/protocol';
import type { SettingValue } from '@synthetos/schema';

const AXES = ['X', 'Y', 'Z', 'A', 'B', 'C'] as const;
type Axis = (typeof AXES)[number];

/** The controller family of a dialect id, or null when it is not one run knows. */
export function familyOf(dialectId: string | null): Family | null {
  if (dialectId === null) return null;
  if (dialectId.startsWith('tinyg')) return 'tinyg';
  if (dialectId.startsWith('g2core')) return 'g2core';
  return null;
}

export type AxisModeView =
  /** The settings read (which carries the axis modes) is still running. */
  | { readonly kind: 'reading' }
  /** The board was not classified, so its axis modes mean nothing yet. */
  | { readonly kind: 'unclassified' }
  | { readonly kind: 'facts'; readonly facts: readonly AxisModeFact[]; readonly session: AxisModeSession };

export interface AxisModeInput {
  readonly dialectId: string | null;
  /** True while the connect-time settings read is in progress. */
  readonly reading: boolean;
  /** The flattened settings of the last complete read (`xam`..`cam` among them), or empty. */
  readonly settings: Readonly<Record<string, SettingValue>>;
  /** The DRO axes (lower-case axis names; machine position from polled `mpo`, or null). */
  readonly machine: readonly { readonly axis: string; readonly machine: number | null }[];
  readonly session?: AxisModeSession;
}

export function axisModeView(input: AxisModeInput): AxisModeView {
  const family = familyOf(input.dialectId);
  if (family === null) return { kind: 'unclassified' };
  if (input.reading) return { kind: 'reading' };
  const modes: Partial<Record<Axis, number>> = {};
  const machine: Partial<Record<Axis, number | null>> = {};
  for (const axis of AXES) {
    const am = input.settings[`${axis.toLowerCase()}am`];
    if (typeof am === 'number') modes[axis] = am;
    machine[axis] = input.machine.find((a) => a.axis === axis.toLowerCase())?.machine ?? null;
  }
  const { facts, session } = axisModeFacts(family, { modes, machine }, input.session);
  return { kind: 'facts', facts, session };
}

export function AxisModes({ view }: { readonly view: AxisModeView }): ComponentChild {
  const body = (): ComponentChild => {
    switch (view.kind) {
      case 'reading':
        return h('p', { role: 'status', 'data-axis-modes': 'reading' }, 'Reading the axis modes with the settings…');
      case 'unclassified':
        return h('p', { 'data-axis-modes': 'unclassified' }, 'The board is not classified, so its axis modes were not read. Motion stays blocked.');
      case 'facts':
        return view.facts.length === 0
          ? h('p', { 'data-axis-modes': 'clear' }, 'Every axis reads a mode that later motion can use, and no inhibited axis is away from 0.')
          : h(
              'ul',
              { class: 'axis-facts', 'data-axis-modes': 'facts' },
              view.facts.map((f) => h('li', { key: `${f.axis}-${f.code}`, 'data-axis': f.axis, 'data-axis-fact': f.code }, f.text)),
            );
    }
  };
  return h(
    'section',
    { class: 'axis-modes', 'data-region': 'axis-modes', 'aria-labelledby': 'axis-modes-title' },
    h('h2', { id: 'axis-modes-title' }, 'Axis modes (read only)'),
    h('p', { class: 'axis-modes-note' }, 'This release never moves the machine. Each line below would block motion in a later release until it is resolved; nothing here changes the board.'),
    body(),
  );
}
