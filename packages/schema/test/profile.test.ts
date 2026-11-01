/**
 * MachineProfile v2 (ROADMAP TB-01): schema, v1 → v2 migration, import and
 * export rules (T-S22), the 5 MB limit, fuzzed import, the T-S47 precursor
 * and the field classes.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HOST_GATE_FIELDS } from '@synthetos/safety';
import {
  DEFAULT_HOST_GATE_VALUES,
  HOST_GATE_PATHS,
  PROFILE_FIELD_CLASSES,
  PROFILE_MAX_BYTES,
  PROFILE_MAX_DEPTH,
  PROFILE_V1_SCHEMA,
  PROFILE_V2_SCHEMA,
  ProfileInvalidError,
  canonicalProfile,
  exportProfile,
  familyOfDialect,
  hostGatesOf,
  importProfileBytes,
  importProfileText,
  newMachineProfile,
  profileFieldClass,
  profileSemanticIssues,
  profileSizeError,
  readProfileValue,
  readStoredProfile,
  toStoredProfile,
  utf8Length,
} from '../src/index.ts';
import type { MachineProfileV2, ProfileRead, ProfileResult, Schema } from '../src/index.ts';
import { HASH_A, MACHINE_ID, v1File, v2Router } from './fixtures/profiles.ts';

const ok = (r: ProfileResult): ProfileRead => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${JSON.stringify(r.error.issues)}`);
  return r;
};
const code = (r: ProfileResult) => (r.ok ? 'ok' : r.error.code);
const enc = (s: string) => new TextEncoder().encode(s);
const json = (v: unknown) => JSON.stringify(v);
/** An edit to a deep copy of a fixture: a dotted path and the value to put there (or DELETE). */
type Edit = readonly [path: string, value: unknown];
const DELETE = Symbol('delete');
function edited(base: object, ...edits: Edit[]): Record<string, unknown> {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of edits) {
    const keys = path.split('.');
    let node = copy;
    for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
    const last = keys[keys.length - 1] as string;
    if (value === DELETE) delete node[last];
    // defineProperty, so even `__proto__` becomes a plain own key, as JSON.parse would make it.
    else Object.defineProperty(node, last, { value, enumerable: true, writable: true, configurable: true });
  }
  return copy;
}
const withRouter = (...edits: Edit[]) => edited(v2Router(), ...edits);

/** Every property name declared anywhere in a schema, following $ref. */
function declaredNames(schema: Schema): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = (s: unknown) => {
    if (typeof s !== 'object' || s === null || seen.has(s)) return;
    seen.add(s);
    const o = s as Record<string, unknown>;
    if (typeof o['properties'] === 'object' && o['properties'] !== null) {
      for (const [k, v] of Object.entries(o['properties'] as object)) {
        out.push(k);
        walk(v);
      }
    }
    for (const k of ['items', 'additionalProperties', '$defs']) {
      if (k === '$defs' && o[k] !== undefined) Object.values(o[k] as object).forEach(walk);
      else walk(o[k]);
    }
  };
  walk(schema);
  return out;
}

