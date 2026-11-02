/**
 * Built-in seed data (MACHINING_ASSISTANT §1 principle 4, §3): every number
 * names a source or is flagged `placeholder: true`, and no placeholder can
 * be read as advice without its flag.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MATERIALS,
  BUILTIN_TOOL_MATERIALS,
  BUILTIN_TOOL_TYPES,
  DEFAULT_PLACEHOLDER_NOTE,
  SEED_PLACEHOLDER_NOTE,
  TOOL_MATERIALS,
  TOOL_TYPES,
  builtinMaterial,
  citationText,
  isPlaceholder,
  readMaterial,
  toAdvice,
  toolTypeSpec,
  userValue,
  type Sourced,
} from '../src/index.ts';

type Found = { path: string; owner: Record<string, unknown> | null };

/**
 * Every number in a value, with the nearest enclosing object that carries a
 * `source` or a `placeholder` (the Sourced wrapper it belongs to), skipping
 * record versions.
 */
function numbers(value: unknown, path = '', owner: Record<string, unknown> | null = null): Found[] {
  if (typeof value === 'number') return [{ path, owner }];
  if (typeof value !== 'object' || value === null) return [];
  const here = !Array.isArray(value) && ('source' in value || 'placeholder' in value) ? (value as Record<string, unknown>) : owner;
  return Object.entries(value).flatMap(([k, v]) => (k === 'version' ? [] : numbers(v, `${path}/${k}`, here)));
}

const SEED = { materials: BUILTIN_MATERIALS, toolTypes: BUILTIN_TOOL_TYPES, toolMaterials: BUILTIN_TOOL_MATERIALS };

describe('seed provenance', () => {
  it('every number in the seed data names a source or is flagged placeholder: true', () => {
    const found = numbers(SEED);
    expect(found.length).toBeGreaterThan(100);
    for (const { path, owner } of found) {
      expect(owner, `${path} is a bare number`).not.toBeNull();
      const cited = owner !== null && 'source' in owner;
      const flagged = owner !== null && owner['placeholder'] === true;
      expect(cited !== flagged, `${path} must be cited or flagged, exactly one`).toBe(true);
    }
  });

  it('today every seed number is a placeholder that says what it waits for (§10.5)', () => {
    for (const { owner } of numbers(SEED)) {
      expect(owner?.['placeholder']).toBe(true);
      expect(owner?.['note']).toBe(SEED_PLACEHOLDER_NOTE);
    }
  });

  it('no placeholder can be read as advice without its flag', () => {
    const wrappers = new Set(numbers(SEED).map((f) => f.owner as unknown as Sourced<unknown>));
    for (const w of wrappers) {
      const advice = toAdvice(w);
      expect(advice.value).toBe(w.value);
      if (isPlaceholder(w)) {
        expect(advice).toMatchObject({ placeholder: true });
        expect(advice.placeholder && advice.note.length > 0).toBe(true);
      } else {
        expect(advice).toMatchObject({ placeholder: false, source: w.source });
      }
      expect(Object.isFrozen(advice)).toBe(true);
    }
  });

  it('the seed is frozen', () => {
    expect(Object.isFrozen(BUILTIN_MATERIALS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_MATERIALS[0]?.cutting[0]?.vc)).toBe(true);
    expect(Object.isFrozen(BUILTIN_TOOL_TYPES[0])).toBe(true);
    expect(Object.isFrozen(BUILTIN_TOOL_MATERIALS.carbide.youngsModulusGPa)).toBe(true);
  });
});

describe('built-in materials', () => {
  it('are valid records with unique built-in ids at version 1', () => {
    const ids = BUILTIN_MATERIALS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of BUILTIN_MATERIALS) {
      const r = readMaterial(m);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(m.id).toMatch(/^builtin\./);
      expect(m.version).toBe(1);
    }
    expect(builtinMaterial('builtin.al-6061')?.name).toBe('Aluminium 6061-T6');
    expect(builtinMaterial('nope')).toBeUndefined();
  });

  it('PVC carries a do-not-machine safety note and no cutting data', () => {
    const pvc = builtinMaterial('builtin.pvc');
    expect(pvc?.safety).toEqual([{ severity: 'do-not-machine', text: expect.stringMatching(/^Do not machine PVC: it releases corrosive, toxic gas/) }]);
    expect(pvc?.cutting).toEqual([]);
  });

  it('dust hazards and the aluminium coolant need are recorded (§3 examples)', () => {
    for (const id of ['builtin.mdf', 'builtin.g10-fr4', 'builtin.hardwood']) {
      expect(builtinMaterial(id)?.safety.some((s) => s.severity === 'hazard' && /dust/i.test(s.text))).toBe(true);
    }
    expect(builtinMaterial('builtin.al-6061')?.coolant).toEqual({ need: 'required', reason: 'Aluminium welds to the flutes without air or mist.' });
    expect(builtinMaterial('builtin.acrylic-cast')?.behaviour[0]?.kind).toBe('melts');
  });

  it('offers no magnesium (fire, §3)', () => {
    expect(BUILTIN_MATERIALS.some((m) => /magnesium/i.test(`${m.name} ${m.grade}`))).toBe(false);
  });
});

describe('tool types and tool materials', () => {
  it('cover every tool type and tool material', () => {
    expect(BUILTIN_TOOL_TYPES.map((t) => t.type)).toEqual([...TOOL_TYPES]);
    for (const type of TOOL_TYPES) expect(toolTypeSpec(type).type).toBe(type);
    expect(Object.keys(BUILTIN_TOOL_MATERIALS).sort()).toEqual([...TOOL_MATERIALS].sort());
  });
});

describe('sourced values', () => {
  it('toAdvice gives a placeholder without a note the default note', () => {
    expect(toAdvice({ value: 1, placeholder: true })).toEqual({ value: 1, placeholder: true, note: DEFAULT_PLACEHOLDER_NOTE });
  });

  it('userValue cites the user, and citationText joins the parts it has', () => {
    const v = userValue(0.05);
    expect(v).toEqual({ value: 0.05, source: { kind: 'user', title: 'Entered by the user' } });
    expect(isPlaceholder(v)).toBe(false);
    expect(toAdvice(v)).toEqual({ value: 0.05, placeholder: false, source: v.source });
    expect(citationText(v.source)).toBe('Entered by the user');
    expect(citationText({ kind: 'handbook', title: 'Handbook', version: '31st ed.', locator: 'p. 1042' })).toBe('Handbook, 31st ed., p. 1042');
  });
});
