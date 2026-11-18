import { describe, expect, it } from 'vitest';
import { EMPTY_SETUP_RECORD, readSetup } from '../src/index.ts';
import { stock } from './fixtures.ts';

const STOCK = stock();

describe('readSetup', () => {
  it('reads the empty record and a full one, frozen and detached', () => {
    expect(readSetup(EMPTY_SETUP_RECORD).ok).toBe(true);
    const full = { ...EMPTY_SETUP_RECORD, dismissed: true, step: 5, done: [1, 2, 3, 4], homing: 'none', stock: STOCK, toolId: 'demo.quarter-2f', machineId: 'm-1', projectId: 'p-1', updatedAt: '2026-11-18T10:00:00.000Z' };
    const r = readSetup(full);
    expect(r).toEqual({ ok: true, value: full });
    if (r.ok) {
      expect(r.value).not.toBe(full);
      expect(Object.isFrozen(r.value.done)).toBe(true);
    }
  });

  it.each([
    ['wrong id', { ...EMPTY_SETUP_RECORD, id: 'other' }, '/id'],
    ['wrong format', { ...EMPTY_SETUP_RECORD, v: 2 }, '/v'],
    ['step out of range', { ...EMPTY_SETUP_RECORD, step: 8 }, '/step'],
    ['step zero', { ...EMPTY_SETUP_RECORD, step: 0 }, '/step'],
    ['done repeats', { ...EMPTY_SETUP_RECORD, done: [2, 2] }, '/done'],
    ['done out of range', { ...EMPTY_SETUP_RECORD, done: [9] }, '/done'],
    ['bad homing', { ...EMPTY_SETUP_RECORD, homing: 'maybe' }, '/homing'],
    ['bad stock', { ...EMPTY_SETUP_RECORD, stock: { width: 1 } }, '/stock'],
    ['bad dismissed', { ...EMPTY_SETUP_RECORD, dismissed: 'no' }, '/dismissed'],
    ['bad toolId', { ...EMPTY_SETUP_RECORD, toolId: 4 }, '/toolId'],
    ['empty machineId', { ...EMPTY_SETUP_RECORD, machineId: '' }, '/machineId'],
    ['bad date', { ...EMPTY_SETUP_RECORD, updatedAt: 'yesterday' }, '/updatedAt'],
    ['unknown field', { ...EMPTY_SETUP_RECORD, extra: 1 }, '/extra'],
    ['not an object', 3, ''],
  ])('refuses %s', (_name, value, path) => {
    const r = readSetup(value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain(path);
  });

  it('is far under the record size limit', () => {
    expect(new TextEncoder().encode(JSON.stringify({ ...EMPTY_SETUP_RECORD, stock: STOCK })).length).toBeLessThan(2048);
  });
});
