/**
 * Polish pass 1: the board facts (pins from the generated TinyG v8
 * definition, plain-words values, the settings draft), the Machines view's
 * profile-to-TinyG mapping, and my own materials (create, edit, delete).
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_MATERIALS } from '@synthetos/library';
import { clearDraft, draftDiff, draftStore, motorFor, plainValue, setDraft, stepsPerUnit, tinygV8, v8Pins } from '../src/workspace/boardFacts.ts';
import { allMaterials, createMaterial, deleteMaterial, forkMaterial, material, updateMaterial, type MachineProfile } from '../src/workspace/library.ts';
import { fieldsFromForm, materialFormOf } from '../src/workspace/views/LibraryViews.ts';
import { mappingRows, rowDiff } from '../src/workspace/views/MachinesView.ts';

describe('TinyG v8 pins', () => {
  it('lists every connector pin of the board definition with its own label, plus four terminals per motor', () => {
    const board = tinygV8();
    expect(board).not.toBeNull();
    const pins = v8Pins();
    for (const c of board?.connectors ?? []) for (const p of c.pins) expect(pins.find((x) => x.ref === `${c.id}.${p.n}`)?.label).toBe(p.label);
    expect(pins.filter((p) => p.role === 'motor')).toHaveLength(16);
    const spin = pins.find((p) => p.signal === 'out.spindleEnable');
    expect(spin).toMatchObject({ ref: 'J6.3', label: 'Spindle', mcu: 'PA5' });
    expect(spin?.keys).toContain('spep');
    expect(pins.find((p) => p.ref === 'J7.3')).toMatchObject({ label: 'Xmin', function: 'X minimum switch input', keys: ['xsn', 'st'] });
    expect(pins.find((p) => p.signal === 'out.coolant')?.note).toMatch(/share/);
  });
});

describe('plain-words settings and the draft', () => {
  it('reads enumerations and units from the overlay', () => {
    expect(plainValue('xsn', 3)).toBe('limit + homing');
    expect(plainValue('st', 1)).toBe('normally closed');
    expect(plainValue('1sa', 1.8)).toBe('1.8 deg/step');
    expect(plainValue('ex', 1)).toBe('XON/XOFF');
    expect(plainValue('xvm', undefined)).toBeNull();
  });

  it('steps per unit come from step angle, microsteps and travel per revolution', () => {
    expect(stepsPerUnit(1.8, 8, 40)).toBeCloseTo(40);
    expect(stepsPerUnit(undefined, 8, 40)).toBeNull();
  });

  it('a draft is compared with the board and never needs the board to exist', () => {
    clearDraft();
    setDraft('1mi', 4);
    expect(draftDiff('1mi', { '1mi': 8 })).toBe('changed');
    expect(draftDiff('1mi', { '1mi': 4 })).toBe('same');
    expect(draftDiff('1mi', {})).toBe('unread');
    setDraft('1mi', null);
    expect(draftStore.value.value).toEqual({});
  });

  it('maps axes to motors by ma, or by the factory order until the board is read', () => {
    expect(motorFor({}, 'z')).toEqual({ motor: 3, assumed: true });
    expect(motorFor({ '1ma': 2, '2ma': 0 }, 'x')).toEqual({ motor: 2, assumed: false });
    expect(motorFor({ '1ma': 2 }, 'y')).toEqual({ motor: null, assumed: false });
  });
});

describe('the machine profile to TinyG mapping', () => {
  const profile: MachineProfile = { id: 'm', name: 'Mine', templateId: 'custom', drive: 'belt', travel: { x: 300, y: 200, z: 60 }, spindle: '', createdAt: '', axes: { x: { maxVelocity: 12000, microsteps: 8 } } };
  const settings = { xtn: 0, xtm: 300, xvm: 16000, '1ma': 0, '1sa': 1.8, '1mi': 8, '1tr': 40 };

  it('names the key each field maps to and compares the board value', () => {
    const rows = mappingRows(profile, 'x', settings, 'tinyg-en');
    const by = (id: string) => rows.find((r) => r.id === id);
    expect(by('travel')).toMatchObject({ keyText: 'xtm − xtn', board: 300 });
    expect(rowDiff(by('travel')!)).toBe('same');
    expect(by('maxVelocity')).toMatchObject({ key: 'xvm', board: 16000, profile: 12000 });
    expect(rowDiff(by('maxVelocity')!)).toBe('differs');
    expect(by('microsteps')?.key).toBe('1mi');
    expect(rowDiff(by('microsteps')!)).toBe('same');
    expect(rowDiff(by('jerk')!)).toBe('unset');
    expect(by('steps')?.board).toBeCloseTo(40);
  });
});

describe('my own materials', () => {
  it('creates, edits and deletes my own material; built-ins cannot be edited', () => {
    const blank = materialFormOf(null);
    expect(fieldsFromForm(blank, null)).toBe('Give the material a name.');
    const fields = fieldsFromForm({ ...blank, name: 'Walnut', family: 'wood', density: '0.65', safety: [{ severity: 'hazard', text: 'Fine dust: use extraction.' }] }, null);
    expect(typeof fields).not.toBe('string');
    if (typeof fields === 'string') return;
    expect(fields.physical.density).toMatchObject({ value: 0.65, source: { kind: 'user' } });
    const made = createMaterial(fields);
    expect('id' in made).toBe(true);
    if (!('id' in made)) return;
    expect(material(made.id)?.name).toBe('Walnut');
    expect(updateMaterial(made.id, { ...fields, notes: 'Oily' })).toBeNull();
    expect(material(made.id)).toMatchObject({ notes: 'Oily', version: 2 });
    const builtin = BUILTIN_MATERIALS[0]!;
    expect(updateMaterial(builtin.id, fields)).toMatch(/your own/);
    expect(deleteMaterial(builtin.id)).toBe(false);
    expect(deleteMaterial(made.id)).toBe(true);
    expect(material(made.id)).toBeNull();
  });

  it('edits a copy of a built-in field by field, keeping unchanged sourced values', () => {
    const id = forkMaterial(BUILTIN_MATERIALS[0]!.id);
    expect(id).not.toBeNull();
    const m = material(id as string)!;
    const fields = fieldsFromForm({ ...materialFormOf(m), grade: '6061-T651' }, m);
    if (typeof fields === 'string') throw new Error(fields);
    expect(fields.physical.density).toEqual(m.physical.density);
    expect(updateMaterial(m.id, fields)).toBeNull();
    expect(material(m.id)?.grade).toBe('6061-T651');
    expect(allMaterials.value.find((v) => v.material.id === m.id)?.source).toBe('mine');
    expect(deleteMaterial(m.id)).toBe(true);
  });
});
