/**
 * Read allowlists (ROADMAP P0-09 acceptance; PN §12.3; RUN_PLAN §8.2;
 * SAFETY H37, T-S38 precursor).
 */
import { PROBE_STEPS } from '@synthetos/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  READ_ALLOWLISTS,
  ReadNotAllowedError,
  SETTINGS_SCHEMAS,
  defineReadAllowlist,
  getLine,
  getLineFor,
  getterClass,
  isReadAllowed,
  readAllowlistFor,
  readDecision,
  readDecisionFor,
} from '../src/index.ts';
import type { HilTable, ReadAllowlist, TinyGDialectId } from '../src/index.ts';

const IDS = Object.keys(READ_ALLOWLISTS) as TinyGDialectId[];
const CASES: readonly [TinyGDialectId, ReadAllowlist, HilTable][] = IDS.map((id) => [id, READ_ALLOWLISTS[id], SETTINGS_SCHEMAS[id].table]);

/** Table tokens neither allowed nor denied (RUN_PLAN §8.2: must be empty). */
function unclassified(list: ReadAllowlist, table: HilTable): string[] {
  return [...table.tokens.keys()].filter((t) => !list.allow.has(t) && !list.deny.has(t) && ![...list.denyPrefixes.keys()].some((p) => t.startsWith(p)));
}

/** Allowlisted tokens the table does not have (RUN_PLAN §8.2: must be empty). */
function missingFromTable(list: ReadAllowlist, table: HilTable): string[] {
  return [...list.allow].filter((t) => !table.tokens.has(t));
}

describe('RUN_PLAN §8.2: every vendored token is classified, every allowed token exists', () => {
  it.each(CASES)('%s: no table token is unclassified', (_id, list, table) => {
    expect(unclassified(list, table)).toEqual([]);
  });

  it.each(CASES)('%s: no allowlisted token is missing from the table', (_id, list, table) => {
    expect(missingFromTable(list, table)).toEqual([]);
  });

  it.each(CASES)('%s: the allowlist is checked against its own table', (id, list, table) => {
    expect(list.dialectId).toBe(id);
    expect(list.table).toBe(table.source.name);
  });

  it('the checks catch a firmware bump that adds a token, and a stale allowlist entry', () => {
    const [, list, table] = CASES[0] as (typeof CASES)[number];
    const bumped: HilTable = {
      ...table,
      tokens: new Map([...table.tokens, ['zzz', { token: 'zzz', group: '', type: 'integer', precision: 0, persist: false, getter: 'get_ui8', setter: 'set_nul' }]]),
    };
    expect(unclassified(list, bumped)).toEqual(['zzz']);
    const shrunk: HilTable = { ...table, tokens: new Map([...table.tokens].filter(([t]) => t !== 'xvm')) };
    expect(missingFromTable(list, shrunk)).toEqual(['xvm']);
  });
});

describe('allowed reads have no side effects', () => {
  it.each(CASES)('%s: every allowed token has a value, stub or group getter', (_id, list, table) => {
    for (const token of list.allow) {
      const cls = getterClass(table.tokens.get(token)?.getter ?? '');
      expect(['value', 'stub', 'group'], `${token}: ${String(cls)}`).toContain(cls);
    }
  });

  it.each(CASES)('%s: a group is allowed only when every member is (a group GET runs every member getter)', (_id, list, table) => {
    for (const token of list.allow) {
      if (table.tokens.get(token)?.getter !== 'get_grp') continue;
      for (const member of table.members(token)) expect(list.allow.has(member), `${token} -> ${member}`).toBe(true);
    }
  });

  it.each(CASES)('%s: every token whose getter acts, prints text or answers several times is denied', (_id, list, table) => {
    for (const def of table.tokens.values()) {
      const cls = getterClass(def.getter);
      if (cls === 'sideEffect' || cls === 'text' || cls === 'uberGroup' || cls === 'constant') {
        expect(readDecision(list, def.token).allowed, `${def.token} (${def.getter})`).toBe(false);
      }
    }
  });

  it('groups whose members include a denied token are refused (jog)', () => {
    for (const [, list, table] of CASES) {
      expect(table.members('jog').length).toBeGreaterThan(0);
      expect(readDecision(list, 'jog').allowed).toBe(false);
    }
  });
});

const NEVER_READ = ['adc3', 'md', 'me', 'alarm', 'panic', 'shutd', 'er', 'clear', 'clr', 'boot', 'defa', 'test', 'qf', 'help', 'h', 'jog', 'jogx', 'jogy', 'jogz', 'joga'];

