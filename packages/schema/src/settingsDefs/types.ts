/**
 * Setting definitions as data (Board settings spec §4.2). One JSON file per
 * firmware family says what every setting is called, what its values mean,
 * its unit, where it lives in the Board view, and, for the reviewed ones,
 * how it may be written (`write`, today's reviewed overlay fields).
 *
 * CODEOWNERS: the owner reviews every change to the files and this shape.
 */
import type { FactPattern, Range, Risk, TypedConfirm, Unit } from '../overlays/types.ts';

/**
 * `write`: has a reviewed `write` object; the only kind a plan may contain.
 * `read`: shown, never written. `forbidden`: shown, with the forbidden rule's
 * reason. `readout`: a live value. `reserved`: the firmware stubs it.
 */
export type SettingAccess = 'write' | 'read' | 'forbidden' | 'readout' | 'reserved';

/** Units a definition may carry: the overlay's units plus the describe-only ones. */
export type DefinitionUnit = Unit | 'none' | 'text' | 'Hz' | 'mm/min2' | 'ratio' | 'rpm' | 'ms' | 'deg/rev';

/** The unit a setting reads in when another token says its motor drives a rotary axis (`{m}tr` on A, B or C). */
export interface RotaryUnit {
  /** The token that decides (`"4ma"`). */
  readonly when: string;
  /** Its values that mean a rotary axis. */
  readonly in: readonly number[];
  readonly unit: DefinitionUnit;
}

export interface ValueDef {
  readonly value: number;
  readonly label: string;
  readonly help?: string;
}

/** Today's reviewed `OverlayEntry` fields, minus the words and the source (those are the definition's). */
export interface WriteDef {
  readonly valueType: 'integer' | 'number';
  readonly range: Range;
  readonly rangeSource: string;
  readonly hwAllowed?: readonly number[];
  readonly e158?: true;
  readonly convert: boolean;
  readonly scope: 'persisted' | 'session';
  readonly risk: Risk;
  readonly typedConfirm: TypedConfirm;
  readonly afterWrite: 'W20' | null;
  readonly invalidates: readonly FactPattern[];
  readonly whatGoesWrong: string;
}

export interface SettingDefinition {
  readonly key: string;
  /** Full plain name ("Motor 1 microsteps"). */
  readonly label: string;
  /** The name inside its group ("Microsteps" under Motor 1). */
  readonly short: string;
  readonly description: string;
  readonly unit: DefinitionUnit;
  /** Decimals to show. */
  readonly display?: number;
  /** Every allowed value by meaning (unit `enum`, or named `microsteps`). */
  readonly values?: readonly ValueDef[];
  readonly group: string;
  readonly tab: string;
  readonly access: SettingAccess;
  /** Why it is not written (read, forbidden, reserved). */
  readonly reason?: string;
  /** First build that has the token (inclusive). */
  readonly since?: number;
  /** First build that no longer has it. */
  readonly until?: number;
  /** cfgArray row: `"EN config_app.c:214"`. */
  readonly src: string;
  /** The firmware's own text-mode legend the words were taken from. */
  readonly labelSrc?: string;
  /** The bench check that must confirm a label or unit (`"BC-8"`). */
  readonly verify?: string;
  /** Where this firmware differs from another family's meaning, with a citation. */
  readonly differs?: string;
  /** A length (F_CONVERT): the board reports it in inches under G20. From the file, or from the write object. */
  readonly convert?: true;
  /** The unit it reads in on a rotary axis (describe only: writes and ranges keep `unit`). */
  readonly rotary?: RotaryUnit;
  readonly write?: WriteDef;
}

export interface InputDefinition {
  readonly id: string;
  readonly label: string;
  readonly pin: string;
  /** The token that says what the input does (`xsn`). */
  readonly function: string;
  /** The token that sets its contact type (`st`). */
  readonly contact?: string;
  /** The live-state readout (`in1`). */
  readonly state?: string;
  /** g2core: the action token (`di1ac`). */
  readonly action?: string;
  readonly note?: string;
}

export interface GroupDefinition {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
}

export interface SettingsFile {
  readonly format: 'synthetos-settings@1';
  readonly dialect: string;
  readonly firmware: { readonly family: string; readonly fb: { readonly min?: number; readonly max?: number }; readonly source: string };
  readonly mode: 'writable' | 'readOnly';
  readonly groups: readonly GroupDefinition[];
  readonly inputs: readonly InputDefinition[];
  /** Axes a probe input may be on (449 switch.c:258-280). */
  readonly probeAllowed?: readonly string[];
  readonly probeAllowedSrc?: string;
  /** How the probe contact is set: a token (`prbp`), or fixed by the firmware (449, with its citation). */
  readonly probeContact?: { readonly token?: string; readonly fixed?: string; readonly src?: string };
  /** How far homing searches when an axis's ends are equal. */
  readonly homingTravel?: { readonly rule: 'radiusFullTurn' | 'backoffOnly'; readonly src: string };
  /** Words for status-report fields that are not settings (`stat` → "Machine state"); describe only. */
  readonly statusFields?: Readonly<Record<string, string>>;
  readonly tokens: ReadonlyMap<string, SettingDefinition>;
}
