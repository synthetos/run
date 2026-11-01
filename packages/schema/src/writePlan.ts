/**
 * The write-plan gate (ROADMAP P0-09; PN §12.4; SAFETY §4.6).
 *
 * Whatever builds a settings write plan (the Phase 4 planner, a profile
 * apply, a restore) passes it through `screenWritePlan` before a single line
 * is written. The gate refuses the WHOLE plan when any entry is refused: a
 * partial write leaves the board between two configurations, which is worse
 * than not writing.
 *
 * A plan that passes holds only canonical, reviewed, writable keys of the
 * dialect with valid values, and never a forbidden write: the gate validates
 * with no write context, so every conditional forbidden rule (commissioning,
 * consented normalisation) is in force.
 */
import type { SettingsSchema } from './settingsSchema.ts';
import { validate } from './validate.ts';
import type { Issue, ValidateContext } from './validate.ts';

export interface ProposedWrite {
  readonly key: string;
  readonly value: unknown;
}

export interface PlannedWrite {
  readonly key: string;
  readonly value: number;
}

export type ScreenResult =
  | { readonly ok: true; readonly writes: readonly PlannedWrite[] }
  | { readonly ok: false; readonly refused: readonly Issue[] };

export function screenWritePlan(plan: readonly ProposedWrite[], schema: SettingsSchema, ctx: ValidateContext = {}): ScreenResult {
  const draft: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const duplicates: Issue[] = [];
  for (const { key, value } of plan) {
    if (Object.hasOwn(draft, key)) {
      duplicates.push(Object.freeze({ key, code: 'duplicateKey' as const, message: `"${key}" appears more than once in the plan` }));
    }
    draft[key] = value;
  }
  const issues = [...duplicates, ...validate(draft, schema, ctx)];
  if (issues.length > 0) return Object.freeze({ ok: false, refused: Object.freeze(issues) });
  return Object.freeze({ ok: true, writes: Object.freeze(plan.map(({ key, value }) => Object.freeze({ key, value: value as number }))) });
}
