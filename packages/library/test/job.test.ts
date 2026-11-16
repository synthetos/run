import { describe, expect, it } from 'vitest';
import { isBed, isJob } from '../src/index.ts';
import { fixture, stock } from './fixtures.ts';
import { AT, HASH, bed, job } from './recordFixtures.ts';

const jobWith = (part: 'setup' | 'placement', overrides: Record<string, unknown>) => {
  const base = job();
  return isJob({ ...base, [part]: { ...base[part], ...overrides } });
};

describe('isBed', () => {
  it('reads a bed and refuses each broken part', () => {
    expect(isBed(bed())).toBe(true);
    expect(isBed(bed({ outline: [[0, 0], [10, 0], [10, 10]] }))).toBe(true);
    expect(isBed(null)).toBe(false);
    expect(isBed(bed({ revision: '1' }))).toBe(false);
    expect(isBed(bed({ width: Number.NaN }))).toBe(false);
    expect(isBed(bed({ depth: undefined }))).toBe(false);
    expect(isBed(bed({ thickness: null }))).toBe(false);
    expect(isBed(bed({ outline: [[0]] }))).toBe(false);
    expect(isBed(bed({ outline: 'rect' }))).toBe(false);
    expect(isBed(bed({ holes: [[0, 0]] }))).toBe(false);
    expect(isBed(bed({ holes: {} }))).toBe(false);
    expect(isBed(bed({ toMachine: { x: 0, y: 0 } }))).toBe(false);
    expect(isBed(bed({ toMachine: [] }))).toBe(false);
    expect(isBed(bed({ source: { note: 'x' } }))).toBe(false);
    expect(isBed(bed({ source: null }))).toBe(false);
    expect(isBed(bed({ savedAt: 0 }))).toBe(false);
  });
});

