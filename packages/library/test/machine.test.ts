import { describe, expect, it } from 'vitest';
import { COOLANT_KINDS, readMachine } from '../src/index.ts';
import { AT, bed, holeGrid, machine } from './recordFixtures.ts';

const paths = (value: unknown): string[] => {
  const r = readMachine(value);
  return r.ok ? [] : r.issues.map((i) => i.path);
};

describe('readMachine', () => {
  it('accepts a complete profile, frozen and detached, and the smallest one', () => {
    const value = machine();
    const r = readMachine(value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(value);
      expect(Object.isFrozen(r.value.travel)).toBe(true);
      expect(r.value).not.toBe(value);
    }
    // The Machines view saves a cleared spindle description as ''.
    expect(readMachine({ id: 'm', name: 'M', templateId: 't', drive: 'any', travel: { x: 1, y: 1, z: 1 }, spindle: '', createdAt: AT }).ok).toBe(true);
  });

  it('what is wired to the coolant output: optional, one of the four words (owner, 2026-11-18, picture 152)', () => {
    expect(COOLANT_KINDS).toEqual(['none', 'air', 'mist', 'flood']);
    for (const coolant of COOLANT_KINDS) expect(readMachine({ ...machine(), coolant }).ok, coolant).toBe(true);
    // Records from before the field read as before.
    expect(readMachine(machine()).ok).toBe(true);
    expect(paths({ ...machine(), coolant: 'water' })).toEqual(['/coolant']);
    expect(paths({ ...machine(), coolant: null })).toEqual(['/coolant']);
  });

  it('refuses anything but an object with known fields', () => {
    expect(paths(null)).toEqual(['']);
    expect(paths([])).toEqual(['']);
    expect(paths(machine({ homed: true }))).toEqual(['/homed']);
  });

  it('checks every head field', () => {
    expect(paths(machine({ id: '' }))).toEqual(['/id']);
    expect(paths(machine({ name: 3 }))).toEqual(['/name']);
    expect(paths(machine({ templateId: undefined }))).toEqual(['/templateId']);
    expect(paths(machine({ spindle: null }))).toEqual(['/spindle']);
    expect(paths(machine({ drive: 'chain' }))).toEqual(['/drive']);
    for (const travel of [null, { x: 0, y: 1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1 }, { x: 1, y: 1, z: 'tall' }]) expect(paths(machine({ travel }))).toEqual(['/travel']);
    expect(paths(machine({ createdAt: 'yesterday' }))).toEqual(['/createdAt']);
    expect(paths(machine({ revision: 0 }))).toEqual(['/revision']);
    expect(paths(machine({ revision: 1.5 }))).toEqual(['/revision']);
    expect(paths(machine({ revision: undefined })).length).toBe(0);
    expect(paths(machine({ switchType: 2 }))).toEqual(['/switchType']);
    expect(paths(machine({ switchType: 1 }))).toEqual([]);
    expect(paths(machine({ homeFrame: 'middle' }))).toEqual(['/homeFrame']);
    expect(paths(machine({ homeFrame: undefined }))).toEqual([]);
    // The board the machine is bound to (first-run design §6.3 step 2): optional, short text.
    expect(paths(machine({ boardId: '2X3559-ABCD' }))).toEqual([]);
    expect(paths(machine({ boardId: '' }))).toEqual(['/boardId']);
    expect(paths(machine({ boardId: 'x'.repeat(65) }))).toEqual(['/boardId']);
    expect(paths(machine({ boardId: 7 }))).toEqual(['/boardId']);
  });

  it('checks the axes', () => {
    expect(paths(machine({ axes: undefined }))).toEqual([]);
    expect(paths(machine({ axes: 'x' }))).toEqual(['/axes']);
    expect(paths(machine({ axes: { b: { jerk: 1 } } }))).toEqual(['/axes/b']);
    expect(paths(machine({ axes: { x: 7 } }))).toEqual(['/axes/x']);
    expect(paths(machine({ axes: { x: { feed: 1 } } }))).toEqual(['/axes/x']);
    expect(paths(machine({ axes: { x: { jerk: 'fast' } } }))).toEqual(['/axes/x']);
    expect(paths(machine({ axes: { a: {} } }))).toEqual([]);
  });

  it('reports every problem at once', () => {
    expect(paths(machine({ id: '', drive: 'x', axes: 1, bed: 1 }))).toEqual(['/id', '/drive', '/axes', '/bed']);
  });
});

