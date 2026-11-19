/**
 * The coolant output in words and commands (owner, 2026-11-18, pictures 151 and 152: "how in the hell would tg know
 * if its flood or coolant?"). TinyG drives one coolant output and cannot know what is wired to it, so the machine
 * record says (`MachineProfile.coolant`), and the Job page shows one toggle named by that choice. Flood (and no
 * choice yet) switches on with M8; mist and air with M7; M9 switches it off. A G-code file's own M7, M8 and M9 are
 * not touched here, and nothing that pauses or stops reads this. Pure.
 */
import type { MachineCoolant } from '@synthetos/library';
import type { MotionCommand, SnapshotMessage } from '../machine-worker/rpc.ts';

type Live = SnapshotMessage['snapshot']['live'];

/** The choices the Board panel and the wizard offer, in that order. */
export const COOLANT_WIRING: readonly (readonly [MachineCoolant, string])[] = Object.freeze([
  ['none', 'Not used'],
  ['flood', 'Flood coolant'],
  ['mist', 'Mist'],
  ['air', 'Air blast'],
] as const);

const LABEL: Readonly<Record<MachineCoolant, string>> = Object.freeze({ none: 'Coolant', flood: 'Flood', mist: 'Mist', air: 'Air' });

/** The toggle's name: the machine's choice, or "Coolant" while it has none. */
export function coolantLabel(kind: MachineCoolant | null): string {
  return kind === null ? 'Coolant' : LABEL[kind];
}

const onCode = (kind: MachineCoolant | null): 'M7' | 'M8' => (kind === 'mist' || kind === 'air' ? 'M7' : 'M8');

/** Switch on: M8 for flood and for no choice yet, M7 for mist and air. Off is always `coolantOff` (M9). */
export function coolantOnCommand(kind: MachineCoolant | null): MotionCommand {
  return { op: 'coolantOn', which: onCode(kind) === 'M7' ? 'mist' : 'flood' };
}

const known = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The output is on: the board reports flood (`cof`) or mist (`com`) on. */
export function coolantIsOn(live: Live | undefined): boolean {
  return live?.cof === 1 || live?.com === 1;
}

/** The strip and panel readout: "Flood on", "Coolant off", "Not used", or the board's unreported text. */
export function coolantReadout(live: Live | undefined, kind: MachineCoolant | null): string {
  if (kind === 'none') return 'Not used';
  if (!known(live?.cof) && !known(live?.com)) return unreported(live);
  return `${coolantLabel(kind)} ${coolantIsOn(live) ? 'on' : 'off'}`;
}

/** Neither readout known: "Unknown", or "Not reported" when the board's status list lacks both (as status.ts says it). */
function unreported(live: Live | undefined): string {
  const list = live?.srList;
  return list !== undefined && !list.includes('cof') && !list.includes('com') ? 'Not reported' : 'Unknown';
}

/** The "?" beside the toggle: what it sends, and that Run cannot tell what is wired. */
export function coolantHelp(kind: MachineCoolant | null): string {
  const wired = kind === null || kind === 'none' ? 'a pump, a mist valve or an air blast' : `this machine says ${COOLANT_WIRING.find(([k]) => k === kind)?.[1].toLowerCase() ?? ''}`;
  return `${coolantLabel(kind)} sends ${onCode(kind)} to switch the coolant output on and M9 to switch it off. Run cannot tell what is wired to it: ${wired}.`;
}
