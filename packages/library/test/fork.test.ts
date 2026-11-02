/**
 * Versions and forks (MACHINING_ASSISTANT §2, §3, §9): a fork inherits every
 * value from its parent until that field is edited, and records the parent's
 * id and version.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MATERIALS,
  builtinMaterial,
  editFork,
  editablePaths,
  forkRecord,
  isInherited,
  isSameVersion,
  readFork,
  rebaseFork,
  refOf,
  resolveFork,
  revertField,
  reviseRecord,
  userValue,
  type LibraryFork,
  type LibraryResult,
  type Material,
  type Tool,
} from '../src/index.ts';
import { tool } from './fixtures.ts';

function value<T>(r: LibraryResult<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

const AL = builtinMaterial('builtin.al-6061') as Material;
type MaterialFork = LibraryFork & { readonly kind: 'material' };
type ToolFork = LibraryFork & { readonly kind: 'tool' };

describe('editable paths', () => {
  it('are the schema fields and one level of nested object fields, never id, version or forkOf', () => {
    const tool = editablePaths('tool');
    expect(tool).toContain('name');
    expect(tool).toContain('geometry');
    expect(tool).toContain('geometry.diameter');
    expect(tool).toContain('life.minutes');
    expect(tool).toContain('firmwareSlot.t');
    expect(tool).not.toContain('purchase.url');
    const material = editablePaths('material');
    expect(material).toContain('physical.kc');
    expect(material).toContain('coolant.need');
    expect(material).toContain('cutting');
    for (const paths of [tool, material]) {
      for (const meta of ['id', 'version', 'forkOf', 'forkOf.id', 'forkOf.version']) expect(paths).not.toContain(meta);
    }
  });
});

describe('versions', () => {
  it('refOf and isSameVersion name one version of a record', () => {
    expect(refOf(AL)).toEqual({ id: 'builtin.al-6061', version: 1 });
    expect(isSameVersion({ id: AL.id, version: 1 }, AL)).toBe(true);
    expect(isSameVersion({ id: AL.id, version: 2 }, AL)).toBe(false);
    expect(isSameVersion({ id: 'other', version: 1 }, AL)).toBe(false);
  });

  it('reviseRecord keeps the id, makes version + 1 and validates', () => {
    const t = value(reviseRecord('tool', tool(), { notes: 'retired' }));
    expect(t).toMatchObject({ id: 'tool-1', version: 2, notes: 'retired' });
    expect(Object.isFrozen(t)).toBe(true);
    const m = value(reviseRecord('material', AL, { notes: 'checked' }));
    expect(m.version).toBe(2);
    const bad = reviseRecord('tool', tool(), { geometry: { ...tool().geometry, fluteLength: 999 } });
    expect(bad.ok).toBe(false);
  });

  it('reviseRecord never patches id, version or forkOf', () => {
    const r = reviseRecord('tool', tool(), { id: 'other', version: 9, forkOf: { id: 'x', version: 1 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path).sort()).toEqual(['/forkOf', '/id', '/version']);
  });
});

describe('forks', () => {
  it('a new fork records the parent id and version and inherits everything', () => {
    const fork = value(forkRecord('material', AL, 'mine.al')) as MaterialFork;
    expect(fork).toEqual({ kind: 'material', id: 'mine.al', version: 1, forkOf: { id: 'builtin.al-6061', version: 1 }, edits: {} });
    const resolved = value(resolveFork(fork, AL));
    expect(resolved).toEqual({ ...AL, id: 'mine.al', version: 1, forkOf: { id: 'builtin.al-6061', version: 1 } });
    for (const path of editablePaths('material')) expect(isInherited(fork, path)).toBe(true);
  });

  it('refuses an invalid parent, a bad id and the parent id', () => {
    const r1 = forkRecord('tool', { ...tool(), type: 'spoon' } as unknown as Tool, 'mine');
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.issues[0]?.path).toBe('/parent/type');
    expect(forkRecord('material', AL, 'Bad Id').ok).toBe(false);
    expect(forkRecord('material', AL, AL.id).ok).toBe(false);
  });

  it('an edited field stops inheriting; the others still follow the parent', () => {
    let fork = value(forkRecord('material', AL, 'mine.al')) as MaterialFork;
    fork = value(editFork(fork, AL, 'physical.kc', userValue(900))) as MaterialFork;
    expect(fork.version).toBe(2);
    expect(isInherited(fork, 'physical.kc')).toBe(false);
    expect(isInherited(fork, 'physical')).toBe(false);
    expect(isInherited(fork, 'physical.density')).toBe(true);
    expect(isInherited(fork, 'coolant')).toBe(true);
    const m = value(resolveFork(fork, AL));
    expect(m.physical.kc).toEqual(userValue(900));
    expect(m.physical.density).toEqual(AL.physical.density);
    expect(m.cutting).toEqual(AL.cutting);
  });

  it('a whole-field edit replaces the field and drops its nested edits; nested edits apply on top of a whole-field edit', () => {
    let fork = value(forkRecord('material', AL, 'mine.al')) as MaterialFork;
    fork = value(editFork(fork, AL, 'coolant.reason', 'air blast')) as MaterialFork;
    fork = value(editFork(fork, AL, 'coolant', { need: 'recommended', reason: 'mist' })) as MaterialFork;
    expect(Object.keys(fork.edits)).toEqual(['coolant']);
    fork = value(editFork(fork, AL, 'coolant.need', 'required')) as MaterialFork;
    expect(value(resolveFork(fork, AL)).coolant).toEqual({ need: 'required', reason: 'mist' });
    expect(isInherited(fork, 'coolant.reason')).toBe(false);
  });

  it('an edit to a nested field of an optional object the parent lacks creates it', () => {
    const parent = { ...tool() } as Record<string, unknown>;
    delete parent['firmwareSlot'];
    const t = parent as unknown as Tool;
    let fork = value(forkRecord('tool', t, 'mine.tool')) as ToolFork;
    expect(editFork(fork, t, 'firmwareSlot.t', 3).ok).toBe(false); // lengthOffset is required with it
    fork = value(editFork(fork, t, 'firmwareSlot', { t: 3, lengthOffset: 1.5 })) as ToolFork;
    fork = value(editFork(fork, t, 'firmwareSlot.t', 4)) as ToolFork;
    expect(value(resolveFork(fork, t)).firmwareSlot).toEqual({ t: 4, lengthOffset: 1.5 });
  });

  it('null removes an optional field in the fork, and is refused for a required one', () => {
    const t = tool();
    let fork = value(forkRecord('tool', t, 'mine.tool')) as ToolFork;
    fork = value(editFork(fork, t, 'datasheetUrl', null)) as ToolFork;
    expect(value(resolveFork(fork, t)).datasheetUrl).toBeUndefined();
    fork = value(editFork(fork, t, 'geometry.stickout', null)) as ToolFork;
    expect(value(resolveFork(fork, t)).geometry.stickout).toBeUndefined();
    expect(editFork(fork, t, 'name', null).ok).toBe(false);
    expect(editFork(fork, t, 'geometry.diameter', null).ok).toBe(false);
  });

  it('refuses edits that are not editable paths or make the record invalid', () => {
    const fork = value(forkRecord('material', AL, 'mine.al')) as MaterialFork;
    for (const path of ['id', 'version', 'forkOf', 'forkOf.version', 'physical.colour', 'cutting.0', 'nope']) {
      const r = editFork(fork, AL, path, 1);
      expect(r.ok, path).toBe(false);
      if (!r.ok) expect(r.issues[0]?.path).toBe('/edits');
    }
    expect(editFork(fork, AL, 'physical.kc', { value: 900 }).ok).toBe(false);
    expect(editFork(fork, AL, 'safety', [{ severity: 'do-not-machine', text: 'no' }]).ok).toBe(false);
    expect(editFork(fork, AL, 'purchase', [{ vendor: 'x', url: 'javascript:alert(1)', kind: 'link' }]).ok).toBe(false);
  });

  it('revertField hands a field back to the parent', () => {
    let fork = value(forkRecord('material', AL, 'mine.al')) as MaterialFork;
    fork = value(editFork(fork, AL, 'physical.kc', userValue(900))) as MaterialFork;
    fork = value(editFork(fork, AL, 'name', 'My 6061')) as MaterialFork;
    fork = value(revertField(fork, AL, 'physical')) as MaterialFork;
    expect(Object.keys(fork.edits)).toEqual(['name']);
    expect(value(resolveFork(fork, AL)).physical).toEqual(AL.physical);
    fork = value(revertField(fork, AL, 'name')) as MaterialFork;
    expect(fork.edits).toEqual({});
    expect(fork.version).toBe(5);
    expect(revertField(fork, AL, 'id').ok).toBe(false);
  });

  it('revertField is refused when the inherited value no longer fits the fork', () => {
    const t = tool();
    let fork = value(forkRecord('tool', t, 'mine.tool')) as ToolFork;
    fork = value(editFork(fork, t, 'geometry.diameter', 12)) as ToolFork;
    fork = value(editFork(fork, t, 'cuttingData', [{ ...t.cuttingData[0], ae: 10 }])) as ToolFork;
    expect(revertField(fork, t, 'geometry.diameter').ok).toBe(false);
  });

  it('resolveFork needs the exact parent version', () => {
    const fork = value(forkRecord('material', AL, 'mine.al')) as MaterialFork;
    const v2 = value(reviseRecord('material', AL, { notes: 'revised' }));
    const r = resolveFork(fork, v2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe('/forkOf');
    expect(resolveFork(fork, BUILTIN_MATERIALS[1] as Material).ok).toBe(false);
  });

  it('rebaseFork follows a newer parent for inherited fields and keeps the edited ones', () => {
    let fork = value(forkRecord('material', AL, 'mine.al')) as MaterialFork;
    fork = value(editFork(fork, AL, 'name', 'My 6061')) as MaterialFork;
    const v2 = value(reviseRecord('material', AL, { notes: 'new parent notes', name: 'Parent renamed' }));
    const moved = value(rebaseFork(fork, v2)) as MaterialFork;
    expect(moved.forkOf).toEqual({ id: AL.id, version: 2 });
    expect(moved.version).toBe(fork.version + 1);
    const m = value(resolveFork(moved, v2));
    expect(m.name).toBe('My 6061');
    expect(m.notes).toBe('new parent notes');
    expect(rebaseFork(moved, v2).ok).toBe(false); // not newer
    expect(rebaseFork(moved, AL).ok).toBe(false); // older
    expect(rebaseFork(moved, { ...v2, id: 'other' } as Material).ok).toBe(false);
  });

  it('readFork checks the shape and that every edit path is editable', () => {
    const fork = value(forkRecord('material', AL, 'mine.al'));
    expect(value(readFork({ ...fork, edits: { 'physical.kc': userValue(1) } }))).toMatchObject({ id: 'mine.al' });
    expect(readFork({ ...fork, edits: { version: 3 } }).ok).toBe(false);
    expect(readFork({ ...fork, edits: { 'geometry.diameter': 3 } }).ok).toBe(false); // a tool path on a material
    expect(readFork({ ...fork, edits: { 'a.b.c': 1 } }).ok).toBe(false);
    expect(readFork({ ...fork, kind: 'fixture' }).ok).toBe(false);
    expect(readFork({ ...fork, forkOf: { id: AL.id } }).ok).toBe(false);
  });

  it('inherits every field it has not edited, for any set of edits (fast-check)', () => {
    const editable = ['name', 'grade', 'description', 'notes', 'coolant.reason', 'family'] as const;
    const edit = fc.record({
      path: fc.constantFrom(...editable),
      text: fc.constantFrom('one', 'two', 'three'),
    });
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 6 }), (edits) => {
        let fork = value(forkRecord('material', AL, 'mine.al')) as MaterialFork;
        for (const e of edits) {
          const v = e.path === 'family' ? 'aluminium' : e.text;
          fork = value(editFork(fork, AL, e.path, v)) as MaterialFork;
        }
        const m = value(resolveFork(fork, AL)) as unknown as Record<string, unknown>;
        const parent = AL as unknown as Record<string, unknown>;
        for (const key of ['physical', 'cutting', 'behaviour', 'safety', 'stockForms', 'purchase']) expect(m[key]).toEqual(parent[key]);
        for (const path of editable) {
          const edited = edits.some((e) => e.path === path);
          expect(isInherited(fork, path)).toBe(!edited);
          if (!edited && !path.includes('.')) expect(m[path]).toEqual(parent[path]);
        }
        expect(m['forkOf']).toEqual({ id: AL.id, version: 1 });
        expect(fork.version).toBe(edits.length + 1);
      }),
    );
  });
});
