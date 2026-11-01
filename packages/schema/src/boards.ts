/**
 * Board definitions and board selection (ROADMAP P0-08; RUN_PLAN §5.1 rule 6).
 *
 * A board definition says what hardware a controller board has (motors,
 * inputs, outputs, ADC, USB identity, flasher), each fact with its source.
 * The UI shows only what the detected board's definition lists.
 *
 * `selectBoard` picks the definition from what the firmware reports (`hp`,
 * `hv`) and the family the capability probe decided. When the board is not
 * known exactly it never guesses: the result is a "common subset" that is a
 * lower bound of the real board, so the UI can never offer an output the
 * board does not have.
 * - ambiguous (several definitions match): the intersection of the matches;
 *   the board is one of them, so everything in the intersection exists.
 * - unknown (no definition matches, or no family): nothing is known about the
 *   hardware, so the subset is empty: no motors, inputs, outputs or ADC, no
 *   USB identity claim, and no flasher.
 *
 * The generator that writes definitions from the firmware repositories is
 * TB-05a; this module only defines and selects them.
 */
import schemaJson from '../boards.schema.json' with { type: 'json' };
import { validateSchema } from './jsonSchema.ts';
import type { Schema, SchemaError } from './jsonSchema.ts';

export const BOARD_SCHEMA: Schema = schemaJson as Schema;

export type Verified = 'source' | 'bench' | 'hardware-repo' | 'unverified';

export interface Fact<T> {
  readonly value: T;
  readonly src: string;
  readonly verified: Verified;
}

export type OutputId = 'spindleEnable' | 'spindleDirection' | 'spindlePwm' | 'coolant' | 'coolantMist' | 'coolantFlood';

export interface BoardOutput {
  readonly id: OutputId;
  readonly polarityToken?: string;
  readonly note?: string;
  readonly src: string;
  readonly verified: Verified;
}

export interface BoardDefinition {
  readonly format: 'synthetos-board@1';
  readonly id: string;
  /** `unknown` only on a common subset for an unclassified board. */
  readonly family: 'tinyg' | 'g2core' | 'unknown';
  readonly name: string;
  readonly match: { readonly hp: number | string; readonly hv: readonly (number | string)[] };
  readonly source: { readonly kind: 'fixture' | 'generated' | 'commonSubset'; readonly firmware: string; readonly note: string };
  readonly motors: {
    readonly count: Fact<number>;
    readonly driver?: Fact<string>;
    readonly microsteps: Fact<readonly number[]>;
    readonly currentSetting: Fact<'board' | 'firmware' | 'unknown'>;
  };
  readonly inputs: { readonly count: Fact<number>; readonly functions: Fact<readonly string[]>; readonly typeSetting?: Fact<string> };
  readonly outputs: readonly BoardOutput[];
  readonly adc: readonly { readonly id: string; readonly src: string; readonly verified: Verified }[];
  readonly usb: readonly {
    readonly vendorId: number;
    readonly productId: number;
    readonly role: 'control' | 'bootloader' | 'refuse';
    readonly src: string;
    readonly verified: Verified;
  }[];
  readonly flasher: Fact<'xboot-avr109' | 'sam-ba-bossa' | 'none'>;
  readonly defaults: Fact<string>;
  readonly buildFlags: readonly string[];
}

export type ParsedBoard = { readonly ok: true; readonly board: BoardDefinition } | { readonly ok: false; readonly errors: readonly SchemaError[] };

/** Validate untrusted JSON as a board definition. The result is frozen. */
export function parseBoardDefinition(json: unknown): ParsedBoard {
  const errors = validateSchema(BOARD_SCHEMA, json);
  if (errors.length > 0) return { ok: false, errors };
  // A JSON round trip copies the validated value, so the caller's object is never frozen or shared.
  return { ok: true, board: deepFreeze(JSON.parse(JSON.stringify(json)) as BoardDefinition) };
}

/** What the firmware and the classifier say about the connected board. */
export interface BoardIdentity {
  /** From the classified dialect; null when the board is unclassified. */
  readonly family: 'tinyg' | 'g2core' | null;
  readonly hp?: number | string;
  readonly hv?: number | string;
}

