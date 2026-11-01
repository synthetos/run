/**
 * The write-plan gate (ROADMAP P0-09 acceptance: "Forbidden keys can never
 * appear in a write plan (fast-check against a stub planner)"; PN §12.4).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_WRITES, SETTINGS_SCHEMAS, TINYG_EN_OVERLAY, isForbiddenKey, screenWritePlan } from '../src/index.ts';
import type { ProposedWrite, SettingsSchema, TinyGDialectId } from '../src/index.ts';

const EN = SETTINGS_SCHEMAS['tinyg-en'];
const IDS = Object.keys(SETTINGS_SCHEMAS) as TinyGDialectId[];

/**
 * A stand-in for the Phase 4 planner: it proposes every draft key whose value
 * differs from the board, in draft order, and hands the plan to the gate. It
 * does no filtering of its own, so anything forbidden that comes out would be
 * the gate's fault.
 */
function stubPlanner(draft: Readonly<Record<string, unknown>>, board: Readonly<Record<string, unknown>>, schema: SettingsSchema) {
  const plan: ProposedWrite[] = Object.keys(draft)
    .filter((k) => !Object.is(draft[k], board[k]))
    .map((key) => ({ key, value: draft[key] }));
  return { plan, result: screenWritePlan(plan, schema) };
}

const FORBIDDEN_KEYS = [...new Set(IDS.flatMap((id) => [...FORBIDDEN_WRITES[id].tokens.keys()])), 'jogx', 'jog', 'joga'];
const keyArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...FORBIDDEN_KEYS) },
  { weight: 3, arbitrary: fc.constantFrom(...FORBIDDEN_KEYS).map((k) => k.toUpperCase()) },
  { weight: 4, arbitrary: fc.constantFrom(...TINYG_EN_OVERLAY.map((o) => o.key)) },
  { weight: 2, arbitrary: fc.constantFrom(...[...EN.table.tokens.keys()]) },
  { weight: 1, arbitrary: fc.string({ maxLength: 6 }) },
);
const valueArb = fc.oneof(
  fc.integer({ min: -10, max: 10 }),
  fc.double({ noNaN: false }),
  fc.constantFrom(0, 1, 2, 4, 8, 1000, 5000),
  fc.constant('1'),
  fc.boolean(),
  fc.constant(null),
);
const draftArb = fc.dictionary(keyArb, valueArb, { maxKeys: 8 });

describe('forbidden keys never appear in a write plan', () => {
  it('fast-check: whatever the draft, an accepted plan holds no forbidden key and only reviewed keys', () => {
    fc.assert(
      fc.property(fc.constantFrom(...IDS), draftArb, draftArb, (id, draft, board) => {
        const schema = SETTINGS_SCHEMAS[id];
        const { plan, result } = stubPlanner(draft, board, schema);
        if (result.ok) {
          for (const w of result.writes) {
            expect(isForbiddenKey(schema.forbidden, w.key), w.key).toBe(false);
            expect(schema.settings.get(w.key)?.overlay, w.key).toBeDefined();
            expect(Number.isFinite(w.value)).toBe(true);
          }
          expect(result.writes.map((w) => w.key)).toEqual(plan.map((w) => w.key));
        }
        if (plan.some((w) => isForbiddenKey(schema.forbidden, w.key))) expect(result.ok).toBe(false);
        if (schema.mode === 'readOnly' && plan.length > 0) expect(result.ok).toBe(false);
      }),
      { numRuns: 3000 },
    );
  });

  it('a forbidden key is refused as forbidden, and takes the whole plan down with it', () => {
    const result = screenWritePlan(
      [
        { key: 'xvm', value: 12000 },
        { key: 'hv', value: 8 },
        { key: '1mi', value: 8 },
      ],
      EN,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refused.map((i) => [i.key, i.code])).toEqual([['hv', 'forbidden']]);
  });

  it('every PN §12.4 key is refused as forbidden in a plan, including the conditional ones (no context is ever applied)', () => {
    for (const key of ['hv', 'baud', 'ex', 'ej', 'rxm', 'defa', 'boot', 'test', 'me', 'md', 'rx', 'jogz', 'se12', 'fd', 'jv', 'qv']) {
      const result = screenWritePlan([{ key, value: 1 }], EN);
      expect(result.ok, key).toBe(false);
      if (!result.ok) expect(result.refused[0]?.code, key).toBe('forbidden');
    }
    const js0 = screenWritePlan([{ key: 'js', value: 0 }], EN);
    expect(!js0.ok && js0.refused[0]?.code).toBe('forbidden');
  });
});

describe('screenWritePlan', () => {
  it('passes a valid plan unchanged and frozen', () => {
    const result = screenWritePlan(
      [
        { key: 'xvm', value: 12000 },
        { key: '1mi', value: 8 },
        { key: 'spep', value: 0 },
      ],
      EN,
    );
    expect(result).toEqual({
      ok: true,
      writes: [
        { key: 'xvm', value: 12000 },
        { key: '1mi', value: 8 },
        { key: 'spep', value: 0 },
      ],
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.writes) && Object.isFrozen(result.writes[0])).toBe(true);
  });

  it('refuses a key planned twice', () => {
    const result = screenWritePlan(
      [
        { key: 'xvm', value: 12000 },
        { key: 'xvm', value: 1 },
      ],
      EN,
    );
    expect(!result.ok && result.refused.map((i) => [i.key, i.code])).toEqual([['xvm', 'duplicateKey']]);
  });

  it('applies the cross-key rules with the board values', () => {
    const result = screenWritePlan([{ key: 'xtm', value: -10 }], EN, { base: { xtn: 0 } });
    expect(!result.ok && result.refused.map((i) => i.code)).toEqual(['travelOrder']);
  });

  it('refuses everything on stock 449 and every unreviewed 440 key', () => {
    const s449 = screenWritePlan([{ key: 'xvm', value: 1000 }], SETTINGS_SCHEMAS['tinyg-449-stock']);
    expect(!s449.ok && s449.refused[0]?.code).toBe('readOnlyDialect');
    const tg = screenWritePlan([{ key: 'xvm', value: 1000 }], SETTINGS_SCHEMAS['tinyg-440']);
    expect(!tg.ok && tg.refused[0]?.code).toBe('notReviewed');
  });

  it('a key named like an Object.prototype member is just an unknown key', () => {
    const result = screenWritePlan([{ key: '__proto__', value: 1 }, { key: 'constructor', value: 1 }], EN);
    expect(!result.ok && result.refused.map((i) => i.code)).toEqual(['unknownKey', 'unknownKey']);
  });

  it('an empty plan is an empty, accepted plan', () => {
    expect(screenWritePlan([], EN)).toEqual({ ok: true, writes: [] });
  });
});
