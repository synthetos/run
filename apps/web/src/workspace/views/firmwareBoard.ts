/**
 * Which board the Firmware tab describes under "On this board", and in what words.
 *
 * The machine session closes while a firmware update runs (the port is in bootloader role), so the live identity is
 * gone exactly when the user watches the update. The tab then shows the board as the session last read it, from the
 * flash view, never "not connected" (owner, bench 2, 2026-11-09):
 * - connected and identified: the live identity;
 * - an update running: "Updating 3Y2462-WWR: 450.02 → 450.02 (signed release)";
 * - an update done, the board not read back yet: "Updated …", with what the board reported if it did;
 * - an update stopped: the board as last read, and that the update stopped;
 * - otherwise: not connected.
 */
import type { FlashView } from '../../machine-worker/flashService.ts';

export interface LiveIdentity {
  readonly id?: unknown;
  readonly hv?: unknown;
  readonly fb?: unknown;
}

export interface ShownBoard {
  readonly kind: 'live' | 'updating' | 'updated' | 'stopped' | 'none';
  /** The heading after "On this board". */
  readonly heading: string;
  /** The line under it. */
  readonly detail: string;
  /** The firmware build to compare releases with, the hardware version to list them for, the board id. */
  readonly fb: number | null;
  readonly hv: number | null;
  readonly id: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** "450.02", or "unknown". */
export function fbWords(fb: number | null): string {
  return fb === null ? 'unknown' : fb.toFixed(2);
}

const SOURCE: Record<FlashView['source'], string> = { release: 'signed release', backup: 'firmware backup', custom: 'unsigned custom firmware' };

function targetWords(flash: FlashView): string {
  return `${flash.target.fb === null ? 'the chosen image' : fbWords(flash.target.fb)} (${SOURCE[flash.source]})`;
}

function hardware(hv: number | null, id: string | null, text: (s: string) => string): string {
  return `Hardware version ${hv === null ? 'unknown' : text(String(hv))}${id === null ? '' : ` · board ${text(id)}`}`;
}

/**
 * `on`: the session is connected; `live`: its identity; `flash`: the worker's flash view; `text`: how board-supplied
 * strings are made safe to show (boardText).
 */
export function shownBoard(on: boolean, live: LiveIdentity | null, flash: FlashView | null, text: (s: string) => string): ShownBoard {
  if (on && live !== null) {
    const fb = num(live.fb);
    const hv = num(live.hv);
    const id = str(live.id);
    return { kind: 'live', heading: fb === null ? 'Firmware not read' : `Firmware ${fbWords(fb)}`, detail: hardware(hv, id, text), fb, hv, id };
  }
  const board = flash?.board ?? null;
  if (flash === null || board === null) {
    return { kind: 'none', heading: 'Firmware not read', detail: 'Connect a board to read its firmware version.', fb: null, hv: null, id: null };
  }
  const id = board.id;
  const who = id === null ? 'the board' : text(id);
  const base = { fb: board.fb, hv: board.hv, id };
  if (flash.phase === 'done') {
    const reported = flash.versionCheck?.reported ?? null;
    return {
      ...base,
      kind: 'updated',
      heading: `Updated ${who}: ${fbWords(board.fb)} → ${targetWords(flash)}`,
      detail: reported !== null ? `The board reports ${fbWords(reported)}.` : flash.message === null ? 'Reading the board again…' : 'Not read back yet: Reconnect to read the board.',
      fb: reported ?? board.fb,
    };
  }
  if (flash.phase === 'failed') {
    return { ...base, kind: 'stopped', heading: `Firmware ${fbWords(board.fb)} (last read)`, detail: `The update of ${who} stopped. ${hardware(board.hv, id, text)}` };
  }
  return { ...base, kind: 'updating', heading: `Updating ${who}: ${fbWords(board.fb)} → ${targetWords(flash)}`, detail: `${hardware(board.hv, id, text)} · as read before the update` };
}