describe('readMachine: the bed', () => {
  it('checks the bed and its hole grid', () => {
    expect(paths(machine({ bed: undefined }))).toEqual([]);
    expect(paths(machine({ bed: 'flat' }))).toEqual(['/bed']);
    expect(paths(machine({ bed: bed({ revision: 1.5 }) }))).toEqual(['/bed/revision']);
    expect(paths(machine({ bed: bed({ width: 0 }) }))).toEqual(['/bed/width']);
    expect(paths(machine({ bed: bed({ depth: 'deep' }) }))).toEqual(['/bed/depth']);
    expect(paths(machine({ bed: bed({ thickness: -1 }) }))).toEqual(['/bed/thickness']);
    expect(paths(machine({ bed: bed({ outline: [[0, 0, 0]] }) }))).toEqual(['/bed/outline']);
    expect(paths(machine({ bed: bed({ outline: [[0, 0], [1, 1]] }) }))).toEqual([]);
    expect(paths(machine({ bed: bed({ holes: [[1, 1]] }) }))).toEqual(['/bed/holes']);
    expect(paths(machine({ bed: bed({ holes: null }) }))).toEqual(['/bed/holes']);
    expect(paths(machine({ bed: bed({ toMachine: { x: 0, y: 0 } }) }))).toEqual(['/bed/toMachine']);
    expect(paths(machine({ bed: bed({ toMachine: null }) }))).toEqual(['/bed/toMachine']);
    expect(paths(machine({ bed: bed({ savedAt: 7 }) }))).toEqual(['/bed/savedAt']);
    expect(paths(machine({ bed: bed({ holeGrid: holeGrid() }) }))).toEqual([]);
    expect(paths(machine({ bed: bed({ holeGrid: null }) }))).toEqual(['/bed/holeGrid']);
    expect(paths(machine({ bed: bed({ holeGrid: { ...holeGrid(), description: 'grid' } }) }))).toEqual(['/bed/holeGrid']);
    expect(paths(machine({ bed: bed({ holeGrid: holeGrid({ rows: 'many' }) }) }))).toEqual(['/bed/holeGrid']);
    expect(paths(machine({ bed: bed({ holeGrid: holeGrid({ offsetMeasured: 'yes' }) }) }))).toEqual(['/bed/holeGrid']);
    expect(paths(machine({ bed: bed({ holeGrid: { ...holeGrid(), source: 'Guessed' } }) }))).toEqual(['/bed/holeGrid']);
    expect(paths(machine({ bed: bed({ holeGrid: { ...holeGrid(), at: 'then' } }) }))).toEqual(['/bed/holeGrid']);
  });

  it('checks where the bed came from', () => {
    const withSource = (source: unknown) => paths(machine({ bed: bed({ source }) }));
    expect(withSource(null)).toEqual(['/bed/source']);
    expect(withSource({ kind: 7 })).toEqual(['/bed/source']);
    expect(withSource({ kind: 'placeholder', note: 'From travel' })).toEqual([]);
    expect(withSource({ kind: 'placeholder' })).toEqual(['/bed/source/note']);
    expect(withSource({ kind: 'measured', note: 'Tape', at: AT })).toEqual([]);
    expect(withSource({ kind: 'measured', note: 'Tape' })).toEqual(['/bed/source']);
    expect(withSource({ kind: 'measured', note: 7, at: AT })).toEqual(['/bed/source']);
    expect(withSource({ kind: 'guessed' })).toEqual(['/bed/source/kind']);
    const drawing = { kind: 'drawing', file: 'bed.dxf', hash: 'abc', units: 'mm', scale: 1, at: AT };
    expect(withSource(drawing)).toEqual([]);
    expect(withSource({ ...drawing, units: 'ft' })).toEqual(['/bed/source']);
    expect(withSource({ ...drawing, scale: 0 })).toEqual(['/bed/source']);
    expect(withSource({ ...drawing, file: 1 })).toEqual(['/bed/source']);
    expect(withSource({ ...drawing, hash: 1 })).toEqual(['/bed/source']);
    expect(withSource({ ...drawing, scale: 'big' })).toEqual(['/bed/source']);
    expect(withSource({ ...drawing, at: 'then' })).toEqual(['/bed/source']);
  });
});
