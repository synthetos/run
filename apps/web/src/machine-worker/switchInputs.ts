/** The post-flash switch check's inputs: every configured limit switch (H82, W45). */
import type { SessionSnapshot } from '@synthetos/machine';
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

/** What this worker's own reads saw of each input: open (0) and closed (1). */
export type SeenInputs = Map<number, { open: boolean; closed: boolean }>;

type Values = SessionSnapshot['values'];

/** An input's state in the session's values: a single read (`in5`) or the group (`in`, answered as {"1":0,...,"8":0}). */
function inputValue(values: Values, input: number): number | undefined {
  const single = values[`in${input}`];
  const group = values['in'];
  const groupValue = group !== undefined && group.status === 0 && typeof group.value === 'object' && group.value !== null && !Array.isArray(group.value) ? (group.value as Record<string, unknown>)[String(input)] : undefined;
  if (typeof groupValue === 'number') return groupValue;
  return single !== undefined && single.status === 0 && typeof single.value === 'number' ? single.value : undefined;
}

/** Records in `seen` what the values show for each input. True when anything new was seen. */
export function observeInputs(inputs: readonly SwitchInput[], values: Values, seen: SeenInputs): boolean {
  let changed = false;
  for (const i of inputs) {
    const value = inputValue(values, i.input);
    if (value === undefined) continue;
    const was = seen.get(i.input) ?? { open: false, closed: false };
    const next = { open: was.open || value === 0, closed: was.closed || value === 1 };
    if (next.open !== was.open || next.closed !== was.closed) {
      seen.set(i.input, next);
      changed = true;
    }
  }
  return changed;
}
