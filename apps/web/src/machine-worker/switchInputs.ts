/** The post-flash switch check's inputs: every configured limit switch (H82, W45). */
import type { SettingValue } from '@synthetos/schema';

const AXIS_INPUTS: readonly { readonly axis: string; readonly min: number; readonly max: number }[] = [
  { axis: 'x', min: 1, max: 2 },
  { axis: 'y', min: 3, max: 4 },
  { axis: 'z', min: 5, max: 6 },
  { axis: 'a', min: 7, max: 8 },
];

export interface SwitchInput {
  readonly input: number;
  readonly label: string;
  readonly seenOpen: boolean;
  readonly seenClosed: boolean;
}

/** The inputs the switch check needs (1..8): each axis min or max switch whose mode is not 0, none seen yet. */
export function requiredInputs(board: Readonly<Record<string, SettingValue>>): SwitchInput[] {
  const out: SwitchInput[] = [];
  for (const a of AXIS_INPUTS) {
    if (typeof board[`${a.axis}sn`] === 'number' && board[`${a.axis}sn`] !== 0) out.push({ input: a.min, label: `${a.axis.toUpperCase()} min (input ${a.min})`, seenOpen: false, seenClosed: false });
    if (typeof board[`${a.axis}sx`] === 'number' && board[`${a.axis}sx`] !== 0) out.push({ input: a.max, label: `${a.axis.toUpperCase()} max (input ${a.max})`, seenOpen: false, seenClosed: false });
  }
  return out;
}
