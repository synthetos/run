/** Valid machine, bed, job and project records for the reader tests; every helper takes overrides. */
import type { Job, MachineBed, MachineProfile, Project } from '../src/index.ts';
import { stock } from './fixtures.ts';

export const AT = '2026-11-15T12:00:00.000Z';
export const HASH = 'ab'.repeat(32);

export function bed(overrides: Record<string, unknown> = {}): MachineBed {
  return {
    revision: 1, width: 300, depth: 300, thickness: 19, outline: null, holes: [[10, 10, 3]],
    toMachine: { x: 0, y: 0, z: -80 }, source: { kind: 'measured', note: 'Tape measure', at: AT }, savedAt: AT,
    ...overrides,
  } as MachineBed;
}

export const holeGrid = (overrides: Record<string, unknown> = {}) => ({
  description: { pitchX: 75, pitchY: 75, columns: 4, rows: 4, diameter: 6.5, firstX: 0, firstY: 0, offsetMeasured: false, ...overrides },
  source: 'Measured by the owner', at: AT,
});

export function machine(overrides: Record<string, unknown> = {}): MachineProfile {
  return {
    id: 'shapeoko-1', name: 'Shapeoko', templateId: 'shapeoko', drive: 'belt', travel: { x: 300, y: 300, z: 80 },
    spindle: 'Makita RT0701C', createdAt: AT, revision: 2, switchType: 0, homeFrame: 'front-left-top',
    axes: { x: { stepAngle: 1.8, microsteps: 8 }, z: { travelPerRev: 8 } }, bed: bed({ holeGrid: holeGrid() }),
    ...overrides,
  } as MachineProfile;
}

export function job(overrides: Record<string, unknown> = {}): Job {
  return {
    v: 1, id: 'job-1', projectId: 'proj-1', name: 'Plate', revision: 1,
    file: { projectId: 'proj-1', fileId: 'file-1', name: 'plate.nc', hash: HASH, size: 10 },
    machine: { id: 'shapeoko-1', revision: 2, name: 'Shapeoko' },
    setup: {
      bed: bed(), bedFrom: 'machine', stock: stock(), stockOutline: null, fixture: null, clamps: [],
      tools: [{ id: 'tool-1', version: 1, name: 'End mill', number: 1 }], references: [{ fileId: 'file-2', name: 'plate.dxf', hash: HASH }],
    },
    placement: { wcs: 'G54', datum: { corner: 'front-left', height: 'top' }, plannedZero: null, frame: 'bed' },
    createdAt: AT, updatedAt: AT,
    ...overrides,
  } as Job;
}

export function project(overrides: Record<string, unknown> = {}): Project {
  return {
    v: 1, id: 'proj-1', name: 'Mounting plate', description: 'A plate.', cover: 'img-1',
    images: [{ id: 'img-1', name: 'plate.webp', size: 2048, width: 800, height: 600, addedAt: AT }],
    files: [{ id: 'file-1', name: 'plate.nc', size: 10, hash: HASH, role: 'gcode', note: '', addedAt: AT }],
    links: [{ id: 'link-1', title: 'Drawing', url: 'https://example.com/plate' }],
    setup: { machine: { id: 'shapeoko-1', name: 'Shapeoko' }, stock: null, material: { id: 'mat', version: 1, name: 'Aluminium' }, tools: [{ id: 'tool-1', name: 'End mill', number: 1 }] },
    jobs: [job()], tags: ['plate'], createdAt: AT, updatedAt: AT,
    ...overrides,
  } as Project;
}
