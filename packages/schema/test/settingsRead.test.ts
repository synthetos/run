/**
 * ROADMAP P1-07: the allowlisted settings read, `deviceHash` and the drift
 * check (RUN_PLAN §7.2 steps 4-6; SAFETY §3 READING, H33).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { groupsOf } from '../src/settingsRead.ts';
import { boardSettingsFrom, canonicalSettings, deviceHash, isReadAllowed, settingsDrift, settingsReadGroups, settingsSchemaFor, type GroupAnswer } from '../src/index.ts';

const DIALECTS = ['tinyg-en', 'tinyg-440', 'tinyg-449-stock'] as const;

/** Answers for every group: each member reported as 1 (strings for `id`). */
function answers(dialectId: string, override: Record<string, Record<string, unknown>> = {}): Record<string, GroupAnswer> {
  const out: Record<string, GroupAnswer> = {};
  for (const g of settingsReadGroups(dialectId)) {
    const value: Record<string, unknown> = {};
    for (const m of g.members) {
      const key = g.token !== 'sys' && m.startsWith(g.token) ? m.slice(g.token.length) : m;
      value[key] = m === 'id' ? 'SIM-EN-0001' : 1;
    }
    out[g.token] = { value: { ...value, ...override[g.token] }, status: 0 };
  }
  return out;
}

describe('settingsReadGroups', () => {
  it('lists only groups the read allowlist allows, each explained, with its table members', () => {
    for (const d of DIALECTS) {
      const groups = settingsReadGroups(d);
      expect(groups.map((g) => g.token)).toEqual(['sys', '1', '2', '3', '4', 'x', 'y', 'z', 'a', 'b', 'c', 'p1', 'g54', 'g55', 'g56', 'g57', 'g58', 'g59', 'g28', 'g30']);
      const table = settingsSchemaFor(d).table;
      for (const g of groups) {
        expect(isReadAllowed(d, g.token)).toBe(true);
        expect(g.title.length).toBeGreaterThan(0);
        expect(g.explanation.length).toBeGreaterThan(20);
        expect(g.members).toEqual(table.members(g.token));
        expect(g.persisted).toBe(g.members.some((m) => table.tokens.get(m)?.persist === true));
      }
    }
    expect(settingsReadGroups('tinyg-en').find((g) => g.token === 'x')?.members).toContain('xtm');
    expect(settingsReadGroups('tinyg-en').find((g) => g.token === 'g28')?.persisted).toBe(false);
  });

  it('never lists the side-effect tokens (md, me, clear) or a group the allowlist refuses', () => {
    for (const d of DIALECTS) {
      const tokens = settingsReadGroups(d).map((g) => g.token);
      for (const bad of ['md', 'me', 'clear', 'clr', 'alarm', 'jog']) expect(tokens).not.toContain(bad);
    }
  });

  it('skips a group the allowlist refuses or the table does not have', () => {
    const table = settingsSchemaFor('tinyg-en').table;
    const noX = groupsOf(table, (t) => t !== 'x').map((g) => g.token);
    expect(noX).not.toContain('x');
    expect(noX).toContain('y');
    const empty = { ...table, members: (g: string) => (g === 'y' ? [] : table.members(g)) };
    expect(groupsOf(empty, () => true).map((g) => g.token)).not.toContain('y');
  });

  it('has no groups for a dialect without a table or allowlist (g2core)', () => {
    expect(settingsReadGroups('g2core')).toEqual([]);
    expect(boardSettingsFrom('g2core', {})).toEqual({ settings: {}, missing: [] });
  });
});

describe('boardSettingsFrom', () => {
  it('flattens group answers into table tokens, table-driven', () => {
    const read = boardSettingsFrom('tinyg-en', answers('tinyg-en', { x: { vm: 16000, bogus: 5 }, sys: { id: 'SIM-EN-0001' } }));
    expect(read.missing).toEqual([]);
    expect(read.settings['xvm']).toBe(16000);
    expect(read.settings['1ma']).toBe(1);
    expect(read.settings['g54x']).toBe(1);
    expect(read.settings['fb']).toBe(1);
    expect(read.settings['id']).toBe('SIM-EN-0001');
    // A member the table does not list under that group is dropped, never guessed.
    expect(read.settings).not.toHaveProperty('xbogus');
    expect(read.settings).not.toHaveProperty('bogus');
  });

  it('drops non-finite and non-scalar values', () => {
    const read = boardSettingsFrom('tinyg-en', answers('tinyg-en', { x: { vm: Number.NaN, fr: null, am: [1] } }));
    expect(read.settings).not.toHaveProperty('xvm');
    expect(read.settings).not.toHaveProperty('xfr');
    expect(read.settings).not.toHaveProperty('xam');
  });

  it('reports groups not read, read with an error, or answered with a non-object as missing', () => {
    const a = answers('tinyg-en');
    delete a['x'];
    a['y'] = { value: { vm: 1 }, status: 100 };
    a['z'] = { value: 3, status: 0 };
    a['a'] = { value: [1], status: 0 };
    a['b'] = { value: null, status: 0 };
    expect(boardSettingsFrom('tinyg-en', a).missing).toEqual(['x', 'y', 'z', 'a', 'b']);
  });
});

