/**
 * What Place job can say about travel and clamps (owner, 2026-11-09; OD-24's travel check). The travel check runs
 * with the board, at its current work zero, once the file is checked: its result is shown when the machine is
 * connected and homed. Otherwise a short note says when it runs. Clamp clearance is not checked. Pure.
 */

export interface PlaceTravelInput {
  readonly connected: boolean;
  readonly homed: boolean;
  /** The checked job's travel result (the worker's report), or undefined before a check with this board. */
  readonly travel?: { readonly block: { readonly text: string } | null; readonly confirm: { readonly text: string; readonly line?: number | null; readonly past?: { readonly axis: string } } | null } | undefined;
}

export const CLAMPS_NOT_CHECKED = 'Clamp clearance is not checked. Look before you start.';

export function placeTravelText({ connected, homed, travel }: PlaceTravelInput): string {
  if (!connected) return 'Travel is checked when a machine is connected and homed.';
  if (!homed) return 'Travel is checked once the machine is homed.';
  if (travel === undefined) return 'Travel is checked in the Check step.';
  if (travel.block !== null) return `Travel: ${travel.block.text}`;
  const c = travel.confirm;
  // A move past travel with the position not known: the Ready list's few words; Start asks about it (C40/C41).
  if (c !== null && c.past !== undefined && typeof c.line === 'number') return `Travel: line ${c.line.toLocaleString('en-US')} goes past ${c.past.axis}. Start asks about it.`;
  if (c !== null) return `Travel not fully checked: ${c.text.replace(/\.?$/, '.')}`;
  return 'Travel: the job fits the machine at the board’s work zero now.';
}
