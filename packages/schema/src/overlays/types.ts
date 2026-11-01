/**
 * The hand overlay's vocabulary (ROADMAP P0-09; RUN_PLAN §7.2; SAFETY §4.6).
 *
 * The vendored table says what a key IS (group, type, persisted). The overlay
 * says what it MEANS and how dangerous it is: label, description, unit,
 * range, risk class, the typed confirmation it needs, which commissioning
 * facts a write invalidates, what goes wrong, and where in the firmware it is
 * defined. Only keys with an overlay entry can be validated or written.
 */

export type Unit =
  | 'mm'
  | 'mm/min'
  | 'mm/rev'
  | 'deg'
  | 'deg/min'
  | 'deg/step'
  /** Jerk, in millions: `5000` means 5 000 000 000 mm/min³ (EN canonical_machine.c:2830). */
  | 'Mmm/min3'
  | 'Mdeg/min3'
  | 'microsteps'
  | 's'
  /** An enumerated code; see `values`. */
  | 'enum';

/**
 * Risk class (SAFETY §4.6, RUN_PLAN §7.2). `polarity` is its own class: the
 * EN keys `spep`, `spdp` and `prbp` can turn an output or the probe on when
 * the app believes it is off (SAFETY H11).
 */
export type Risk = 'low' | 'medium' | 'high' | 'polarity';

/** When the write pipeline requires the typed C5 confirmation (SAFETY §4.6). */
export type TypedConfirm =
  | { readonly kind: 'always' }
  | { readonly kind: 'never' }
  /** Only when the new value is this one (`sl=0`). */
  | { readonly kind: 'whenValue'; readonly value: number }
  /** Only when the new value is at least `factor` times the old one (jerk or velocity ×2). */
  | { readonly kind: 'increaseFactor'; readonly factor: number };

/**
 * A commissioning fact a write invalidates (TOOLS_PLAN §5.2 rules, SAFETY
 * H28/H38): `<root>`, `<root>.<axis>`, `<root>.*` or `job.*.preflight`.
 */
export type FactPattern = string;

/** The roots a fact pattern may start with. */
export const FACT_ROOTS = Object.freeze(['config', 'motor', 'dir', 'scale', 'switch', 'outputs', 'homing', 'softlimits', 'job', 'probe'] as const);

export interface Range {
  readonly min: number;
  readonly max: number;
  /** `min` itself is refused (a value must be greater than `min`). */
  readonly minExclusive?: true;
}

export interface EnumValue {
  readonly value: number;
  readonly label: string;
}

/** Where the key is defined: a cfgArray row at the pinned commit. */
export interface SourceRef {
  readonly tag: 'EN';
  readonly file: string;
  readonly line: number;
}

export interface OverlayEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly unit: Unit;
  /** `integer` values must be whole numbers. Every value is a finite JSON number. */
  readonly valueType: 'integer' | 'number';
  readonly range: Range;
  /** Why the range is what it is: a firmware citation, or `host:` and the host policy. */
  readonly rangeSource: string;
  /** Enumerated values; a value outside them is refused. */
  readonly values?: readonly EnumValue[];
  /** Values the hardware supports (TinyG microsteps 1, 2, 4, 8). */
  readonly hwAllowed?: readonly number[];
  /** The firmware refuses zero and negative values with status 108 (E158). */
  readonly e158?: true;
  /** `F_CONVERT`: the firmware reads and reports it in inches under G20 (cited to the cfgArray row). Written only under G21 (SAFETY §4.6 step 5). */
  readonly convert: boolean;
  /** `session` keys are not persisted (`os`). */
  readonly scope: 'persisted' | 'session';
  readonly risk: Risk;
  readonly typedConfirm: TypedConfirm;
  /** Show W20 after writing this key, until commissioning runs (SAFETY §4.6 step 9). */
  readonly afterWrite: 'W20' | null;
  readonly invalidates: readonly FactPattern[];
  readonly whatGoesWrong: string;
  readonly src: SourceRef;
}
