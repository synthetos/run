/**
 * Board data as the wiring package sees it (RUN_PLAN §7.3; TOOLS_PLAN §6.5).
 *
 * `WiringBoard` is the structural subset of a `synthetos-board@1` definition
 * that wiring needs. This package may not import @synthetos/schema (RUN_PLAN
 * §5.3 layering), so the web app hands it a schema `BoardDefinition`, which
 * satisfies this interface as it is.
 *
 * Electrical limits that the generated definitions do not carry (supply range,
 * driver maximum, logic supplied from Vmot) live in `BOARD_ELECTRICAL`, keyed
 * by board id, each with its source. A board with no entry gets no number:
 * the rules say "no rating known" instead of assuming one.
 */

export type Verified = 'source' | 'schematic' | 'bench' | 'hardware-repo' | 'unverified';

export interface WiringConnectorPin {
  readonly n: number;
  readonly label: string;
  readonly signal?: string;
  readonly net?: string;
}

export interface WiringBoard {
  readonly id: string;
  readonly family: 'tinyg' | 'g2core' | 'unknown';
  readonly name: string;
  readonly motors: { readonly driver?: { readonly value: string; readonly src: string; readonly verified: Verified } };
  readonly outputs: readonly { readonly id: string; readonly polarityToken?: string }[];
  readonly connectors?: readonly {
    readonly id: string;
    readonly label: string;
    readonly pins: readonly WiringConnectorPin[];
    readonly src: string;
    readonly verified: Verified;
  }[];
  readonly ratings?: readonly { readonly id: string; readonly value: string; readonly src: string; readonly verified: Verified }[];
}

export type BoardPinRole = 'input' | 'output' | 'ground' | 'logic-supply' | 'motor-supply' | 'other';

export interface BoardPinInfo {
  /** `J7.3`: connector id, dot, pin number. */
  readonly ref: string;
  readonly connector: string;
  readonly n: number;
  readonly label: string;
  readonly role: BoardPinRole;
  readonly signal?: string;
  readonly net?: string;
  /** Highest voltage the pin accepts; for a signal pin of a 3.3 V part this is 3.3. */
  readonly maxV: number;
  readonly tolerant5v: boolean;
  readonly src: string;
  readonly verified: Verified;
}

export interface SupplyRating {
  readonly min: number;
  readonly max: number;
  readonly recommend: number;
  readonly src: string;
  /** A warning above this voltage (below `max`), with its own source. */
  readonly warnAbove?: { readonly volts: number; readonly src: string };
}

export interface BoardElectrical {
  readonly supply?: SupplyRating;
  readonly logicFromVmot?: { readonly src: string };
  readonly outputDrive?: { readonly text: string; readonly src: string };
}

/** Driver ratings by part, matched against the board's `motors.driver` fact. */
export const DRIVER_RATINGS: readonly { readonly match: RegExp; readonly name: string; readonly maxA: number; readonly src: string }[] = [
  {
    match: /DRV8818/,
    name: 'TI DRV8818',
    maxA: 2.5,
    src: 'TI DRV8818 datasheet SLVSAX9G (rev. November 2025), Features and §6.1: "Up to 2.5A current per winding", subject to power dissipation and thermal limits',
  },
];

const TINYG_V8: BoardElectrical = {
  supply: {
    min: 12,
    max: 30,
    recommend: 24,
    src: 'TinyG.wiki Connecting-TinyG.md:18 (12-30 V DC, 24 V ideal); Data-Sheet---Version-8.md:20 ("maximum voltage to motors 30 volts DC")',
    warnAbove: { volts: 26, src: 'GSOT24C TVS on the motor supply; the part variant is UNVERIFIED (bench item B-TVS-1)' },
  },
  logicFromVmot: { src: 'SAFETY.md HIL-2.13: TinyG logic is powered from Vmot, so cutting Vmot stops the board' },
  outputDrive: {
    text: '3.3 V logic, a few mA',
    src: 'TinyG.wiki TinyG-Using-External-Drivers.md:18 ("very limited", "a few ma"); TinyG-Start-v6-and-Earlier.md:19 (3.3 V outputs); exact high level UNVERIFIED (B-J6-1)',
  },
};

