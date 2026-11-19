/**
 * The axis-mode facts (Phase 0 finding row 35; BENCH-P100-5;
 * packages/safety/src/axisModeFacts.ts): an axis-mode configuration that
 * blocks motion is shown, never hidden: an inhibited axis away from 0, a mode
 * that was not read or is not recognised, a disabled or radius-mode linear
 * axis. Every fact is one plain sentence from @synthetos/safety, rendered as a
 * text node in that axis's card on the Board view's Axes tab (Board settings
 * spec §5.6). An axis whose mode was not read is reported as such, never
 * assumed standard.
 *
 * `axisModeView` turns the settings read (`xam`..`cam`) and the reported
 * machine position into the facts; `axisModeFact` picks one axis's. Both are
 * pure.
 */
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
  /** The DRO axes (lower-case axis names; machine position from the board's reports, or null). */
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

/** The state of the axis-mode facts in one word, for the Axes tab's `data-axis-modes`. */
export function axisModeState(view: AxisModeView | null): 'reading' | 'unclassified' | 'clear' | 'facts' | null {
  if (view === null) return null;
  if (view.kind !== 'facts') return view.kind;
  return view.facts.length === 0 ? 'clear' : 'facts';
}

/** The fact for one axis (`x`..`c`, either case), or null. */
export function axisModeFact(view: AxisModeView | null, axis: string): AxisModeFact | null {
  return view?.kind === 'facts' ? (view.facts.find((f) => f.axis === axis.toUpperCase()) ?? null) : null;
}

/** The fact sentence for one axis, or null (for the axis cards). */
export function axisModeLine(view: AxisModeView | null, axis: string): string | null {
  return axisModeFact(view, axis)?.text ?? null;
}
