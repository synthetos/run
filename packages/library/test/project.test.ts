import { describe, expect, it } from 'vitest';
import { FILE_ROLES, isProjectShape, readProject } from '../src/index.ts';
import { stock } from './fixtures.ts';
import { AT, HASH, job, project } from './recordFixtures.ts';

const paths = (value: unknown): string[] => {
  const r = readProject(value);
  return r.ok ? [] : r.issues.map((i) => i.path);
};
const file = (overrides: Record<string, unknown> = {}) => ({ id: 'file-1', name: 'plate.nc', size: 10, hash: HASH, role: 'gcode', note: '', addedAt: AT, ...overrides });
const image = (overrides: Record<string, unknown> = {}) => ({ id: 'img-1', name: 'a.webp', size: 1, width: 1, height: 1, addedAt: AT, ...overrides });
const link = (overrides: Record<string, unknown> = {}) => ({ id: 'link-1', title: 'Drawing', url: 'https://example.com/', ...overrides });

describe('isProjectShape (the lenient browser check)', () => {
  it('accepts a project with or without jobs, with a stock snapshot, and refuses each broken part', () => {
    expect(isProjectShape(project())).toBe(true);
    expect(isProjectShape(project({ jobs: undefined, cover: null }))).toBe(true);
    expect(isProjectShape(project({ setup: { ...project().setup, stockSnapshot: stock() } }))).toBe(true);
    expect(isProjectShape(project({ setup: { ...project().setup, stockSnapshot: { kind: 'cloud' } } }))).toBe(false);
    expect(isProjectShape(project({ setup: { ...project().setup, tools: [{ id: 't' }] } }))).toBe(false);
    expect(isProjectShape(project({ setup: null }))).toBe(false);
    expect(isProjectShape(null)).toBe(false);
    expect(isProjectShape(project({ v: 0 }))).toBe(false);
    expect(isProjectShape(project({ id: 1 }))).toBe(false);
    expect(isProjectShape(project({ name: 1 }))).toBe(false);
    expect(isProjectShape(project({ description: null }))).toBe(false);
    expect(isProjectShape(project({ images: null }))).toBe(false);
    expect(isProjectShape(project({ files: {} }))).toBe(false);
    expect(isProjectShape(project({ links: 'none' }))).toBe(false);
    expect(isProjectShape(project({ tags: 'plate' }))).toBe(false);
    expect(isProjectShape(project({ cover: 1 }))).toBe(false);
    expect(isProjectShape(project({ createdAt: 1 }))).toBe(false);
    expect(isProjectShape(project({ updatedAt: null }))).toBe(false);
    expect(isProjectShape(project({ files: [file({ role: 1 })] }))).toBe(false);
    expect(isProjectShape(project({ images: [image({ size: '1' })] }))).toBe(false);
    expect(isProjectShape(project({ links: [link({ url: 1 })] }))).toBe(false);
    expect(isProjectShape(project({ jobs: 'none' }))).toBe(false);
  });
});