describe('isJob', () => {
  it('reads a job with every optional part present or absent', () => {
    expect(isJob(job())).toBe(true);
    expect(isJob(job({ projectId: null, file: null, machine: null }))).toBe(true);
    expect(jobWith('setup', { fixture: fixture(), clamps: [{ kind: 'toe', x: 0, y: 0, w: 10, d: 10, h: 5 }], stockOutline: { outline: [[0, 0], [1, 0]], holes: [[0, 0, 1]], source: { file: 'a.dxf', kind: 'dxf', hash: 'h' } } })).toBe(true);
    expect(jobWith('placement', { offset: { x: 1, y: 2 }, datumFrom: { kind: 'file', hash: HASH }, zeroFrom: 'machine', plannedZero: { x: 0, y: 0, z: 0 } })).toBe(true);
    expect(jobWith('placement', { offset: { x: 1, y: 2, z: 3 }, datumFrom: { kind: 'user', hash: null } })).toBe(true);
  });

  it('refuses a broken head, file or machine', () => {
    expect(isJob(undefined)).toBe(false);
    expect(isJob(job({ v: 2 }))).toBe(false);
    expect(isJob(job({ id: 1 }))).toBe(false);
    expect(isJob(job({ name: null }))).toBe(false);
    expect(isJob(job({ revision: '1' }))).toBe(false);
    expect(isJob(job({ projectId: 1 }))).toBe(false);
    expect(isJob(job({ createdAt: 1 }))).toBe(false);
    expect(isJob(job({ updatedAt: undefined }))).toBe(false);
    const file = job().file!;
    expect(isJob(job({ file: 'plate.nc' }))).toBe(false);
    expect(isJob(job({ file: { ...file, projectId: 1 } }))).toBe(false);
    expect(isJob(job({ file: { ...file, fileId: 1 } }))).toBe(false);
    expect(isJob(job({ file: { ...file, name: 1 } }))).toBe(false);
    expect(isJob(job({ file: { ...file, hash: 1 } }))).toBe(false);
    expect(isJob(job({ file: { ...file, size: '10' } }))).toBe(false);
    expect(isJob(job({ machine: 'shapeoko' }))).toBe(false);
    expect(isJob(job({ machine: { id: 1, revision: 1, name: 'x' } }))).toBe(false);
    expect(isJob(job({ machine: { id: 'm', revision: 'one', name: 'x' } }))).toBe(false);
    expect(isJob(job({ machine: { id: 'm', revision: 1, name: 1 } }))).toBe(false);
  });

  it('refuses a broken setup', () => {
    expect(isJob(job({ setup: null }))).toBe(false);
    expect(jobWith('setup', { bed: null })).toBe(false);
    expect(jobWith('setup', { bedFrom: 'guess' })).toBe(false);
    expect(jobWith('setup', { stock: { ...stock(), kind: 'cloud' } })).toBe(false);
    expect(jobWith('setup', { stockOutline: { outline: [[0]], holes: [], source: { file: 'a', kind: 'dxf', hash: 'h' } } })).toBe(false);
    expect(jobWith('setup', { stockOutline: { outline: [], holes: [[0]], source: { file: 'a', kind: 'dxf', hash: 'h' } } })).toBe(false);
    expect(jobWith('setup', { stockOutline: { outline: [], holes: [], source: { file: 'a', kind: 'pdf', hash: 'h' } } })).toBe(false);
    expect(jobWith('setup', { stockOutline: { outline: [], holes: [], source: { file: 1, kind: 'svg', hash: 'h' } } })).toBe(false);
    expect(jobWith('setup', { stockOutline: { outline: [], holes: [], source: { file: 'a', kind: 'svg', hash: 1 } } })).toBe(false);
    expect(jobWith('setup', { stockOutline: 'none' })).toBe(false);
    expect(jobWith('setup', { fixture: { ...fixture(), outline: [[0, 0]] } })).toBe(false);
    expect(jobWith('setup', { clamps: [{ kind: 'toe', x: 0, y: 0, w: 10, d: 10 }] })).toBe(false);
    expect(jobWith('setup', { clamps: [{ x: 0, y: 0, w: 10, d: 10, h: 1 }] })).toBe(false);
    expect(jobWith('setup', { clamps: null })).toBe(false);
    expect(jobWith('setup', { tools: [{ id: 't', version: 1, name: 'x' }] })).toBe(false);
    expect(jobWith('setup', { tools: [{ id: 1, version: 1, name: 'x', number: 1 }] })).toBe(false);
    expect(jobWith('setup', { tools: [{ id: 't', version: '1', name: 'x', number: 1 }] })).toBe(false);
    expect(jobWith('setup', { tools: [{ id: 't', version: 1, name: 1, number: 1 }] })).toBe(false);
    expect(jobWith('setup', { tools: {} })).toBe(false);
    expect(jobWith('setup', { references: [{ fileId: 'f', name: 'n' }] })).toBe(false);
    expect(jobWith('setup', { references: [{ fileId: 1, name: 'n', hash: 'h' }] })).toBe(false);
    expect(jobWith('setup', { references: [{ fileId: 'f', name: 1, hash: 'h' }] })).toBe(false);
    expect(jobWith('setup', { references: 'none' })).toBe(false);
  });

  it('refuses a broken placement', () => {
    expect(isJob(job({ placement: null }))).toBe(false);
    expect(jobWith('placement', { wcs: 'G55' })).toBe(false);
    expect(jobWith('placement', { frame: 'machine' })).toBe(false);
    expect(jobWith('placement', { datum: null })).toBe(false);
    expect(jobWith('placement', { datum: { corner: 'middle', height: 'top' } })).toBe(false);
    expect(jobWith('placement', { datum: { corner: 'center', height: 'side' } })).toBe(false);
    expect(jobWith('placement', { offset: { x: 1 } })).toBe(false);
    expect(jobWith('placement', { offset: { x: 1, y: 'two' } })).toBe(false);
    expect(jobWith('placement', { offset: { x: 1, y: 2, z: 'three' } })).toBe(false);
    expect(jobWith('placement', { offset: 'none' })).toBe(false);
    expect(jobWith('placement', { datumFrom: { kind: 'guess', hash: null } })).toBe(false);
    expect(jobWith('placement', { datumFrom: { kind: 'user', hash: 1 } })).toBe(false);
    expect(jobWith('placement', { datumFrom: 'file' })).toBe(false);
    expect(jobWith('placement', { zeroFrom: 'user' })).toBe(false);
    expect(jobWith('placement', { plannedZero: { x: 0, y: 0 } })).toBe(false);
    expect(jobWith('placement', { plannedZero: 'home' })).toBe(false);
  });

  it('keeps dates as plain strings here: the browser decides how to show them', () => {
    expect(isJob(job({ createdAt: 'not a date', updatedAt: AT }))).toBe(true);
  });
});
