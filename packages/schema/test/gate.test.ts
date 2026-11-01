/**
 * The gate DSL (ROADMAP TB-01; old P1-01): parsed and evaluated purely, and
 * fail-closed: only valid facts and recorded overrides open a gate.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EMPTY_FACT_STATE, GATE_MAX_DEPTH, GATE_MAX_LENGTH, GateSyntaxError, addFact, checkGate, evaluateGate, parseGate, view } from '../src/index.ts';
import type { FactBinding, FactState, GateContext, NewFact } from '../src/index.ts';
import { HASH_A, MACHINE_ID } from './fixtures/profiles.ts';

const T0 = Date.UTC(2026, 10, 1);
const BIND: FactBinding = { machineId: MACHINE_ID, boardId: 'b1', fb: 450.01, deviceHash: HASH_A };
const SHA = 'a'.repeat(64);
const fact = (key: string, extra: Partial<NewFact> = {}): NewFact => ({
  key,
  value: true,
  by: 'tool',
  evidence: '',
  at: T0,
  boundTo: BIND,
  ...(key.startsWith('switch') ? { liveSessionId: 's1' } : {}),
  ...extra,
});
const ctx = (state: FactState, params: GateContext['params'] = {}, overrides: string[] = [], now = T0): GateContext => ({
  facts: view(state, BIND, { clock: () => now, liveSessionId: 's1' }),
  overrides: new Set(overrides),
  params,
});
const facts = (...keys: string[]) => keys.map((k) => fact(k)).reduce(addFact, EMPTY_FACT_STATE);

/** The run gate of OLD TOOLS_PLAN §5.2, written in the DSL. */
const RUN = 'all(fact(dir.<axesInJob>), fact(scale.<axesInJob>), any(fact(homing.<axesInJob>), override(run-unhomed)), fact(outputs.spindle), fact(job.<sha>.preflight))';

