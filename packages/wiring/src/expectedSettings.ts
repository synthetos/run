/**
 * Advisory "expected settings" from the wiring (RUN_PLAN §7.3; TOOLS_PLAN
 * §6.5 "Coupling to config"; old P1-10).
 *
 * Advisory only: the editor offers each key with its own accept, never an
 * "apply all", and keys in the polarity or switch class need a typed
 * confirmation (`keyClass`). Nothing here writes anything.
 */
import { boardPins, type WiringBoard } from './board.ts';
import { Netlist, type Diagram, type Part } from './diagram.ts';
import type { Dialect } from './rules.ts';

export type KeyClass = 'polarity' | 'switch' | 'other';

export interface ExpectedSetting {
  readonly key: string;
  readonly value: number;
  readonly keyClass: KeyClass;
  readonly why: string;
  readonly src: string;
}

const POLARITY = /^(spep|spdp|prbp|[1-6]po)$/;
const SWITCH = /^(st|[xyzabc]s[nx])$/;

/** The confirmation class of a firmware key (polarity and switch keys need typed confirmation). */
export function keyClass(key: string): KeyClass {
  return POLARITY.test(key) ? 'polarity' : SWITCH.test(key) ? 'switch' : 'other';
}

/** The word the user types to confirm a key of this class. */
export function confirmWord(cls: KeyClass): string | undefined {
  return cls === 'polarity' ? 'POLARITY' : cls === 'switch' ? 'SWITCH' : undefined;
}

const SRC_SN = (d: Dialect): string => (d === 'tinyg-440' ? 'TG canonical_machine.c:1976 ([0=off,1=homing,2=limit,3=limit+homing])' : 'EN canonical_machine.c:2834-2835 ([0=off,1=homing,2=limit,3=limit+homing,4=probe])');
const SRC_ST = (d: Dialect): string => (d === 'tinyg-440' ? 'TG switch.c:256 ([0=NO,1=NC])' : 'EN switch.c:357 ([0=NO,1=NC])');
const SRC_SPEP = 'EN config_app.c:1071 ([0=active_low,1=active_high])';

/** Expected settings for a TinyG board; other families get none until their key tables are wired in. */
export function expectedSettings(diagram: Diagram, board: WiringBoard, dialect: Dialect): readonly ExpectedSetting[] {
  if (board.family !== 'tinyg') return [];
  const pins = boardPins(board);
  const nl = new Netlist(diagram, pins);
  const out: ExpectedSetting[] = [];
  const switches: Part[] = [];
  for (const b of pins) {
    const m = /^in\.limit-(min|max)-([xyza])$/.exec(b.signal ?? '');
    if (m === null) continue;
    const [, end, axis] = m as unknown as [string, 'min' | 'max', string];
    const key = `${axis}${end === 'min' ? 'sn' : 'sx'}`;
    const on = diagram.parts.filter(
      (p) => (p.kind === 'switch' && nl.same(`${p.id}:sig`, `board:${b.ref}`)) || (p.kind === 'proximity' && nl.same(`${p.id}:out`, `board:${b.ref}`)),
    );
    switches.push(...on);
    out.push(
      on.length > 0
        ? { key, value: 1, keyClass: 'switch', why: `${on.map((p) => p.label || p.id).join(', ')} on ${b.label} (${b.ref}): homing (use 3 to also stop at the limit)`, src: SRC_SN(dialect) }
        : { key, value: 0, keyClass: 'switch', why: `nothing on ${b.label} (${b.ref}): off`, src: SRC_SN(dialect) },
    );
  }
  const contacts = new Set(switches.map((p) => String(p.props['contact'])));
  if (contacts.size === 1) {
    const nc = contacts.has('NC');
    out.unshift({ key: 'st', value: nc ? 1 : 0, keyClass: 'switch', why: `every switch is normally ${nc ? 'closed' : 'open'}`, src: SRC_ST(dialect) });
  }
  if (dialect === 'tinyg-en') {
    const enable = pins.find((b) => b.signal === 'out.spindleEnable');
    const token = board.outputs.find((o) => o.id === 'spindleEnable')?.polarityToken;
    if (enable !== undefined && token !== undefined) {
      const at = `board:${enable.ref}`;
      const relays = diagram.parts.filter(
        (r) =>
          r.kind === 'relay' &&
          (nl.same(`${r.id}:sig`, at) || diagram.parts.some((b) => b.kind === 'buffer' && nl.same(`${b.id}:out`, `${r.id}:sig`) && nl.same(`${b.id}:in`, at))),
      );
      const levels = new Set(relays.map((r) => r.props['activeLow'] === true));
      if (levels.size === 1) {
        const low = levels.has(true);
        out.push({ key: token, value: low ? 0 : 1, keyClass: 'polarity', why: `${relays.map((r) => r.label || r.id).join(', ')} on ${enable.label} switches on when the input is ${low ? 'low' : 'high'}`, src: SRC_SPEP });
      }
    }
  }
  return out;
}