describe('deviceHash', () => {
  it('is SHA-256 of the canonical text, over persisted keys only, independent of key order', async () => {
    const settings = { xvm: 16000, yvm: 12000, stat: 3, g28x: 5 };
    const text = canonicalSettings('tinyg-en', settings);
    expect(text).toBe('["tinyg-en",[["xvm",16000],["yvm",12000]]]');
    const hash = await deviceHash('tinyg-en', settings);
    expect(hash).toBe(createHash('sha256').update(text).digest('hex'));
    expect(await deviceHash('tinyg-en', { yvm: 12000, xvm: 16000 })).toBe(hash);
    // Live values and unpersisted keys never change the hash.
    expect(await deviceHash('tinyg-en', { yvm: 12000, xvm: 16000, stat: 5, g28x: 9 })).toBe(hash);
  });

  it('changes when any persisted setting changes, and between dialects', async () => {
    const a = await deviceHash('tinyg-en', { xvm: 16000 });
    expect(await deviceHash('tinyg-en', { xvm: 16001 })).not.toBe(a);
    expect(await deviceHash('tinyg-en', { xvm: '16000' })).not.toBe(a);
    expect(await deviceHash('tinyg-440', { xvm: 16000 })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('settingsDrift (NEEDS_REVIEW)', () => {
  const board = { xvm: 16000, xtm: 300, stat: 1 };

  it('no expectation, or a matching one, is not drift', () => {
    expect(settingsDrift('tinyg-en', { deviceHash: null }, board, 'h')).toEqual({ drift: false, reasons: [], diffs: [] });
    expect(settingsDrift('tinyg-en', { deviceHash: 'h', settings: { xvm: 16000, xtm: 300, stat: 4 } }, board, 'h').drift).toBe(false);
  });

  it('a different hash is drift', () => {
    expect(settingsDrift('tinyg-en', { deviceHash: 'old' }, board, 'new')).toEqual({ drift: true, reasons: ['hash'], diffs: [] });
  });

  it('lists key-level differences to the previous read (changed, added, removed), persisted keys only', () => {
    const r = settingsDrift('tinyg-en', { deviceHash: 'old', settings: { xvm: 12000, ytm: 200, stat: 9 } }, board, 'new');
    expect(r.reasons).toEqual(['hash', 'previous']);
    expect(r.diffs).toEqual([
      { key: 'xtm', expected: null, board: 300, source: 'previous' },
      { key: 'xvm', expected: 12000, board: 16000, source: 'previous' },
      { key: 'ytm', expected: 200, board: null, source: 'previous' },
    ]);
  });

  it('compares a profile draft at the table precision', () => {
    const precision = settingsSchemaFor('tinyg-en').table.tokens.get('xtm')?.precision ?? 0;
    const close = 300 + 10 ** -(precision + 2);
    expect(settingsDrift('tinyg-en', { deviceHash: null, draft: { xtm: close, stat: 7 } }, board, 'h').drift).toBe(false);
    const r = settingsDrift('tinyg-en', { deviceHash: null, draft: { xtm: 250, ytm: 100 } }, board, 'h');
    expect(r).toEqual({
      drift: true,
      reasons: ['draft'],
      diffs: [
        { key: 'xtm', expected: 250, board: 300, source: 'draft' },
        { key: 'ytm', expected: 100, board: null, source: 'draft' },
      ],
    });
    expect(settingsDrift('tinyg-en', { deviceHash: null, draft: { id: 1 } }, { id: 'x' }, 'h').drift).toBe(false);
    expect(settingsDrift('tinyg-en', { deviceHash: null, draft: { ja: 1 } }, { ja: 'x' }, 'h').reasons).toEqual(['draft']);
  });
});