export const BOARD_ELECTRICAL: Readonly<Record<string, BoardElectrical>> = Object.freeze({
  'tinyg-v8@8': TINYG_V8,
});

export function boardElectrical(board: WiringBoard): BoardElectrical {
  return BOARD_ELECTRICAL[board.id] ?? {};
}

export function driverRating(board: WiringBoard): (typeof DRIVER_RATINGS)[number] | undefined {
  const d = board.motors.driver?.value;
  return d === undefined ? undefined : DRIVER_RATINGS.find((r) => r.match.test(d));
}

const LOGIC_ASSUMED = 'no logic-level rating in the board data: treated as a 3.3 V input that is not 5 V tolerant';

/** Every connector pin of the board with its role and level. */
export function boardPins(board: WiringBoard): readonly BoardPinInfo[] {
  const logic = board.ratings?.find((r) => r.id === 'logicLevel');
  const levelSrc = logic?.src ?? LOGIC_ASSUMED;
  const levelVerified: Verified = logic?.verified ?? 'unverified';
  const out: BoardPinInfo[] = [];
  for (const c of board.connectors ?? []) {
    for (const p of c.pins) {
      const role: BoardPinRole =
        p.signal?.startsWith('in.') === true
          ? 'input'
          : p.signal?.startsWith('out.') === true
            ? 'output'
            : p.net === 'GND'
              ? 'ground'
              : p.net === '3V3'
                ? 'logic-supply'
                : p.net === 'VMOT'
                  ? 'motor-supply'
                  : 'other';
      const signalPin = role === 'input' || role === 'output' || role === 'logic-supply';
      out.push({
        ref: `${c.id}.${p.n}`,
        connector: c.id,
        n: p.n,
        label: p.label,
        role,
        ...(p.signal === undefined ? {} : { signal: p.signal }),
        ...(p.net === undefined ? {} : { net: p.net }),
        maxV: role === 'motor-supply' ? (boardElectrical(board).supply?.max ?? 0) : signalPin ? 3.3 : 0,
        tolerant5v: false,
        src: signalPin ? levelSrc : c.src,
        verified: signalPin ? levelVerified : c.verified,
      });
    }
  }
  return out;
}

/**
 * Arduino Due + gShield v5, diagram only (RUN_PLAN §7.3; TOOLS_PLAN §6.5;
 * old P1-16). Only the facts the rules use: the Due pins g2 drives as outputs
 * on this board and the Due's 3.3 V, not 5 V tolerant, pins. Generated g2
 * board data arrives with TB-05a's g2 reader in Phase 7; until a reviewer
 * signs it off every pin here is `unverified`.
 */
export const ARDUINO_DUE_GSHIELD: WiringBoard = {
  id: 'arduino-due-gshield@v5',
  family: 'g2core',
  name: 'Arduino Due + gShield v5 (diagram only)',
  motors: {},
  outputs: [{ id: 'spindleEnable', polarityToken: 'spep' }],
  connectors: [
    {
      id: 'D',
      label: 'Due digital header',
      pins: [
        { n: 9, label: 'D9', signal: 'out.g2-output-d9' },
        { n: 10, label: 'D10', signal: 'out.g2-output-d10' },
        { n: 12, label: 'D12 (spindle enable)', signal: 'out.spindleEnable' },
        { n: 0, label: 'GND', net: 'GND' },
      ],
      src: 'g2core board/ArduinoDue/gShield-pinout.h:133-208 (D12 spindle enable :206); D9/D10 per TOOLS_PLAN §6.5, function per pin not yet reviewed',
      verified: 'unverified',
    },
  ],
  ratings: [
    {
      id: 'logicLevel',
      value: '3.3 V: every Arduino Due pin is 3.3 V and not 5 V tolerant',
      src: 'Arduino Due documentation (3.3 V I/O, not 5 V tolerant); review pending (old P1-16)',
      verified: 'unverified',
    },
  ],
};