export type BoardSelection =
  | { readonly kind: 'exact'; readonly board: BoardDefinition }
  | {
      readonly kind: 'commonSubset';
      readonly board: BoardDefinition;
      readonly reason: 'unknown' | 'ambiguous';
      /** Ids of the definitions the subset was taken from (empty when unknown). */
      readonly candidates: readonly string[];
    };

/** Pick the board definition for a connected board. Never guesses (see the module comment). */
export function selectBoard(identity: BoardIdentity, definitions: readonly BoardDefinition[]): BoardSelection {
  const { family, hp, hv } = identity;
  const matches =
    family === null || hp === undefined || hv === undefined
      ? []
      : definitions.filter((d) => d.family === family && d.match.hp === hp && d.match.hv.includes(hv));
  if (matches.length === 1) return { kind: 'exact', board: matches[0] as BoardDefinition };
  if (matches.length > 1) {
    return { kind: 'commonSubset', board: commonSubset(family, matches), reason: 'ambiguous', candidates: matches.map((d) => d.id) };
  }
  return { kind: 'commonSubset', board: commonSubset(family, []), reason: 'unknown', candidates: [] };
}

/**
 * The hardware every candidate has: the smallest motor and input counts, the
 * microstep values all support, the outputs and ADC channels present on all
 * (keeping a polarity token only where all agree). No USB identity and no
 * flasher are claimed for a board that is not known exactly.
 */
export function commonSubset(family: 'tinyg' | 'g2core' | null, candidates: readonly BoardDefinition[]): BoardDefinition {
  const ids = candidates.map((d) => d.id);
  const src = candidates.length === 0 ? 'no matching definition: nothing is assumed' : `common subset of ${ids.join(', ')}`;
  const fact = <T>(value: T): Fact<T> => ({ value, src, verified: 'unverified' });
  const min = (values: number[]) => (values.length === 0 ? 0 : Math.min(...values));
  const everywhere = <T>(lists: (readonly T[])[], same: (a: T, b: T) => boolean): T[] =>
    lists.length === 0 ? [] : (lists[0] as readonly T[]).filter((x) => lists.every((l) => l.some((y) => same(x, y))));

  const microsteps = everywhere(
    candidates.map((d) => d.motors.microsteps.value),
    (a, b) => a === b,
  );
  const functions = everywhere(
    candidates.map((d) => d.inputs.functions.value),
    (a, b) => a === b,
  );
  const outputs = everywhere(
    candidates.map((d) => d.outputs),
    (a, b) => a.id === b.id,
  ).map((o): BoardOutput => {
    const tokens = new Set(candidates.map((d) => d.outputs.find((x) => x.id === o.id)?.polarityToken));
    const token = tokens.size === 1 ? [...tokens][0] : undefined;
    return { id: o.id, ...(token === undefined ? {} : { polarityToken: token }), src, verified: 'unverified' };
  });
  const adc = everywhere(
    candidates.map((d) => d.adc),
    (a, b) => a.id === b.id,
  ).map((a) => ({ id: a.id, src, verified: 'unverified' as const }));

  return deepFreeze<BoardDefinition>({
    format: 'synthetos-board@1',
    id: `${family ?? 'unknown'}-common-subset@none`,
    family: family ?? 'unknown',
    name: candidates.length === 0 ? 'Unknown board' : `Unknown revision (${ids.join(' or ')})`,
    match: { hp: 'none', hv: ['none'] },
    source: { kind: 'commonSubset', firmware: 'none', note: src },
    motors: {
      count: fact(min(candidates.map((d) => d.motors.count.value))),
      microsteps: fact(microsteps),
      currentSetting: fact('unknown'),
    },
    inputs: { count: fact(min(candidates.map((d) => d.inputs.count.value))), functions: fact(functions) },
    outputs,
    adc,
    usb: [],
    flasher: fact('none'),
    defaults: fact('none'),
    buildFlags: [],
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
