/**
 * MACHINING_ASSISTANT §1 principle 4: nothing marked as a placeholder ships
 * as advice. For every built-in material, tool type and frame class, any
 * result computed from a placeholder carries the flag, through the rules
 * model, the rules engine and the guard; and fully cited inputs do not.
 */
import { BUILTIN_MATERIALS, TOOL_TYPES, TOOL_TYPE_GEOMETRY, FRAME_CLASSES, type Tool } from '@synthetos/library';
import { describe, expect, it } from 'vitest';
import { GuardedEngine, RulesEngine, planOperation, type AdvisorContext } from '../src/index.ts';
import { context, machine, tool } from './fixtures.ts';

const EXTRA = { cornerRadius: 0.5, vAngle: 60, tipWidth: 0.1, pointAngle: 118 } as const;

function toolOfType(type: (typeof TOOL_TYPES)[number]): Tool {
  const spec = TOOL_TYPE_GEOMETRY[type];
  const geometry: Record<string, number> = { diameter: 3.175, shank: 3.175, flutes: 2, fluteLength: 12, overallLength: 38, stickout: 18 };
  for (const f of [...spec.required, ...spec.optional]) geometry[f] = EXTRA[f];
  return tool({ type, geometry });
}

function seedContexts(): AdvisorContext[] {
  const out: AdvisorContext[] = [];
  for (const material of BUILTIN_MATERIALS) {
    for (const type of TOOL_TYPES) {
      for (const frameClass of FRAME_CLASSES) {
        const { model: _m, ...ctx } = context({
          material,
          tool: toolOfType(type),
          machine: machine({ frameClass }),
          operation: { kind: type === 'drill' ? 'drill' : 'pocket', ap: 0.5, ae: type === 'drill' ? 3.175 : 0.6, programmed: { feed: 800, rpm: 18_000 } },
        });
        out.push(ctx);
      }
    }
  }
  return out;
}

describe('no placeholder is returned as advice without its flag', () => {
  it('the rules model flags every plan built from the seed data, and lists the placeholder inputs', () => {
    let planned = 0;
    for (const ctx of seedContexts()) {
      const p = planOperation(ctx);
      if (!p.ok) {
        expect(['do-not-machine', 'no-cutting-data']).toContain(p.refusal);
        continue;
      }
      planned++;
      expect(p.provenance.placeholder).toBe(true);
      expect(p.provenance.placeholderInputs.length).toBeGreaterThan(0);
    }
    expect(planned).toBeGreaterThan(200);
  });

  it('every recommendation the rules engine returns through the guard carries the flag and says so', async () => {
    const g = new GuardedEngine(new RulesEngine());
    let count = 0;
    for (const ctx of seedContexts()) {
      for (const rec of (await g.plan(ctx)).recommendations) {
        count++;
        expect(rec.placeholder).toBe(true);
        expect(rec.reasons.some((r) => r.startsWith('Placeholder data ('))).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(600);
  });

  it('fully cited inputs give recommendations without the flag', async () => {
    const recs = (await new GuardedEngine(new RulesEngine()).plan(context())).recommendations;
    expect(recs).toHaveLength(3);
    expect(recs.every((r) => !r.placeholder && !r.reasons.some((x) => x.startsWith('Placeholder data')))).toBe(true);
  });

  it('PVC is refused for every tool type and frame class', () => {
    for (const ctx of seedContexts().filter((c) => c.material.id === 'builtin.pvc')) {
      expect(planOperation(ctx)).toMatchObject({ ok: false, refusal: 'do-not-machine' });
    }
  });
});