describe('parseGate', () => {
  it('parses the four operators into a frozen tree', () => {
    const g = parseGate(' all( fact(dir.x) ,\n any(fact(homing.<axis>), override(run-unhomed)) ) ');
    expect(g).toEqual({
      op: 'all',
      args: [
        { op: 'fact', template: 'dir.x' },
        { op: 'any', args: [{ op: 'fact', template: 'homing.<axis>' }, { op: 'override', name: 'run-unhomed' }] },
      ],
    });
    expect(Object.isFrozen(g)).toBe(true);
    expect(parseGate(RUN).op).toBe('all');
  });

  it('refuses anything outside the grammar with a typed error and its offset', () => {
    const bad: [string, RegExp][] = [
      ['', /unknown operator ""/],
      ['not(fact(dir.x))', /unknown operator "not"/],
      ['true', /unknown operator "true"/],
      ['fact', /expected "\("/],
      ['all()', /unknown operator ""/],
      ['all(fact(dir.x)', /expected "\)"/],
      ['fact(dir.*)', /malformed fact template "dir\.\*"/],
      ['fact(<root>.x)', /malformed fact template/],
      ['fact(colour.x)', /malformed fact template/],
      ['fact(dir.<bad-param>)', /malformed fact template/],
      ['override(Run Unhomed)', /malformed override name/],
      ['fact(dir.x) fact(dir.y)', /unexpected text after the gate/],
      ['fact(dir.x)(', /unexpected text/],
    ];
    for (const [src, re] of bad) {
      expect(() => parseGate(src)).toThrow(GateSyntaxError);
      expect(() => parseGate(src)).toThrow(re);
    }
    try {
      parseGate('all(fact(dir.x), oops(1))');
      expect.unreachable();
    } catch (e) {
      expect((e as GateSyntaxError).offset).toBe(17);
    }
  });

  it('bounds length and nesting', () => {
    expect(() => parseGate(`fact(dir.x)${' '.repeat(GATE_MAX_LENGTH)}`)).toThrow(/at most/);
    expect(() => parseGate(42 as unknown as string)).toThrow(/at most/);
    const nest = (n: number) => `${'all('.repeat(n - 1)}fact(dir.x)${')'.repeat(n - 1)}`;
    expect(() => parseGate(nest(GATE_MAX_DEPTH))).not.toThrow();
    expect(() => parseGate(nest(GATE_MAX_DEPTH + 1))).toThrow(/nested deeper/);
  });

  it('never throws anything but GateSyntaxError on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (s) => {
        try {
          parseGate(s);
        } catch (e) {
          expect(e).toBeInstanceOf(GateSyntaxError);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('evaluateGate', () => {
  it('the run gate opens only when every required fact is valid', () => {
    const params = { axesInJob: ['x', 'y'], sha: SHA };
    const all = facts('dir.x', 'dir.y', 'scale.x', 'scale.y', 'homing.x', 'homing.y', 'outputs.spindle', `job.${SHA}.preflight`);
    expect(checkGate(RUN, ctx(all, params))).toEqual({ ok: true, unmet: [] });
    const missing = facts('dir.x', 'scale.x', 'scale.y', 'homing.x', 'homing.y', 'outputs.spindle', `job.${SHA}.preflight`);
    expect(checkGate(RUN, ctx(missing, params))).toEqual({ ok: false, unmet: [{ kind: 'fact', key: 'dir.y', status: 'absent' }] });
  });

  it('an overridable requirement opens with a recorded override, and reports both alternatives when neither holds', () => {
    const params = { axesInJob: ['x'], sha: SHA };
    const unhomed = facts('dir.x', 'scale.x', 'outputs.spindle', `job.${SHA}.preflight`);
    expect(checkGate(RUN, ctx(unhomed, params)).unmet).toEqual([
      { kind: 'fact', key: 'homing.x', status: 'absent' },
      { kind: 'override', name: 'run-unhomed' },
    ]);
    expect(checkGate(RUN, ctx(unhomed, params, ['run-unhomed'])).ok).toBe(true);
    // An override for something else does not help.
    expect(checkGate(RUN, ctx(unhomed, params, ['jog-unverified'])).ok).toBe(false);
  });

  it('only valid facts count: stale, session recheck and needs re-verify keep the gate closed', () => {
    const old = addFact(EMPTY_FACT_STATE, fact('dir.x'));
    expect(checkGate('fact(dir.x)', ctx(old, {}, [], T0 + 31 * 24 * 3600 * 1000)).unmet).toEqual([{ kind: 'fact', key: 'dir.x', status: 'stale' }]);
    const sw = addFact(EMPTY_FACT_STATE, fact('switch.xmin', { liveSessionId: 'old-session' }));
    expect(checkGate('fact(switch.xmin)', ctx(sw)).unmet).toEqual([{ kind: 'fact', key: 'switch.xmin', status: 'sessionRecheck' }]);
    const other = addFact(EMPTY_FACT_STATE, fact('dir.x', { boundTo: { ...BIND, fb: 440.21 } }));
    expect(checkGate('fact(dir.x)', ctx(other)).unmet).toEqual([{ kind: 'fact', key: 'dir.x', status: 'needsReverify' }]);
  });

  it('a gate value built in code that the grammar does not allow is never met (an empty all() would be vacuously true)', () => {
    const c = ctx(facts('dir.x'), {}, ['run-unhomed']);
    const bad = [
      { op: 'all', args: [] },
      { op: 'any', args: [] },
      { op: 'all', args: [{ op: 'fact', template: 'dir.x' }, { op: 'any', args: [] }] },
      { op: 'any', args: [{ op: 'all', args: [] }] },
      { op: 'fact', template: 'dir.*' },
      { op: 'override', name: 'Run Unhomed' },
      { op: 'not', args: [{ op: 'fact', template: 'dir.y' }] },
      null,
    ];
    for (const g of bad) {
      const r = evaluateGate(g as never, c);
      expect({ g, ok: r.ok }).toEqual({ g, ok: false });
      expect(r.unmet.some((u) => u.kind === 'malformedGate')).toBe(true);
    }
    expect(evaluateGate({ op: 'all', args: [{ op: 'fact', template: 'dir.x' }] }, c).ok).toBe(true);
  });

  it('fails closed on a missing, empty or malformed parameter', () => {
    const g = parseGate('fact(homing.<axesInJob>)');
    const s = facts('homing.x');
    expect(evaluateGate(g, ctx(s, {})).unmet).toEqual([{ kind: 'param', template: 'homing.<axesInJob>', param: 'axesInJob', problem: 'missing' }]);
    expect(evaluateGate(g, ctx(s, { axesInJob: [] })).unmet).toEqual([{ kind: 'param', template: 'homing.<axesInJob>', param: 'axesInJob', problem: 'empty' }]);
    for (const v of [['*'], ['x.y'], ['X'], [''], '*', [7 as unknown as string]]) {
      expect(evaluateGate(g, ctx(s, { axesInJob: v })).unmet).toEqual([{ kind: 'param', template: 'homing.<axesInJob>', param: 'axesInJob', problem: 'malformed' }]);
    }
    // Inherited properties are not parameters.
    expect(evaluateGate(parseGate('fact(homing.<toString>)'), ctx(s, {})).unmet[0]).toMatchObject({ problem: 'missing' });
    expect(evaluateGate(g, ctx(s, { axesInJob: 'x' }))).toEqual({ ok: true, unmet: [] });
  });

  it('expands several list parameters to every combination', () => {
    const g = parseGate('fact(switch.<axis>.<end>)');
    const s = ['switch.x.min', 'switch.x.max', 'switch.y.min'].map((k) => fact(k)).reduce(addFact, EMPTY_FACT_STATE);
    expect(evaluateGate(g, ctx(s, { axis: ['x', 'y'], end: ['min', 'max'] })).unmet).toEqual([{ kind: 'fact', key: 'switch.y.max', status: 'absent' }]);
  });

  it('property: a gate with no override is never met while any fact it names is not valid', () => {
    const keyArb = fc.constantFrom('dir.x', 'dir.y', 'scale.x', 'homing.x', 'outputs.spindle');
    const gateArb = fc.letrec((tie) => ({
      gate: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        keyArb.map((k) => `fact(${k})`),
        fc.array(tie('gate') as fc.Arbitrary<string>, { minLength: 1, maxLength: 3 }).map((a) => `all(${a.join(',')})`),
      ),
    })).gate as fc.Arbitrary<string>;
    fc.assert(
      fc.property(gateArb, fc.subarray(['dir.x', 'dir.y', 'scale.x', 'homing.x', 'outputs.spindle']), (src, present) => {
        const s = present.map((k) => fact(k)).reduce(addFact, EMPTY_FACT_STATE);
        const named = [...src.matchAll(/fact\(([^)]+)\)/g)].map((m) => m[1] as string);
        expect(checkGate(src, ctx(s)).ok).toBe(named.every((k) => present.includes(k)));
      }),
      { numRuns: 300 },
    );
  });
});
