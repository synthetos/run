/**
 * The device-local fact engine (ROADMAP TB-01): keys and patterns, the
 * invalidation rules as data, `addFact` / `invalidate` / `view`, the old
 * P1-01 property test, the fact-age rule with an injected clock, machine
 * binding (T-S74 precursor) and import invalidation (T-S22).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_FACTS,
  DAY_MS,
  DEFAULT_FACT_MAX_AGE_MS,
  EMPTY_FACT_STATE,
  FACT_ROOTS,
  FUTURE_SKEW_MS,
  FactError,
  INVALIDATION_RULES,
  SETTINGS_SCHEMAS,
  TINYG_EN_OVERLAY,
  addFact,
  factProblem,
  importProfileText,
  invalidate,
  isFactKey,
  isFactPattern,
  patternMatches,
  readFactState,
  settingInvalidates,
  view,
} from '../src/index.ts';
import type { FactBinding, FactState, FactTrigger, NewFact } from '../src/index.ts';
import { HASH_A, HASH_B, MACHINE_ID, v1File } from './fixtures/profiles.ts';

const T0 = Date.UTC(2026, 10, 1);
const clockAt = (t: number) => () => t;
const BOARD = '9H3583-WQX';
const OTHER_MACHINE = '00000000-0000-4000-8000-000000000002';
const BIND: FactBinding = { machineId: MACHINE_ID, boardId: BOARD, fb: 450.01, deviceHash: HASH_A };
const SESSION = 'live-1';

const fact = (key: string, extra: Partial<NewFact> = {}): NewFact => ({
  key,
  value: true,
  by: 'tool',
  evidence: 'jog +0.25 mm confirmed',
  at: T0,
  boundTo: BIND,
  ...(key.startsWith('switch') ? { liveSessionId: SESSION } : {}),
  ...extra,
});
const withFacts = (...facts: NewFact[]): FactState => facts.reduce(addFact, EMPTY_FACT_STATE);
const statusIn = (s: FactState, key: string, binding: FactBinding = BIND, now = T0, liveSessionId: string | null = SESSION) =>
  view(s, binding, { clock: clockAt(now), liveSessionId }).status(key);

describe('fact keys and patterns', () => {
  it('accepts keys with a known root and plain segments, never a wildcard', () => {
    for (const k of ['dir', 'dir.x', 'switch.xmin', 'outputs.spindle', `job.${'f'.repeat(64)}.preflight`, 'probe.polarity', 'dir.x.verified']) {
      expect({ k, ok: isFactKey(k) }).toEqual({ k, ok: true });
    }
    for (const k of ['', 'dir.*', 'colour.x', 'Dir.x', 'dir..x', 'dir.X', 'dir.x.', '.dir', 'a.b.c.d.e.f.g', 'dir.' + 'x'.repeat(65), 7, null, 'dir.x'.repeat(70)]) {
      expect({ k, ok: isFactKey(k) }).toEqual({ k, ok: false });
    }
    expect(isFactPattern('job.*.preflight')).toBe(true);
    expect(isFactPattern('*.x')).toBe(false);
    expect(isFactPattern(3)).toBe(false);
  });

  it('a pattern clears every key it agrees with on their common segments', () => {
    expect(patternMatches('dir.*', 'dir.x')).toBe(true);
    expect(patternMatches('dir.*', 'dir.x.verified')).toBe(true);
    // A broader key depends on every part of its root: a narrower pattern clears it too.
    expect(patternMatches('dir.*', 'dir')).toBe(true);
    expect(patternMatches('homing.x', 'homing')).toBe(true);
    expect(patternMatches('softlimits.on', 'softlimits')).toBe(true);
    expect(patternMatches('job.*.preflight', 'job')).toBe(true);
    expect(patternMatches('dir.*', 'scale')).toBe(false);
    expect(patternMatches('dir', 'dir.x')).toBe(true);
    expect(patternMatches('softlimits.on', 'softlimits.on')).toBe(true);
    expect(patternMatches('softlimits.on', 'softlimits.off')).toBe(false);
    expect(patternMatches('job.*.preflight', `job.${'a'.repeat(64)}.preflight`)).toBe(true);
    expect(patternMatches('job.*.preflight', 'job.abc.armed')).toBe(false);
    expect(patternMatches('homing.x', 'homing.y')).toBe(false);
    expect(patternMatches('dirx', 'dir.x')).toBe(false);
    expect(patternMatches('dir.*', 'dir.*')).toBe(false); // a key is never a wildcard
    expect(patternMatches('bad pattern', 'dir.x')).toBe(false);
  });
});

describe('invalidation rules as data', () => {
  it('every rule pattern and every overlay invalidation pattern is well formed', () => {
    for (const [kind, rule] of Object.entries(INVALIDATION_RULES)) {
      if (Array.isArray(rule.clears)) for (const p of rule.clears) expect({ kind, p, ok: isFactPattern(p) }).toEqual({ kind, p, ok: true });
      expect(rule.source.length).toBeGreaterThan(5);
    }
    for (const o of TINYG_EN_OVERLAY) for (const p of o.invalidates) expect({ key: o.key, p, ok: isFactPattern(p) }).toEqual({ key: o.key, p, ok: true });
  });

  it('carries the OLD TOOLS_PLAN §5.2 table', () => {
    expect(INVALIDATION_RULES.flash.clears).toEqual([...FACT_ROOTS]);
    expect(INVALIDATION_RULES.temporaryTravelWrite.clears).toEqual(['softlimits', 'job.*.preflight']);
    expect(INVALIDATION_RULES.offsetsChanged.clears).toEqual(['job.*.preflight']);
    expect(INVALIDATION_RULES.reportingNormalised.clears).toEqual([]);
    expect(INVALIDATION_RULES.machineSelected).toMatchObject({ scope: 'boardOtherMachines', clears: ['dir', 'scale', 'homing'] });
    expect(INVALIDATION_RULES.profileImported).toMatchObject({ scope: 'machine', clears: ALL_FACTS });
    expect(INVALIDATION_RULES.mechanicalChange.clears).toEqual(['dir', 'scale']);
  });

  it('a setting write clears its reviewed overlay patterns; an unreviewed write clears everything', () => {
    expect(settingInvalidates('tinyg-en', '1ma')).toEqual(['dir.*', 'homing.*']);
    expect(settingInvalidates('tinyg-en', 'xsv')).toEqual(['homing.x']);
    expect(settingInvalidates('tinyg-en', 'mt')).toEqual([]);
    expect(settingInvalidates('tinyg-en', 'os')).toEqual(['job.*.preflight']);
    expect(settingInvalidates('tinyg-en', '1MA')).toEqual(ALL_FACTS); // not the canonical spelling
    expect(settingInvalidates('tinyg-en', 'ej')).toEqual(ALL_FACTS); // in the table, no overlay
    expect(settingInvalidates('tinyg-440', 'xvm')).toEqual(ALL_FACTS); // no 440 overlay yet
    expect(settingInvalidates('g2core-edge', 'xvm')).toEqual(ALL_FACTS); // no schema
    expect(settingInvalidates('constructor', 'xvm')).toEqual(ALL_FACTS);
  });
});

describe('addFact and view', () => {
  it('a fact bound to the connected machine, board, fb and deviceHash is valid; re-adding replaces', () => {
    let s = withFacts(fact('dir.x'));
    expect(statusIn(s, 'dir.x')).toBe('valid');
    expect(statusIn(s, 'dir.y')).toBe('absent');
    s = addFact(s, fact('dir.x', { evidence: 'again', at: T0 + 1 }));
    expect(s.facts).toHaveLength(1);
    expect(s.facts[0]?.evidence).toBe('again');
    expect(Object.isFrozen(s) && Object.isFrozen(s.facts) && Object.isFrozen(s.facts[0]?.boundTo)).toBe(true);
  });

  it('a different fb or deviceHash makes every fact needs re-verify; another machine or board does not see it', () => {
    const s = withFacts(fact('dir.x'), fact('scale.x'));
    expect(statusIn(s, 'dir.x', { ...BIND, fb: 440.21 })).toBe('needsReverify');
    expect(statusIn(s, 'dir.x', { ...BIND, deviceHash: HASH_B })).toBe('needsReverify');
    expect(statusIn(s, 'dir.x', { ...BIND, machineId: OTHER_MACHINE })).toBe('absent');
    expect(statusIn(s, 'dir.x', { ...BIND, boardId: 'other-board' })).toBe('absent');
    expect(view(s, { ...BIND, boardId: 'other-board' }, { clock: clockAt(T0), liveSessionId: null }).entries).toEqual([]);
  });

  it('switch facts count only in the LIVE session that confirmed them (H28)', () => {
    const s = withFacts(fact('switch.xmin'));
    expect(statusIn(s, 'switch.xmin')).toBe('valid');
    expect(statusIn(s, 'switch.xmin', BIND, T0, 'live-2')).toBe('sessionRecheck');
    expect(statusIn(s, 'switch.xmin', BIND, T0, null)).toBe('sessionRecheck');
    expect(() => addFact(EMPTY_FACT_STATE, { ...fact('switch.xmin'), liveSessionId: undefined } as unknown as NewFact)).toThrow(/needs liveSessionId/);
  });

  it('refuses malformed facts with FactError', () => {
    const bad: [Partial<NewFact> | Record<string, unknown>, RegExp][] = [
      [{ key: 'dir.*' }, /malformed fact key/],
      [{ value: Number.NaN }, /value must be/],
      [{ value: '' }, /value must be/],
      [{ by: 'admin' as never }, /by must be/],
      [{ evidence: 'x'.repeat(501) }, /evidence/],
      [{ at: Number.POSITIVE_INFINITY }, /at must be/],
      [{ boundTo: null as never }, /boundTo must be an object/],
      [{ boundTo: { ...BIND, machineId: '' } }, /machine id and a board id/],
      [{ boundTo: { ...BIND, fb: Number.NaN } }, /fb must be/],
      [{ boundTo: { ...BIND, deviceHash: '' } }, /deviceHash/],
      [{ liveSessionId: '' }, /liveSessionId must be/],
      [{ parts: ['ok', ''] }, /parts must be/],
      [{ parts: 'p1' as never }, /parts must be/],
    ];
    for (const [change, re] of bad) expect(() => addFact(EMPTY_FACT_STATE, { ...fact('dir.x'), ...change } as NewFact)).toThrow(re);
    expect(() => addFact(EMPTY_FACT_STATE, null as never)).toThrow(FactError);
    expect(factProblem(fact('dir.x', { value: 'cw', parts: ['m1'] }))).toBeNull();
    expect(factProblem(fact('dir.x', { value: 2.5 }))).toBeNull();
  });

  it('view refuses a malformed binding or age setting rather than guessing', () => {
    expect(() => view(EMPTY_FACT_STATE, { ...BIND, boardId: '' }, { clock: clockAt(T0), liveSessionId: null })).toThrow(FactError);
    for (const maxAgeMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => view(EMPTY_FACT_STATE, BIND, { clock: clockAt(T0), liveSessionId: null, maxAgeMs })).toThrow(/maxAgeMs/);
    }
  });
});

describe('fact age with an injected clock (H28)', () => {
  it('dir.* and scale.* older than the configured age are stale; other roots do not age', () => {
    const s = withFacts(fact('dir.x'), fact('scale.x'), fact('outputs.spindle'), fact('homing.x'));
    const at = (now: number, maxAgeMs?: number) => view(s, BIND, { clock: clockAt(now), liveSessionId: SESSION, ...(maxAgeMs === undefined ? {} : { maxAgeMs }) });
    expect(DEFAULT_FACT_MAX_AGE_MS).toBe(30 * DAY_MS);
    const day30 = at(T0 + 30 * DAY_MS);
    expect(['dir.x', 'scale.x'].map((k) => day30.status(k))).toEqual(['valid', 'valid']);
    const past = at(T0 + 30 * DAY_MS + 1);
    expect(['dir.x', 'scale.x', 'outputs.spindle', 'homing.x'].map((k) => past.status(k))).toEqual(['stale', 'stale', 'valid', 'valid']);
    // A configured age.
    expect(at(T0 + 2 * DAY_MS, DAY_MS).status('dir.x')).toBe('stale');
    expect(at(T0 + 2 * DAY_MS, 3 * DAY_MS).status('dir.x')).toBe('valid');
  });

  it('a fact stamped in the future, or a clock that cannot be read, proves nothing', () => {
    const s = withFacts(fact('dir.x', { at: T0 + FUTURE_SKEW_MS + 1 }), fact('outputs.spindle', { at: T0 + FUTURE_SKEW_MS }));
    expect(statusIn(s, 'dir.x')).toBe('stale');
    expect(statusIn(s, 'outputs.spindle')).toBe('valid');
    expect(statusIn(withFacts(fact('homing.x')), 'homing.x', BIND, Number.NaN)).toBe('stale');
  });
});

describe('invalidate', () => {
  const triggerAt = (s: FactState, t: FactTrigger) => invalidate(s, t, clockAt(T0 + 5));

  it('a flash clears every fact on the board, keeps the record and the reason', () => {
    const s = triggerAt(withFacts(fact('dir.x'), fact('outputs.spindle')), { kind: 'flash', boardId: BOARD });
    expect(statusIn(s, 'dir.x')).toBe('needsReverify');
    expect(s.facts[0]?.invalidated).toEqual({ trigger: 'flash', at: T0 + 5 });
    // Another board's facts are untouched.
    const other = triggerAt(withFacts(fact('dir.x')), { kind: 'flash', boardId: 'other' });
    expect(statusIn(other, 'dir.x')).toBe('valid');
  });

  it('a flash without restore raises defaults-active, which blocks even facts added afterwards, until the restore reads back', () => {
    let s = triggerAt(withFacts(fact('dir.x')), { kind: 'flashWithoutRestore', boardId: BOARD });
    s = triggerAt(s, { kind: 'flashWithoutRestore', boardId: BOARD });
    expect(s.defaultsActive).toEqual([BOARD]);
    s = addFact(s, fact('homing.x'));
    const v = view(s, BIND, { clock: clockAt(T0), liveSessionId: SESSION });
    expect(v.defaultsActive).toBe(true);
    expect(v.status('homing.x')).toBe('needsReverify');
    s = triggerAt(s, { kind: 'settingsRestored', boardId: BOARD });
    expect(s.defaultsActive).toEqual([]);
    expect(statusIn(s, 'homing.x')).toBe('valid');
    expect(statusIn(s, 'dir.x')).toBe('needsReverify'); // the flash cleared it; re-adding is the only way back
  });

  it('a setting write clears what its overlay says and re-binds the rest to the new deviceHash', () => {
    const s0 = withFacts(fact('dir.x'), fact('scale.x'), fact('homing.y'), fact('switch.xmin'), fact('dir.y', { boundTo: { ...BIND, deviceHash: 'c'.repeat(64) } }));
    const s = triggerAt(s0, { kind: 'settingWritten', boardId: BOARD, dialectId: 'tinyg-en', key: '1tr', previousDeviceHash: HASH_A, newDeviceHash: HASH_B });
    const after = { ...BIND, deviceHash: HASH_B };
    expect(statusIn(s, 'scale.x', after)).toBe('needsReverify');
    expect(statusIn(s, 'homing.y', after)).toBe('needsReverify');
    expect(statusIn(s, 'dir.x', after)).toBe('valid');
    expect(statusIn(s, 'switch.xmin', after)).toBe('valid');
    // A fact bound to some other hash is not re-bound: it keeps failing the binding check.
    expect(statusIn(s, 'dir.y', after)).toBe('needsReverify');
    // An invalidated fact is never re-bound, even when it carries the previous hash, and keeps its first reason.
    const again = triggerAt(s, { kind: 'settingWritten', boardId: BOARD, dialectId: 'tinyg-en', key: 'mt', previousDeviceHash: HASH_A, newDeviceHash: HASH_B });
    const scale = again.facts.find((f) => f.key === 'scale.x');
    expect(scale?.invalidated).toEqual({ trigger: 'settingWritten', at: T0 + 5 });
    expect(scale?.boundTo.deviceHash).toBe(HASH_A);
  });

  it('a write clears root-level facts and every softlimits fact, not only the narrow keys its overlay names', () => {
    const keys = ['dir', 'homing', 'scale', 'softlimits', 'softlimits.x', 'softlimits.on'];
    let s = withFacts(...keys.map((k) => fact(k)));
    s = triggerAt(s, { kind: 'settingWritten', boardId: BOARD, dialectId: 'tinyg-en', key: '1po', previousDeviceHash: HASH_A, newDeviceHash: HASH_B });
    const afterPo = { ...BIND, deviceHash: HASH_B };
    expect(keys.map((k) => [k, statusIn(s, k, afterPo)])).toEqual([
      ['dir', 'needsReverify'],
      ['homing', 'needsReverify'],
      ['scale', 'valid'],
      ['softlimits', 'valid'],
      ['softlimits.x', 'valid'],
      ['softlimits.on', 'valid'],
    ]);
    const third = 'c'.repeat(64);
    s = triggerAt(s, { kind: 'settingWritten', boardId: BOARD, dialectId: 'tinyg-en', key: '1tr', previousDeviceHash: HASH_B, newDeviceHash: third });
    expect(keys.filter((k) => statusIn(s, k, { ...BIND, deviceHash: third }) === 'valid')).toEqual([]);
  });

  it('an unreviewed setting write clears every fact on the board', () => {
    const s = triggerAt(withFacts(fact('outputs.spindle'), fact('probe.polarity')), {
      kind: 'settingWritten',
      boardId: BOARD,
      dialectId: 'tinyg-440',
      key: 'xvm',
      previousDeviceHash: HASH_A,
      newDeviceHash: HASH_B,
    });
    expect(s.facts.every((f) => f.invalidated?.trigger === 'settingWritten')).toBe(true);
  });

  it('travel, offsets and reporting triggers clear exactly their rows', () => {
    const job = `job.${'e'.repeat(64)}.preflight`;
    const base = withFacts(fact('softlimits.on'), fact(job), fact('dir.x'));
    const valid = (s: FactState) => ['softlimits.on', job, 'dir.x'].filter((k) => statusIn(s, k) === 'valid');
    expect(valid(triggerAt(base, { kind: 'temporaryTravelWrite', boardId: BOARD }))).toEqual(['dir.x']);
    expect(valid(triggerAt(base, { kind: 'offsetsChanged', boardId: BOARD }))).toEqual(['softlimits.on', 'dir.x']);
    expect(valid(triggerAt(base, { kind: 'reportingNormalised', boardId: BOARD }))).toEqual(['softlimits.on', job, 'dir.x']);
  });

  it('a wiring change clears only facts that reference a changed part, on that machine', () => {
    const s0 = withFacts(fact('switch.xmin', { parts: ['sw-x'] }), fact('outputs.spindle', { parts: ['relay'] }), fact('dir.x'));
    const s = triggerAt(s0, { kind: 'wiringChanged', machineId: MACHINE_ID, parts: ['sw-x', 'unused'] });
    expect(['switch.xmin', 'outputs.spindle', 'dir.x'].map((k) => statusIn(s, k))).toEqual(['needsReverify', 'valid', 'valid']);
    const other = triggerAt(s0, { kind: 'wiringChanged', machineId: OTHER_MACHINE, parts: ['sw-x'] });
    expect(statusIn(other, 'switch.xmin')).toBe('valid');
  });

  it('deviceHash drift (changed by another program) marks every fact bound to another hash', () => {
    const s = triggerAt(withFacts(fact('dir.x'), fact('dir.y', { boundTo: { ...BIND, deviceHash: HASH_B } })), {
      kind: 'deviceHashDrift',
      boardId: BOARD,
      deviceHash: HASH_B,
    });
    expect(s.facts.map((f) => [f.key, f.invalidated?.trigger ?? null])).toEqual([
      ['dir.x', 'deviceHashDrift'],
      ['dir.y', null],
    ]);
  });

  it('T-S74 precursor: selecting another machine for the board clears dir, scale and homing of the old machine only', () => {
    const s0 = withFacts(fact('dir.x'), fact('scale.x'), fact('homing.x'), fact('outputs.spindle'));
    const s = triggerAt(s0, { kind: 'machineSelected', boardId: BOARD, machineId: OTHER_MACHINE });
    expect(['dir.x', 'scale.x', 'homing.x', 'outputs.spindle'].map((k) => statusIn(s, k))).toEqual(['needsReverify', 'needsReverify', 'needsReverify', 'valid']);
    // The new machine sees none of the old machine's facts.
    expect(view(s, { ...BIND, machineId: OTHER_MACHINE }, { clock: clockAt(T0), liveSessionId: SESSION }).entries).toEqual([]);
    // Re-selecting the same machine clears nothing.
    const same = triggerAt(s0, { kind: 'machineSelected', boardId: BOARD, machineId: MACHINE_ID });
    expect(same.facts.every((f) => f.invalidated === null)).toBe(true);
  });

  it('mechanical change clears dir and scale of that machine', () => {
    const s = triggerAt(withFacts(fact('dir.x'), fact('scale.y'), fact('homing.x')), { kind: 'mechanicalChange', machineId: MACHINE_ID });
    expect(['dir.x', 'scale.y', 'homing.x'].map((k) => statusIn(s, k))).toEqual(['needsReverify', 'needsReverify', 'valid']);
  });

  it('T-S22: after importing a profile for this machine, every fact of the machine needs re-verify, on every board', () => {
    const imported = importProfileText(JSON.stringify(v1File()));
    if (!imported.ok) throw new Error(imported.error.code);
    const s0 = withFacts(fact('dir.x'), fact('switch.xmin'), fact('outputs.spindle', { boundTo: { ...BIND, boardId: 'second-board' } }));
    const s = triggerAt(s0, { kind: 'profileImported', machineId: imported.profile.id });
    expect(s.facts.every((f) => f.invalidated?.trigger === 'profileImported')).toBe(true);
    expect(view(s, BIND, { clock: clockAt(T0), liveSessionId: SESSION }).entries.every((e) => e.status === 'needsReverify')).toBe(true);
    // The imported profile itself carried facts; none of them became a fact here.
    expect(imported.reverifyFactKeys).toContain('dir.x.verified');
    expect(s.facts.some((f) => f.key === 'dir.x.verified')).toBe(false);
  });
});

describe('property test (old P1-01)', () => {
  const ENKEYS = TINYG_EN_OVERLAY.map((o) => o.key);
  const TABLE_KEYS = [...SETTINGS_SCHEMAS['tinyg-en'].table.tokens.keys()];
  const AXES = ['x', 'y', 'z', 'a', 'b', 'c'];
  const keyArb = fc.oneof(
    fc.tuple(fc.constantFrom('dir', 'scale', 'homing', 'motor', 'softlimits'), fc.constantFrom(...AXES)).map(([r, a]) => `${r}.${a}`),
    fc.constantFrom('dir', 'scale', 'homing', 'softlimits', 'switch', 'job'),
    fc.constantFrom('softlimits.on', 'outputs.spindle', 'probe.polarity', 'config.units', `job.${'a'.repeat(64)}.preflight`, 'switch.xmin', 'switch.zmax'),
  );
  const writeArb = fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom(...ENKEYS) },
    { weight: 2, arbitrary: fc.constantFrom(...TABLE_KEYS) },
    { weight: 1, arbitrary: fc.string({ maxLength: 5 }) },
  );

  it('after any random sequence of setting changes, no fact whose invalidation pattern matches a changed key remains valid', () => {
    fc.assert(
      fc.property(fc.uniqueArray(keyArb, { minLength: 1, maxLength: 12 }), fc.array(writeArb, { minLength: 1, maxLength: 8 }), (keys, writes) => {
        let s = withFacts(...keys.map((k) => fact(k)));
        let hash = HASH_A;
        writes.forEach((key, i) => {
          const next = (i + 1).toString(16).padStart(64, '0');
          s = invalidate(s, { kind: 'settingWritten', boardId: BOARD, dialectId: 'tinyg-en', key, previousDeviceHash: hash, newDeviceHash: next }, clockAt(T0));
          hash = next;
        });
        const v = view(s, { ...BIND, deviceHash: hash }, { clock: clockAt(T0), liveSessionId: SESSION });
        for (const k of keys) {
          const cleared = writes.some((w) => settingInvalidates('tinyg-en', w).some((p) => patternMatches(p, k)));
          if (cleared) expect({ k, status: v.status(k) }).not.toEqual({ k, status: 'valid' });
          // And a fact no write touches survives every write (selective, not a blanket wipe).
          else expect({ k, status: v.status(k) }).toEqual({ k, status: 'valid' });
        }
      }),
      { numRuns: 500 },
    );
  });

  it('independent oracle: each §5.2 setting row clears every fact under the roots the table names, whatever the key shape', () => {
    // The OLD TOOLS_PLAN §5.2 table, written out here by hand rather than read from the overlay.
    const ROWS: [RegExp, string[]][] = [
      [/^[1-6](ma|po)$/u, ['dir', 'homing']],
      [/^[1-6](tr|sa|mi)$/u, ['scale', 'homing', 'softlimits']],
      [/^(st|[xyzabc]s[nx])$/u, ['switch', 'homing']],
      [/^[xyzabc]t[nm]$/u, ['softlimits']],
    ];
    const rowKeys = ENKEYS.filter((k) => ROWS.some(([re]) => re.test(k)));
    expect(rowKeys.length).toBeGreaterThan(30);
    const factArb = fc.oneof(
      fc.constantFrom('dir', 'homing', 'scale', 'softlimits', 'switch'),
      fc.tuple(fc.constantFrom('dir', 'homing', 'scale', 'softlimits', 'switch'), fc.constantFrom(...AXES, 'on', 'xmin', 'verified')).map(([r, a]) => `${r}.${a}`),
    );
    fc.assert(
      fc.property(fc.constantFrom(...rowKeys), fc.uniqueArray(factArb, { minLength: 1, maxLength: 10 }), (key, keys) => {
        const s = invalidate(
          withFacts(...keys.map((k) => fact(k))),
          { kind: 'settingWritten', boardId: BOARD, dialectId: 'tinyg-en', key, previousDeviceHash: HASH_A, newDeviceHash: HASH_B },
          clockAt(T0),
        );
        const roots = ROWS.find(([re]) => re.test(key))?.[1] ?? [];
        for (const k of keys) {
          if (roots.includes(k.split('.')[0] as string)) expect({ key, k, status: statusIn(s, k, { ...BIND, deviceHash: HASH_B }) }).not.toEqual({ key, k, status: 'valid' });
        }
      }),
      { numRuns: 500 },
    );
  });

  it('for any trigger sequence, a fact a rule cleared in scope never comes back valid without being re-added', () => {
    const triggerArb: fc.Arbitrary<FactTrigger> = fc.oneof(
      fc.constant<FactTrigger>({ kind: 'flash', boardId: BOARD }),
      fc.constant<FactTrigger>({ kind: 'temporaryTravelWrite', boardId: BOARD }),
      fc.constant<FactTrigger>({ kind: 'offsetsChanged', boardId: BOARD }),
      fc.constant<FactTrigger>({ kind: 'reportingNormalised', boardId: BOARD }),
      fc.constant<FactTrigger>({ kind: 'mechanicalChange', machineId: MACHINE_ID }),
      fc.constant<FactTrigger>({ kind: 'machineSelected', boardId: BOARD, machineId: OTHER_MACHINE }),
      fc.constant<FactTrigger>({ kind: 'settingsRestored', boardId: BOARD }),
      fc.constant<FactTrigger>({ kind: 'wiringChanged', machineId: MACHINE_ID, parts: ['p1'] }),
    );
    fc.assert(
      fc.property(fc.uniqueArray(keyArb, { minLength: 1, maxLength: 10 }), fc.array(triggerArb, { maxLength: 6 }), (keys, triggers) => {
        let s = withFacts(...keys.map((k) => fact(k, { parts: ['p1'] })));
        for (const t of triggers) s = invalidate(s, t, clockAt(T0));
        const v = view(s, BIND, { clock: clockAt(T0), liveSessionId: SESSION });
        for (const k of keys) {
          const cleared = triggers.some((t) => {
            const rule = INVALIDATION_RULES[t.kind];
            if (rule.clears === 'referencedParts') return true; // every fact here references p1
            return Array.isArray(rule.clears) && rule.clears.some((p) => patternMatches(p, k));
          });
          expect({ k, valid: v.status(k) === 'valid' }).toEqual({ k, valid: !cleared });
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('readFactState', () => {
  it('round-trips a stored state, drops malformed records and counts them', () => {
    const s = invalidate(withFacts(fact('dir.x'), fact('switch.xmin')), { kind: 'flashWithoutRestore', boardId: BOARD }, clockAt(T0));
    const stored = JSON.parse(JSON.stringify({ ...s, facts: [...s.facts, { key: 'dir.*' }, { ...s.facts[0], invalidated: { trigger: 'nope', at: 1 } }] }));
    const r = readFactState(stored);
    expect(r.dropped).toBe(2);
    expect(r.state).toEqual(s);
    expect(Object.isFrozen(r.state.facts[0])).toBe(true);
    const valid = readFactState(JSON.parse(JSON.stringify(withFacts(fact('dir.x'), fact('dir.x', { evidence: 'second' })))));
    expect(valid.state.facts.map((f) => f.evidence)).toEqual(['second']);
  });

  it('nothing stored is an empty state; an unreadable defaults-active list distrusts the whole state', () => {
    expect(readFactState(undefined)).toEqual({ state: EMPTY_FACT_STATE, dropped: 0 });
    expect(readFactState({ facts: 'x' })).toEqual({ state: EMPTY_FACT_STATE, dropped: 0 });
    const facts = JSON.parse(JSON.stringify(withFacts(fact('dir.x')).facts));
    expect(readFactState({ facts })).toEqual({ state: EMPTY_FACT_STATE, dropped: 1 });
    expect(readFactState({ facts, defaultsActive: [''] })).toEqual({ state: EMPTY_FACT_STATE, dropped: 1 });
    expect(readFactState({ facts: [null, { ...facts[0], invalidated: { trigger: 'flash', at: Number.NaN } }], defaultsActive: [] }).dropped).toBe(2);
  });
});
