/**
 * Invalidation rules as data (ROADMAP TB-01; OLD TOOLS_PLAN §5.2 table;
 * SAFETY H28, H38, §4.5a, §4.8; T-S74).
 *
 * Each trigger names which facts it clears and over which facts it looks
 * (its scope). The engine in `store.ts` only interprets this table; changing
 * what a trigger clears is a change to this file, reviewed as a safety
 * change (SAFETY §8).
 *
 * A setting write clears what the key's reviewed overlay entry says
 * (`OverlayEntry.invalidates`). A key without an overlay entry, a dialect
 * without a settings schema, or a key spelt differently from its canonical
 * form clears EVERY fact on the board: a write nobody reviewed for its
 * effects is assumed to affect everything.
 */
import { FACT_ROOTS } from '../overlays/types.ts';
import type { FactPattern } from '../overlays/types.ts';
import { SETTINGS_SCHEMAS } from '../settingsSchema.ts';

/** Every root: a pattern list that clears every fact. */
export const ALL_FACTS: readonly FactPattern[] = Object.freeze([...FACT_ROOTS]);

/** Something that happened to a machine or board that can make facts untrue. */
export type FactTrigger =
  /** A flash, or any change of `fb`. */
  | { readonly kind: 'flash'; readonly boardId: string }
  /** A flash whose settings are not yet restored: also raises `defaults-active`, which blocks every fact gate (SAFETY §4.8 step 10). */
  | { readonly kind: 'flashWithoutRestore'; readonly boardId: string }
  /** The post-flash restore read back; clears `defaults-active`. */
  | { readonly kind: 'settingsRestored'; readonly boardId: string }
  /**
   * run wrote one setting and read it back. Facts the key does not affect
   * survive and are re-bound from `previousDeviceHash` to `newDeviceHash`;
   * facts bound to any other hash are left to fail the binding check.
   */
  | {
      readonly kind: 'settingWritten';
      readonly boardId: string;
      readonly dialectId: string;
      readonly key: string;
      readonly previousDeviceHash: string;
      readonly newDeviceHash: string;
    }
  /** The temporary homing-search travel write (SAFETY §4.5a), until its restore reads back. */
  | { readonly kind: 'temporaryTravelWrite'; readonly boardId: string }
  /** Work offsets, G92, G28/G30 positions or tool offsets changed, by run or by a job. */
  | { readonly kind: 'offsetsChanged'; readonly boardId: string }
  /** Reporting keys normalised: outside `deviceHash`, clears nothing (a restore record is kept elsewhere, SAFETY H24). */
  | { readonly kind: 'reportingNormalised'; readonly boardId: string }
  /** The wiring changed: facts that reference any of these part ids. */
  | { readonly kind: 'wiringChanged'; readonly machineId: string; readonly parts: readonly string[] }
  /** Connect read a `deviceHash` that differs from the facts' (changed by another program): every fact bound to another hash. */
  | { readonly kind: 'deviceHashDrift'; readonly boardId: string; readonly deviceHash: string }
  /** This board was selected for `machineId`: its facts under any other machine lose `dir`, `scale` and `homing` (H38, T-S74). */
  | { readonly kind: 'machineSelected'; readonly boardId: string; readonly machineId: string }
  /** A profile for this machine id was imported or arrived from the cloud (T-S22, H34). */
  | { readonly kind: 'profileImported'; readonly machineId: string }
  /** The user answered "yes" to "has anything changed mechanically?" (H28). */
  | { readonly kind: 'mechanicalChange'; readonly machineId: string };

export type FactTriggerKind = FactTrigger['kind'];

/**
 * Which facts a rule looks at:
 * - `board`: facts on the trigger's board (any machine);
 * - `machine`: facts of the trigger's machine (any board);
 * - `boardOtherMachines`: facts on the trigger's board under a different machine.
 */
export type RuleScope = 'board' | 'machine' | 'boardOtherMachines';

export interface InvalidationRule {
  readonly scope: RuleScope;
  /**
   * What is cleared in scope: fact patterns; `settingOverlay` (the written
   * key's overlay patterns); `referencedParts` (facts naming a changed part);
   * `otherDeviceHash` (facts bound to a hash other than the trigger's).
   */
  readonly clears: readonly FactPattern[] | 'settingOverlay' | 'referencedParts' | 'otherDeviceHash';
  readonly defaultsActive?: 'raise' | 'clear';
  readonly source: string;
}

export const INVALIDATION_RULES: Readonly<Record<FactTriggerKind, InvalidationRule>> = Object.freeze({
  flash: { scope: 'board', clears: ALL_FACTS, source: 'OLD TOOLS_PLAN §5.2 "Flash or fb change"' },
  flashWithoutRestore: { scope: 'board', clears: ALL_FACTS, defaultsActive: 'raise', source: 'OLD TOOLS_PLAN §5.2; SAFETY §4.8 step 10' },
  settingsRestored: { scope: 'board', clears: Object.freeze([]), defaultsActive: 'clear', source: 'SAFETY §4.8 (restore read back)' },
  settingWritten: { scope: 'board', clears: 'settingOverlay', source: 'OLD TOOLS_PLAN §5.2 setting rows; overlay `invalidates`' },
  temporaryTravelWrite: { scope: 'board', clears: Object.freeze(['softlimits', 'job.*.preflight']), source: 'OLD TOOLS_PLAN §5.2; SAFETY §4.5a' },
  offsetsChanged: { scope: 'board', clears: Object.freeze(['job.*.preflight']), source: 'OLD TOOLS_PLAN §5.2 offsets row' },
  reportingNormalised: { scope: 'board', clears: Object.freeze([]), source: 'OLD TOOLS_PLAN §5.2; SAFETY H24' },
  wiringChanged: { scope: 'machine', clears: 'referencedParts', source: 'OLD TOOLS_PLAN §5.2 "Wiring change touching a part"' },
  deviceHashDrift: { scope: 'board', clears: 'otherDeviceHash', source: 'OLD TOOLS_PLAN §5.2 "changed by another program"; SAFETY H33' },
  machineSelected: { scope: 'boardOtherMachines', clears: Object.freeze(['dir', 'scale', 'homing']), source: 'SAFETY H28, H38; T-S74' },
  profileImported: { scope: 'machine', clears: ALL_FACTS, source: 'OLD TOOLS_PLAN §5.1; SAFETY H34, §4.10 rule 3; T-S22' },
  mechanicalChange: { scope: 'machine', clears: Object.freeze(['dir', 'scale']), source: 'SAFETY H28 (fact age)' },
} satisfies Record<FactTriggerKind, InvalidationRule>);

/**
 * The fact patterns a write of `key` on `dialectId` clears: the reviewed
 * overlay entry's `invalidates`, or every fact when there is no reviewed
 * entry to say otherwise.
 */
export function settingInvalidates(dialectId: string, key: string): readonly FactPattern[] {
  const schema = Object.hasOwn(SETTINGS_SCHEMAS, dialectId) ? SETTINGS_SCHEMAS[dialectId as keyof typeof SETTINGS_SCHEMAS] : undefined;
  const overlay = schema?.settings.get(key)?.overlay;
  return overlay === undefined ? ALL_FACTS : overlay.invalidates;
}