describe('readProject (the strict account reader)', () => {
  it('accepts a complete project, frozen and detached, with jobs defaulting to none', () => {
    const value = project();
    const r = readProject(value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(value);
      expect(Object.isFrozen(r.value.files)).toBe(true);
      expect(r.value).not.toBe(value);
    }
    const bare = readProject(project({ jobs: undefined, cover: null, images: [], files: [], links: [], tags: [] }));
    expect(bare.ok && bare.value.jobs).toEqual([]);
    expect(FILE_ROLES).toEqual(['gcode', 'drawing', 'model', 'other']);
  });

  it('refuses what is not a project record, and unknown fields', () => {
    expect(paths(null)).toEqual(['']);
    expect(paths(project({ shared: true }))).toEqual(['/shared']);
  });

  it('checks the head, the cover and the tags', () => {
    expect(paths(project({ id: '' }))).toEqual(['']);
    expect(paths(project({ name: 'x'.repeat(256) }))).toEqual(['']);
    expect(paths(project({ description: 'x'.repeat(20_001) }))).toEqual(['']);
    expect(paths(project({ createdAt: 'then' }))).toEqual(['/createdAt']);
    expect(paths(project({ updatedAt: 'x'.repeat(41) }))).toEqual(['/createdAt']);
    expect(paths(project({ tags: ['x'.repeat(61)] }))).toEqual(['/tags']);
    expect(paths(project({ tags: [1] }))).toEqual(['/tags']);
    expect(paths(project({ cover: 'img-9' }))).toEqual(['/cover']);
  });

  it('checks every file, image and link, and refuses repeated ids', () => {
    expect(paths(project({ files: [file({ id: '' })] }))).toEqual(['/files/0']);
    expect(paths(project({ files: [file({ name: 'x'.repeat(256) })] }))).toEqual(['/files/0']);
    expect(paths(project({ files: [file({ size: 0 })] }))).toEqual([]);
    expect(paths(project({ files: [file({ size: -1 })] }))).toEqual(['/files/0']);
    expect(paths(project({ files: [file({ size: 1.5 })] }))).toEqual(['/files/0']);
    expect(paths(project({ files: [file({ hash: 'abc' })] }))).toEqual(['/files/0']);
    expect(paths(project({ files: [file({ role: 'video' })] }))).toEqual(['/files/0']);
    expect(paths(project({ files: [file({ note: 'x'.repeat(2001) })] }))).toEqual(['/files/0']);
    expect(paths(project({ files: [file({ addedAt: 'then' })] }))).toEqual(['/files/0']);
    expect(paths(project({ files: [file(), file()] }))).toEqual(['/files/1/id']);
    expect(paths(project({ images: [image({ name: 1 })] }))).toEqual(['/images/0']);
    expect(paths(project({ images: [image({ id: 'img-2' })] }))).toEqual(['/cover']);
    expect(paths(project({ images: [image({ size: 0 })] }))).toEqual(['/images/0']);
    expect(paths(project({ images: [image({ width: 0 })] }))).toEqual(['/images/0']);
    expect(paths(project({ images: [image({ hash: 'a'.repeat(64) })] }))).toEqual([]);
    expect(paths(project({ images: [image({ hash: 'bad' })] }))).toEqual(['/images/0']);
    expect(paths(project({ images: [image({ hash: 12 })] }))).toEqual(['/images/0']);
    expect(paths(project({ images: [image({ height: -1 })] }))).toEqual(['/images/0']);
    expect(paths(project({ images: [image({ addedAt: 1 })] }))).toEqual(['/images/0']);
    expect(paths(project({ links: [link({ id: 1 })] }))).toEqual(['/links/0']);
    expect(paths(project({ links: [link({ title: 'x'.repeat(2048) })] }))).toEqual([]);
    expect(paths(project({ links: [link({ title: 'x'.repeat(2049) })] }))).toEqual(['/links/0']);
    expect(paths(project({ links: [link({ url: 'x'.repeat(2049) })] }))).toEqual(['/links/0']);
  });

  it('checks every setup reference strictly', () => {
    const setup = project().setup;
    expect(paths(project({ setup: { ...setup, tools: [null] } }))).toEqual(['/setup/tools/0']);
    expect(paths(project({ setup: { ...setup, tools: [{ id: 'tool-1', name: 'End mill', version: 'oops' }] } }))).toEqual(['/setup/tools/0']);
    expect(paths(project({ setup: { ...setup, tools: [{ id: 'tool-1', name: 'End mill', number: -1 }] } }))).toEqual(['/setup/tools/0']);
    expect(paths(project({ setup: { ...setup, tools: [{ id: '', name: 'End mill' }] } }))).toEqual(['/setup/tools/0']);
    expect(paths(project({ setup: { ...setup, tools: [{ id: 'tool-1', name: 'End mill', version: 2, number: 0 }] } }))).toEqual([]);
    expect(paths(project({ setup: { ...setup, machine: { id: 'm', name: 'M', version: 0 } } }))).toEqual(['/setup/machine']);
    expect(paths(project({ setup: { ...setup, stock: { id: 's', name: 'x'.repeat(256) } } }))).toEqual(['/setup/stock']);
    expect(paths(project({ setup: { ...setup, material: { id: 'mat', name: 'Al', version: 3 } } }))).toEqual([]);
  });

  it('reads every job strictly', () => {
    expect(paths(project({ jobs: [job(), { v: 1 }] }))).toEqual(['/jobs/1']);
    expect(paths(project({ jobs: [job({ placement: null })] }))).toEqual(['/jobs/0']);
  });
});