describe('denied tokens', () => {
  it.each(IDS)('adc3, md and me are denied on %s', (id) => {
    for (const token of ['adc3', 'md', 'me']) {
      expect(isReadAllowed(id, token)).toBe(false);
      expect(READ_ALLOWLISTS[id].deny.has(token), token).toBe(true);
      expect(() => getLineFor(id, token)).toThrow(ReadNotAllowedError);
    }
  });

  it.each(IDS)('the PN §12.3 deny list and jog* are never read on %s', (id) => {
    for (const token of NEVER_READ) {
      const decision = readDecisionFor(id, token);
      expect(decision.allowed, token).toBe(false);
      if (!decision.allowed) expect(decision.reason.length).toBeGreaterThan(10);
    }
  });

  it('a denied token is refused in any letter case or with whitespace, and nothing is normalised into an allowed read', () => {
    const list = READ_ALLOWLISTS['tinyg-en'];
    for (const token of ['MD', 'Md', 'mE', 'ADC3', 'JOGX', 'Jog', 'CLEAR']) expect(readDecision(list, token).allowed, token).toBe(false);
    for (const token of [' md', 'md ', 'XVM', ' xvm', 'xvm\n', '', '{"md":null}', 'x"', '__proto__']) expect(readDecision(list, token).allowed, JSON.stringify(token)).toBe(false);
    expect(readDecision(list, 'MD')).toEqual({ allowed: false, reason: list.deny.get('md') });
  });

  it('a token on no list is refused with a reason naming the dialect', () => {
    expect(readDecision(READ_ALLOWLISTS['tinyg-440'], 'spep')).toEqual({ allowed: false, reason: '"spep" is not on the tinyg-440 read allowlist' });
  });

  it('fuzz: only allowlisted tokens are ever allowed, on every dialect', () => {
    const tokens = fc.oneof(
      fc.string({ maxLength: 8 }),
      fc.constantFrom(...NEVER_READ, ...[...READ_ALLOWLISTS['tinyg-en'].allow].slice(0, 50)),
    );
    fc.assert(
      fc.property(fc.constantFrom(...IDS), tokens, (id, token) => {
        const list = READ_ALLOWLISTS[id];
        const allowed = isReadAllowed(id, token);
        expect(allowed).toBe(list.allow.has(token));
        if (NEVER_READ.includes(token.toLowerCase())) expect(allowed).toBe(false);
        if (allowed) expect(getLine(list, token)).toBe(`{"${token}":null}`);
        else expect(() => getLine(list, token)).toThrow(ReadNotAllowedError);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('the capability probe reads only what every dialect allows', () => {
  it.each(CASES)('%s: each probe key is allowed where the table has it, and never denied', (_id, list, table) => {
    for (const step of PROBE_STEPS) {
      expect(list.deny.has(step.key), step.key).toBe(false);
      if (table.tokens.has(step.key)) expect(list.allow.has(step.key), step.key).toBe(true);
    }
  });
});

describe('getLine and lookups', () => {
  it('builds the single-key GET for an allowed token, and a group read', () => {
    expect(getLineFor('tinyg-en', 'stat')).toBe('{"stat":null}');
    expect(getLineFor('tinyg-en', 'x')).toBe('{"x":null}');
    expect(getLineFor('tinyg-449-stock', 'sys')).toBe('{"sys":null}');
  });

  it('throws a ReadNotAllowedError that names the token, dialect and reason', () => {
    try {
      getLineFor('tinyg-en', 'md');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReadNotAllowedError);
      const err = e as ReadNotAllowedError;
      expect(err.token).toBe('md');
      expect(err.dialectId).toBe('tinyg-en');
      expect(err.name).toBe('ReadNotAllowedError');
      expect(err.message).toContain('de-energizes');
    }
  });

  it('a dialect without an allowlist (g2core) allows nothing', () => {
    expect(isReadAllowed('g2core-edge', 'sr')).toBe(false);
    expect(readDecisionFor('g2core-edge', 'sr')).toEqual({ allowed: false, reason: 'no read allowlist for dialect "g2core-edge"' });
    expect(() => readAllowlistFor('g2core-edge')).toThrow(/no read allowlist/);
    expect(() => getLineFor('toString', 'sr')).toThrow(/no read allowlist/);
    expect(readAllowlistFor('tinyg-440')).toBe(READ_ALLOWLISTS['tinyg-440']);
  });

  it('the lists cannot be changed at runtime', () => {
    const list = READ_ALLOWLISTS['tinyg-en'];
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(READ_ALLOWLISTS)).toBe(true);
    expect('add' in list.allow).toBe(false);
    expect('set' in list.deny).toBe(false);
    expect(() => {
      (list as { allow: unknown }).allow = new Set(['md']);
    }).toThrow(TypeError);
  });
});

describe('defineReadAllowlist refuses contradictions', () => {
  const spec = { dialectId: 'tinyg-en' as const, table: 'den' as const, allow: ['stat'], deny: { md: 'motors off' }, denyPrefixes: { jog: 'jogs' } };

  it('builds a valid list', () => {
    const list = defineReadAllowlist(spec);
    expect([...list.allow]).toEqual(['stat']);
    expect(list.deny.get('md')).toBe('motors off');
    expect(list.denyPrefixes.get('jog')).toBe('jogs');
  });

  it('a token allowed twice', () => {
    expect(() => defineReadAllowlist({ ...spec, allow: ['stat', 'stat'] })).toThrow(/stat is allowed twice/);
  });

  it('a token both allowed and denied', () => {
    expect(() => defineReadAllowlist({ ...spec, allow: ['md'] })).toThrow(/md is both allowed and denied/);
  });

  it('a token allowed but covered by a deny prefix', () => {
    expect(() => defineReadAllowlist({ ...spec, allow: ['jogx'] })).toThrow(/jogx is allowed but denied by the prefix jog/);
  });

  it('a deny entry without a reason or token', () => {
    expect(() => defineReadAllowlist({ ...spec, deny: { md: ' ' } })).toThrow(/needs a token and a reason/);
    expect(() => defineReadAllowlist({ ...spec, denyPrefixes: { '': 'x' } })).toThrow(/needs a token and a reason/);
  });
});