/** Every object schema reachable in a schema, with its path. */
function objectSchemas(schema: Schema): { path: string; s: Record<string, unknown> }[] {
  const out: { path: string; s: Record<string, unknown> }[] = [];
  const defs = schema['$defs'] as Record<string, Schema>;
  const walk = (s: Record<string, unknown>, path: string) => {
    if (typeof s['$ref'] === 'string') return walk(defs[(s['$ref'] as string).split('/').pop() as string] as Record<string, unknown>, path);
    const types = Array.isArray(s['type']) ? s['type'] : [s['type']];
    if (types.includes('object')) out.push({ path, s });
    for (const [k, v] of Object.entries((s['properties'] ?? {}) as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`);
    if (typeof s['additionalProperties'] === 'object') walk(s['additionalProperties'] as Record<string, unknown>, `${path}.<any>`);
    if (typeof s['items'] === 'object') walk(s['items'] as Record<string, unknown>, `${path}[]`);
  };
  walk(schema as Record<string, unknown>, '');
  return out;
}

/** Leaf field paths of the v2 schema (dotted, axis letters expanded). */
function leafPaths(): string[] {
  const defs = PROFILE_V2_SCHEMA['$defs'] as Record<string, Schema>;
  const out: string[] = [];
  const walk = (s: Record<string, unknown>, path: string) => {
    if (typeof s['$ref'] === 'string') return walk(defs[(s['$ref'] as string).split('/').pop() as string] as Record<string, unknown>, path);
    const props = s['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props === undefined) return void out.push(path);
    for (const [k, v] of Object.entries(props)) walk(v, path === '' ? k : `${path}.${k}`);
  };
  walk(PROFILE_V2_SCHEMA as Record<string, unknown>, '');
  return out;
}

/** Device-local safety records (SAFETY §4.10 rule 3): never a profile field at any level. */
const SYNC_FORBIDDEN = /^(facts?|confirmations?|overrides?|acknowledg(e)?ments?|acks?|pendingRestores?|flashRestorePending|trustAnchor)$/i;
/** Cloud revision metadata lives beside the profile (RUN_PLAN §7.2); `board.rev` is the board revision, a different thing. */
const REVISION_FIELDS = ['rev', 'parent_rev', 'content_sha256'];

describe('MachineProfile v2 schema', () => {
  it('accepts a complete profile and returns it canonical and deep-frozen', () => {
    const r = ok(readStoredProfile(v2Router()));
    expect(r.fromVersion).toBe(2);
    expect(r.profile).toEqual(canonicalProfile(v2Router()));
    expect(Object.isFrozen(r.profile.machine.axes.y?.motors)).toBe(true);
    expect(Object.keys(r.profile.settings.draft)).toEqual(['1ma', '1tr', 'xvm']);
  });

  it('T-S47 precursor: the stored and exported schema declares no fact, confirmation, override, acknowledgement, pending-restore or revision field', () => {
    const names = declaredNames(PROFILE_V2_SCHEMA);
    expect(names.length).toBeGreaterThan(40);
    expect(names.filter((n) => SYNC_FORBIDDEN.test(n))).toEqual([]);
    const top = Object.keys(PROFILE_V2_SCHEMA['properties'] as object);
    expect(top.filter((n) => REVISION_FIELDS.includes(n))).toEqual([]);
  });

  it('T-S47 precursor: every object is closed, so nothing undeclared can ride along', () => {
    for (const { path, s } of objectSchemas(PROFILE_V2_SCHEMA)) {
      if (path === '.settings.draft') {
        // The only open map: setting key -> number. A fact record cannot be a number.
        expect(s['additionalProperties']).toEqual({ type: 'number' });
        continue;
      }
      expect({ path, closed: s['additionalProperties'] }).toEqual({ path, closed: false });
    }
  });

  it('T-S47 precursor: a payload carrying facts, confirmations, overrides or revision metadata is refused, at any level', () => {
    for (const field of ['facts', 'confirmations', 'overrides', 'acknowledgements', 'pendingRestore', 'rev', 'content_sha256']) {
      const top = readStoredProfile({ ...v2Router(), [field]: [] });
      expect(code(top)).toBe('InvalidProfile');
      expect(!top.ok && top.error.issues.some((i) => i.path === `/${field}` && i.message === 'property not allowed')).toBe(true);
    }
    expect(code(readStoredProfile(withRouter(['machine.facts', []])))).toBe('InvalidProfile');
    expect(code(readStoredProfile(withRouter(['settings.overrides', []])))).toBe('InvalidProfile');
    expect(code(readStoredProfile(withRouter(['settings.draft.dirx', { verified: true }])))).toBe('InvalidProfile');
  });

  it('refuses bad shapes with paths', () => {
    const cases: [string, Edit][] = [
      ['/id', ['id', 'not-a-uuid']],
      ['/name', ['name', 'evil‮name']],
      ['/name', ['name', '']],
      ['/boundDevice/dialectId', ['boundDevice.dialectId', 'marlin']],
      ['/machine/axes/q', ['machine.axes.q', v2Router().machine.axes.x]],
      ['/machine/queuedMotionCeilingS', ['machine.queuedMotionCeilingS', 21]],
      ['/machine/holdTimeoutS', ['machine.holdTimeoutS', 5]],
      ['/machine/jogCaps/maxStepMm', ['machine.jogCaps.maxStepMm', 0]],
      ['/machine/axes/x/motors/0', ['machine.axes.x.motors', [7]]],
      ['/settings/draft/__proto__', ['settings.draft.__proto__', 1]],
      ['/settings/draft/XVM', ['settings.draft.XVM', 1]],
      ['/settings/deviceHash', ['settings.deviceHash', 'abc']],
      ['', ['wiringRef', DELETE]],
    ];
    for (const [path, change] of cases) {
      const r = readStoredProfile(withRouter(change));
      expect(code(r)).toBe('InvalidProfile');
      expect({ path, hit: !r.ok && r.error.issues.some((i) => i.path === path) }).toEqual({ path, hit: true });
    }
  });

  it('applies the cross-field rules (controller-neutral shape, per-family limits)', () => {
    const issue = (...edits: Edit[]) => profileSemanticIssues(withRouter(...edits) as unknown as MachineProfileV2).map((i) => `${i.path}: ${i.message}`);
    expect(profileSemanticIssues(v2Router())).toEqual([]);
    expect(issue(['machine.axes.z.motors', [1]])).toEqual(['/machine/axes/z/motors: motor 1 already drives axis x']);
    expect(issue(['machine.axes.z.motors', [5]])).toEqual(['/machine/axes/z/motors: motor 5 does not exist on a tinyg board']);
    expect(issue(['machine.axes.x.drive', { kind: 'screw', pitchMm: 5 }])).toEqual(['/machine/axes/x/drive: a screw drive needs starts']);
    expect(issue(['machine.axes.x.drive', { kind: 'rotary', ratio: 3, teeth: 2 }])).toEqual(['/machine/axes/x/drive/teeth: a rotary drive has no teeth']);
    expect(issue(['machine.homingOrder', ['z', 'a']])).toEqual(['/machine/homingOrder/1: axis a is not defined']);
    expect(issue(['machine.axes.x.homeEnd', 'none'])).toEqual(['/machine/homingOrder/1: axis x has no home switch end']);
    expect(issue(['machine.spindle.drive', 'none'])).toEqual(['/machine/spindle: spindle kind "none" and drive "none" go together']);
    expect(issue(['machine.hostLossPolicy', 'hold-and-spindle-pause'])).toEqual(['/machine/hostLossPolicy: TinyG supports only the "drain" host-loss policy']);
    expect(issue(['boundDevice.dialectId', 'g2core-edge'])).toEqual([
      '/boundDevice/dialectId: dialect g2core-edge is not a tinyg dialect',
    ]);
    expect(issue(['firmware.dialectId', 'g2core-edge'])).toEqual([
      '/firmware/dialectId: firmware dialect g2core-edge does not belong to the bound tinyg board',
      '/settings/schemaKey: the settings draft was made for tinyg-en@ead63997, not for g2core-edge',
    ]);
    // g2core: six motors and the pause policy are legitimate; TinyG limits are not built into the shape.
    expect(
      issue(
        ['boundDevice', { family: 'g2core', id: 'g2-1', fb: 101.03, dialectId: 'g2core-edge' }],
        ['firmware', { dialectId: 'g2core-edge', fb: 101.03 }],
        ['settings.schemaKey', null],
        ['machine.axes.a', { motors: [6], drive: { kind: 'rotary', ratio: 1 }, measuredTravelMm: null, homeEnd: 'none' }],
        ['machine.hostLossPolicy', 'hold-and-spindle-pause'],
      ),
    ).toEqual([]);
    // Unbound and without firmware: no family, so no per-family limit applies yet.
    expect(issue(['boundDevice', null], ['firmware', null], ['machine.axes.z.motors', [6]])).toEqual([]);
    // Family from the firmware when unbound.
    expect(issue(['boundDevice', null], ['machine.axes.z.motors', [6]])).toEqual(['/machine/axes/z/motors: motor 6 does not exist on a tinyg board']);
    expect(familyOfDialect('g2core-101.03')).toBe('g2core');
    expect(familyOfDialect('tinyg-449-stock')).toBe('tinyg');
  });
});

describe('field classes and host gates', () => {
  it('classes every leaf of the v2 schema, and every class entry is used', () => {
    const leaves = leafPaths();
    expect(leaves).toContain('machine.axes.y.motors');
    for (const leaf of leaves) expect(['firmwareSetting', 'hostGate', 'descriptive', 'binding']).toContain(profileFieldClass(leaf));
    for (const [entry] of PROFILE_FIELD_CLASSES) {
      const re = new RegExp(`^${entry.replace(/\./g, '\\.').replace('*', '[xyzabc]')}(\\.|$)`);
      expect({ entry, used: leaves.some((l) => re.test(l)) }).toEqual({ entry, used: true });
    }
    for (const [a] of PROFILE_FIELD_CLASSES) {
      for (const [b] of PROFILE_FIELD_CLASSES) if (a !== b) expect({ a, b, prefix: b.startsWith(`${a}.`) }).toEqual({ a, b, prefix: false });
    }
    expect(() => profileFieldClass('machine.colour')).toThrow(/has no class/);
    expect(() => profileFieldClass('machine.axes.q.motors')).toThrow(/has no class/);
  });

  it('the host gates are exactly the SAFETY §4.10 rule 4 list, and settings are the only firmware settings', () => {
    expect(Object.keys(HOST_GATE_PATHS).sort()).toEqual([...HOST_GATE_FIELDS].sort());
    for (const path of Object.values(HOST_GATE_PATHS)) expect(profileFieldClass(path.replace('*', 'x'))).toBe('hostGate');
    const gates = PROFILE_FIELD_CLASSES.filter(([, c]) => c === 'hostGate').map(([p]) => p);
    expect(gates.sort()).toEqual(Object.values(HOST_GATE_PATHS).sort());
    expect(PROFILE_FIELD_CLASSES.filter(([, c]) => c === 'firmwareSetting').map(([p]) => p)).toEqual(['settings.draft']);
    expect(profileFieldClass('boundDevice.id')).toBe('binding');
    expect(profileFieldClass('machine.axes.x.drive.pitchMm')).toBe('descriptive');
  });

  it('hostGatesOf hands safety the profile values, with dual-motor axes from the axis motors', () => {
    expect(hostGatesOf(v2Router())).toEqual({
      spindleKind: 'spindle',
      dualMotorAxes: [{ axis: 'y', motors: [2, 3] }],
      queuedMotionCeilingS: 5,
      jogCaps: { maxStepMm: 10, maxFeedMmPerMin: 1000 },
      homingOrder: ['z', 'x', 'y'],
      holdTimeoutS: 60,
      hostLossPolicy: 'drain',
    });
    expect(Object.isFrozen(hostGatesOf(v2Router()).jogCaps)).toBe(true);
  });

  it('a new profile is unbound, empty and starts at the tight host-gate defaults', () => {
    const p = newMachineProfile({ id: MACHINE_ID, name: 'New machine', createdWith: { tool: 'run', version: '0.2.0', sha: null } });
    expect(p.boundDevice).toBeNull();
    expect(p.machine.axes).toEqual({});
    expect(p.machine).toMatchObject({ ...DEFAULT_HOST_GATE_VALUES });
    expect(() => newMachineProfile({ id: 'x', name: 'n', createdWith: { tool: 'run', version: '1', sha: null } })).toThrow(ProfileInvalidError);
  });
});

describe('export and storage', () => {
  it('exportProfile strips facts, confirmations and overrides even when smuggled in through a cast', () => {
    const smuggled = {
      ...v2Router(),
      facts: [{ key: 'dir.x' }],
      confirmations: [{ id: 'C5' }],
      overrides: [{ key: 'run-unhomed' }],
      rev: 3,
      machine: { ...v2Router().machine, facts: [1], axes: { ...v2Router().machine.axes, x: { ...v2Router().machine.axes.x!, override: true } } },
    } as unknown as MachineProfileV2;
    const text = exportProfile(smuggled);
    expect(text).not.toMatch(/facts|confirmations|overrides|override/);
    expect(text.endsWith('}\n')).toBe(true);
    const back = JSON.parse(text) as MachineProfileV2;
    expect(back.machine.axes).toEqual(v2Router().machine.axes);
    expect(back.boundDevice).toEqual(v2Router().boundDevice);
    expect(Object.keys(back)).not.toContain('rev');
  });

  it('equal profiles export to equal bytes whatever the key order of the draft', () => {
    const a = v2Router();
    const b = { ...a, settings: { ...a.settings, draft: { '1tr': 5, xvm: 16000, '1ma': 0 } } };
    expect(exportProfile(b)).toBe(exportProfile(a));
  });

  it('refuses to store or export an invalid profile, with a typed error', () => {
    const bad = withRouter(['machine.jogCaps.maxStepMm', -1]) as unknown as MachineProfileV2;
    expect(() => toStoredProfile(bad)).toThrow(ProfileInvalidError);
    expect(() => exportProfile(bad)).toThrow(/jogCaps\/maxStepMm/);
    expect(() => toStoredProfile(withRouter(['wiringRef', DELETE]) as unknown as MachineProfileV2)).toThrow('/ missing required property "wiringRef"');
    const broken = { ...v2Router(), machine: undefined } as unknown as MachineProfileV2;
    try {
      toStoredProfile(broken);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileInvalidError);
      expect((e as ProfileInvalidError).issues).toContainEqual({ path: '/machine', message: 'expected object' });
    }
  });

  it('a stored profile keeps its binding; reading it back is lossless', () => {
    const stored = toStoredProfile(v2Router());
    expect(ok(readStoredProfile(JSON.parse(JSON.stringify(stored)))).profile).toEqual(stored);
    expect(ok(readStoredProfile(stored)).profile.boundDevice).toEqual(v2Router().boundDevice);
  });
});

describe('import (T-S22)', () => {
  it('T-S22: an imported v2 export has no facts, its boundDevice is cleared, and nothing else changes', () => {
    const r = ok(importProfileText(exportProfile(v2Router())));
    expect(r.profile.boundDevice).toBeNull();
    expect({ ...r.profile, boundDevice: v2Router().boundDevice }).toEqual(canonicalProfile(v2Router()));
    expect(r.reverifyFactKeys).toEqual([]);
    expect(JSON.stringify(r.profile)).not.toMatch(/facts|confirmations|overrides/);
  });

  it('T-S22: a v1 file with facts imports with no fact, confirmation or override; every fact key needs re-verify; binding cleared', () => {
    const r = ok(importProfileText(json(v1File())));
    expect(r.fromVersion).toBe(1);
    expect(r.profile.boundDevice).toBeNull();
    expect(r.reverifyFactKeys).toEqual(['dir.x.verified', 'switch.xmin']);
    expect(r.droppedFields).toEqual(['facts', 'overrides', 'confirmations', 'settings.device', 'firmware.fv']);
    const text = JSON.stringify(r.profile);
    expect(text).not.toMatch(/facts|confirmations|overrides|run-unhomed|jog \+0\.25/);
    expect(r.legacyWiring).toEqual({ parts: [{ id: 'p1' }], wires: [], hash: 'h' });
    expect(Object.isFrozen(r.profile)).toBe(true);
  });

  it('migrates v1 to v2 field by field, with safe defaults for what v1 lacked', () => {
    const r = ok(readProfileValue(v1File()));
    const p = r.profile;
    expect(p.boundDevice).toEqual({ family: 'tinyg', id: '9H3583-WQX', fb: 440.21, dialectId: 'tinyg-440' });
    expect(p.firmware).toEqual({ dialectId: 'tinyg-440', fb: 440.21, imageSha256: 'c'.repeat(64) });
    expect(p.machine.axes).toEqual({
      x: { motors: [1], drive: { kind: 'screw', pitchMm: 2, starts: 1 }, measuredTravelMm: 300, homeEnd: 'min' },
      y: { motors: [2], drive: { kind: 'unknown' }, measuredTravelMm: null, homeEnd: 'none' },
      z: { motors: [3], drive: { kind: 'screw', pitchMm: 2, starts: 1 }, measuredTravelMm: null, homeEnd: 'max' },
    });
    expect(p.machine.homingOrder).toEqual(['z', 'x']);
    expect(p.machine.spindle).toEqual({ kind: 'spindle', drive: 'relay', activeLow: true });
    expect(p.machine.estop).toEqual({ kind: 'mushroom-nc+contactor', auxInput: 'amax' });
    // TinyG cannot pause the spindle on host loss.
    expect(p.machine.hostLossPolicy).toBe('drain');
    expect(p.machine).toMatchObject({ queuedMotionCeilingS: 5, jogCaps: { maxStepMm: 10, maxFeedMmPerMin: 1000 }, holdTimeoutS: 60 });
    expect(p.settings).toEqual({ draft: { xvm: 12000 }, schemaKey: null, deviceHash: null });
    expect(p.wiringRef).toBeNull();
    expect(p.createdWith).toEqual({ tool: 'machine-tools', version: '0.3.0', sha: null });
    expect(r.notes.join(' ')).toMatch(/drain.*safe defaults.*tinyg@440\.21/s);
  });

  it('migrates minimal and edge-case v1 files', () => {
    const minimal = { schemaVersion: 1, id: MACHINE_ID, name: 'Laser', machine: { type: 'laser', axes: {}, spindle: { kind: 'pwm' } } };
    const p = ok(readProfileValue(minimal)).profile;
    expect(p.machine.spindle).toEqual({ kind: 'laser', drive: 'pwm', activeLow: false });
    expect(p).toMatchObject({ boundDevice: null, board: null, firmware: null, settings: { draft: {}, schemaKey: null, deviceHash: null } });
    expect(p.machine.estop).toEqual({ kind: 'unknown', auxInput: null });
    expect(p.machine.psu).toBeNull();
    expect(p.createdWith).toEqual({ tool: 'unknown', version: '0', sha: null });
    const plasma = ok(readProfileValue({ ...minimal, machine: { type: 'plasma', axes: {}, spindle: { kind: 'relay' } } })).profile;
    expect(plasma.machine.spindle.kind).toBe('plasma');
    const none = ok(readProfileValue({ ...minimal, machine: { type: 'router', axes: {}, spindle: { kind: 'none' } } })).profile;
    expect(none.machine.spindle).toMatchObject({ kind: 'none', drive: 'none' });
    // A binding without firmware cannot be carried (no dialect); it is dropped with a note.
    const unbound = ok(readProfileValue({ ...minimal, boundDevice: { family: 'tinyg', id: 'b', fb: 440.21 } }));
    expect(unbound.profile.boundDevice).toBeNull();
    expect(unbound.notes[0]).toMatch(/bound again/);
    // Kept when valid; a g2 board keeps its host-loss policy.
    const kept = ok(
      readProfileValue({
        ...minimal,
        boundDevice: { family: 'g2core', id: 'g', fb: 101.03 },
        firmware: { dialectId: 'g2core-edge', fb: 101.03 },
        board: { id: 'gquintic' },
        machine: { type: 'router', axes: { x: { motors: [1], drive: { kind: 'rotary', ratio: 2 } } }, spindle: { kind: 'none' }, hostLossPolicy: 'hold-and-spindle-pause', estop: { kind: 'none' } },
        settings: { schemaKey: 'g2core-edge@abcdef1', deviceHash: HASH_A },
        createdWith: { sha: 'abcdef1' },
      }),
    ).profile;
    expect(kept.machine.hostLossPolicy).toBe('hold-and-spindle-pause');
    expect(kept.machine.axes.x?.drive).toEqual({ kind: 'rotary', ratio: 2 });
    expect(kept.board).toEqual({ id: 'gquintic', rev: null, hv: null });
    expect(kept.settings).toEqual({ draft: {}, schemaKey: 'g2core-edge@abcdef1', deviceHash: HASH_A });
    expect(kept.machine.estop).toEqual({ kind: 'none', auxInput: null });
    expect(kept.createdWith.sha).toBe('abcdef1');
    const belt = ok(readProfileValue({ ...minimal, machine: { type: 'router', axes: { y: { motors: [2], drive: { kind: 'belt', pitch: 2, teeth: 20 } } }, spindle: { kind: 'none' } } }));
    expect(belt.profile.machine.axes.y?.drive).toEqual({ kind: 'belt', pitchMm: 2, teeth: 20 });
  });

  it('refuses a v1 file that is malformed or cannot become a valid v2 profile', () => {
    expect(code(readProfileValue({ ...v1File(), surprise: 1 }))).toBe('InvalidProfile');
    const r = readProfileValue({ ...v1File(), machine: { ...(v1File()['machine'] as object), axes: { x: { motors: [1] }, y: { motors: [1] } } } });
    expect(code(r)).toBe('InvalidProfile');
    expect(!r.ok && r.error.message).toMatch(/cannot be migrated/);
  });

  it('refuses unsupported versions and non-objects with typed errors', () => {
    expect(code(readProfileValue({ ...v2Router(), schemaVersion: 3 }))).toBe('UnsupportedVersion');
    const newer = readProfileValue({ schemaVersion: 7 });
    expect(!newer.ok && newer.error.message).toMatch(/newer version of run \(schema version 7\)/);
    expect(code(readProfileValue({}))).toBe('UnsupportedVersion');
    expect(code(readProfileValue({ schemaVersion: '2' }))).toBe('UnsupportedVersion');
    expect(code(readProfileValue([]))).toBe('NotAnObject');
    expect(code(importProfileText('null'))).toBe('NotAnObject');
    expect(code(importProfileText('{"schemaVersion":2'))).toBe('NotJson');
    expect(code(importProfileText(`${'['.repeat(PROFILE_MAX_DEPTH + 1)}${']'.repeat(PROFILE_MAX_DEPTH + 1)}`))).toBe('TooDeep');
    expect(code(importProfileText(`${'['.repeat(PROFILE_MAX_DEPTH)}${']'.repeat(PROFILE_MAX_DEPTH)}`))).toBe('NotAnObject');
    expect(code(readStoredProfile(JSON.parse(`${'['.repeat(40)}${']'.repeat(40)}`)))).toBe('TooDeep');
    expect(code(readStoredProfile(null))).toBe('NotAnObject');
    expect(code(importProfileBytes(new Uint8Array([0x7b, 0xff, 0x7d])))).toBe('NotUtf8');
  });

  it('reads bytes with and without a UTF-8 BOM, and text with a BOM', () => {
    const text = exportProfile(v2Router());
    expect(ok(importProfileBytes(enc(text))).profile.id).toBe(MACHINE_ID);
    expect(ok(importProfileBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...enc(text)]))).profile.id).toBe(MACHINE_ID);
    expect(ok(importProfileText(`﻿${text}`)).profile.id).toBe(MACHINE_ID);
  });
});

describe('the 5 MB limit', () => {
  it('a 5 MB + 1 byte file is refused with ProfileTooLarge before it is parsed', () => {
    expect(PROFILE_MAX_BYTES).toBe(5 * 1024 * 1024);
    // Not JSON at all: had it been decoded or parsed, the error would be NotUtf8 or NotJson.
    const bytes = new Uint8Array(PROFILE_MAX_BYTES + 1).fill(0xff);
    const r = importProfileBytes(bytes);
    expect(code(r)).toBe('ProfileTooLarge');
    const text = '{'.repeat(PROFILE_MAX_BYTES + 1);
    expect(code(importProfileText(text))).toBe('ProfileTooLarge');
    // A multi-byte string that is 5 MB + 1 byte in UTF-8 but far fewer UTF-16 units.
    const euro = `${'€'.repeat(Math.floor(PROFILE_MAX_BYTES / 3))}abc`; // 3 bytes each: 5 242 878 + 3
    expect(utf8Length(euro)).toBe(PROFILE_MAX_BYTES + 1);
    expect(euro.length).toBeLessThan(PROFILE_MAX_BYTES);
    expect(code(importProfileText(euro))).toBe('ProfileTooLarge');
  });

  it('exactly 5 MB passes the size check and goes on to be parsed', () => {
    const exact = new Uint8Array(PROFILE_MAX_BYTES).fill(0x20);
    exact[0] = 0x7b;
    expect(code(importProfileBytes(exact))).toBe('NotJson');
    const text = exportProfile(v2Router());
    const padded = text + ' '.repeat(PROFILE_MAX_BYTES - utf8Length(text));
    expect(utf8Length(padded)).toBe(PROFILE_MAX_BYTES);
    expect(code(importProfileText(padded))).toBe('ok');
  });

  it('profileSizeError refuses negative, non-finite and oversized lengths (for File.size before reading)', () => {
    expect(profileSizeError(0)).toBeNull();
    expect(profileSizeError(PROFILE_MAX_BYTES)).toBeNull();
    for (const n of [PROFILE_MAX_BYTES + 1, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(profileSizeError(n)?.code).toBe('ProfileTooLarge');
  });

  it('utf8Length counts like an encoder, including surrogate pairs and lone surrogates', () => {
    for (const s of ['', 'a', 'é', '€', '😀', 'a😀b', '\ud800', '\udc00x', `x\ud83d`]) {
      expect({ s, n: utf8Length(s) }).toEqual({ s, n: new TextEncoder().encode(s).length });
    }
    expect(utf8Length('abcdef', 2)).toBe(3); // stops once past the limit
  });
});

describe('fuzzed import', () => {
  it('never throws on arbitrary text, bytes or JSON values; every failure is a typed error', () => {
    const codes = new Set(['ok', 'ProfileTooLarge', 'NotUtf8', 'NotJson', 'TooDeep', 'NotAnObject', 'UnsupportedVersion', 'InvalidProfile']);
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        expect(codes.has(code(importProfileText(s)))).toBe(true);
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (b) => {
        expect(codes.has(code(importProfileBytes(b)))).toBe(true);
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 6 }), (v) => {
        expect(codes.has(code(importProfileText(JSON.stringify(v))))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('never throws when a valid v1 or v2 profile is mutated at a random path, and never imports a fact', () => {
    const anyValue = fc.oneof(fc.jsonValue({ maxDepth: 2 }), fc.constant(undefined), fc.constant({ facts: [] }));
    const mutate = (base: Record<string, unknown>) =>
      fc.tuple(fc.array(fc.nat(), { minLength: 1, maxLength: 5 }), anyValue).map(([path, value]) => {
        const copy = structuredClone(base) as Record<string, unknown>;
        let node = copy;
        for (const [i, step] of path.entries()) {
          const keys = Object.keys(node);
          const key = keys.length === 0 ? 'facts' : (keys[step % keys.length] as string);
          const next = node[key];
          if (i === path.length - 1 || typeof next !== 'object' || next === null) {
            if (value === undefined) delete node[key];
            else node[key] = value;
            break;
          }
          node = next as Record<string, unknown>;
        }
        return copy;
      });
    for (const base of [v2Router() as unknown as Record<string, unknown>, v1File()]) {
      fc.assert(
        fc.property(mutate(base), (m) => {
          const r = importProfileText(JSON.stringify(m));
          if (r.ok) {
            expect(r.profile.boundDevice).toBeNull();
            expect(Object.keys(r.profile)).not.toContain('facts');
            expect(declaredNamesOf(r.profile).filter((n) => SYNC_FORBIDDEN.test(n))).toEqual([]);
          }
        }),
        { numRuns: 400 },
      );
    }
  });
});

/** Every key in a JSON value except the settings draft's setting keys. */
function declaredNamesOf(v: unknown, path = ''): string[] {
  if (typeof v !== 'object' || v === null) return [];
  return Object.entries(v).flatMap(([k, c]) => [...(path === '.settings.draft' ? [] : [k]), ...declaredNamesOf(c, `${path}.${k}`)]);
}

describe('v1 schema', () => {
  it('is read for migration only and accepts the facts it then drops', () => {
    expect(declaredNames(PROFILE_V1_SCHEMA)).toEqual(expect.arrayContaining(['facts', 'overrides', 'confirmations']));
    expect(declaredNames(PROFILE_V2_SCHEMA)).not.toContain('facts');
  });
});
