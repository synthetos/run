/**
 * A job record (docs/design/PROJECTS.md; FLOW_ANALYSIS §5): one of a project's
 * files set up on a machine revision, with the bed, stock, fixture, clamps,
 * tools, references and the placement. The types and the readers live here so
 * the browser (apps/web workspace/jobModel.ts) and the account store
 * (workers/run-data) check the same shape; nothing here decides anything.
 *
 * `isJob` and `isBed` are exact shape checks: anything that does not read is
 * skipped by the browser and refused by the account, never repaired.
 */
import type { MachineBed } from './machine.ts';
import { isArray, isNum, isObject, isPoint, isHole } from './shape.ts';
import type { Fixture, FixtureClamp, Stock, StockCorner } from './types.ts';
import { readFixture, readStock } from './validate.ts';

export const JOB_FORMAT = 1;

export interface JobFile {
  readonly projectId: string | null;
  readonly fileId: string | null;
  readonly name: string;
  readonly hash: string;
  readonly size: number;
}

export interface JobMachine {
  readonly id: string;
  readonly revision: number;
  readonly name: string;
}

export interface ToolRef {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly number: number;
}

export interface JobReference {
  readonly fileId: string;
  readonly name: string;
  readonly hash: string;
}

export interface DrawingSource {
  readonly file: string;
  readonly kind: 'dxf' | 'svg';
  readonly hash: string;
}

export interface StockOutline {
  readonly outline: readonly (readonly [number, number])[];
  readonly holes: readonly (readonly [number, number, number])[];
  readonly source: DrawingSource;
}

export interface JobSetup {
  readonly bed: MachineBed;
  readonly bedFrom: 'machine' | 'own';
  readonly stock: Stock;
  readonly stockOutline: StockOutline | null;
  readonly fixture: Fixture | null;
  readonly clamps: readonly FixtureClamp[];
  readonly tools: readonly ToolRef[];
  readonly references: readonly JobReference[];
}

export interface JobDatum {
  readonly corner: StockCorner;
  readonly height: 'top' | 'bottom';
}

export interface JobPlacement {
  readonly wcs: 'G54';
  readonly datum: JobDatum;
  readonly plannedZero: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly offset?: { readonly x: number; readonly y: number; readonly z?: number };
  readonly datumFrom?: { readonly kind: 'user' | 'file'; readonly hash: string | null };
  readonly zeroFrom?: 'machine';
  readonly frame: 'bed';
}

export interface Job {
  readonly v: typeof JOB_FORMAT;
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly revision: number;
  readonly file: JobFile | null;
  readonly machine: JobMachine | null;
  readonly setup: JobSetup;
  readonly placement: JobPlacement;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------- the bed

const isXyz = (v: unknown): boolean => isObject(v) && isNum(v['x']) && isNum(v['y']) && isNum(v['z']);
const isBedSize = (v: Record<string, unknown>): boolean => isNum(v['revision']) && isNum(v['width']) && isNum(v['depth']) && isNum(v['thickness']);
const isBedShape = (v: Record<string, unknown>): boolean =>
  (v['outline'] === null || (isArray(v['outline']) && v['outline'].every(isPoint))) && isArray(v['holes']) && v['holes'].every(isHole);
const isBedOrigin = (v: Record<string, unknown>): boolean => {
  const s = v['source'];
  return isXyz(v['toMachine']) && isObject(s) && typeof s['kind'] === 'string' && typeof v['savedAt'] === 'string';
};

/** A machine bed record: its size, outline and holes, and where it sits in machine coordinates. */
export function isBed(v: unknown): v is MachineBed {
  return isObject(v) && isBedSize(v) && isBedShape(v) && isBedOrigin(v);
}

// ---------------------------------------------------------------- the job's parts

const isNullableString = (v: unknown): boolean => v === null || typeof v === 'string';
const isClamp = (v: unknown): v is FixtureClamp => isObject(v) && typeof v['kind'] === 'string' && ['x', 'y', 'w', 'd', 'h'].every((k) => isNum(v[k]));
const isToolRef = (v: unknown): v is ToolRef => isObject(v) && typeof v['id'] === 'string' && isNum(v['version']) && typeof v['name'] === 'string' && isNum(v['number']);
const isReference = (v: unknown): v is JobReference => isObject(v) && typeof v['fileId'] === 'string' && typeof v['name'] === 'string' && typeof v['hash'] === 'string';
const isSource = (v: unknown): v is DrawingSource => isObject(v) && typeof v['file'] === 'string' && (v['kind'] === 'dxf' || v['kind'] === 'svg') && typeof v['hash'] === 'string';
const isStockOutline = (v: unknown): v is StockOutline =>
  isObject(v) && isArray(v['outline']) && v['outline'].every(isPoint) && isArray(v['holes']) && v['holes'].every(isHole) && isSource(v['source']);
const CORNERS: readonly StockCorner[] = ['front-left', 'front-right', 'back-left', 'back-right', 'center'];

function isJobFile(f: unknown): boolean {
  if (f === null) return true;
  return isObject(f) && isNullableString(f['projectId']) && isNullableString(f['fileId']) && typeof f['name'] === 'string' && typeof f['hash'] === 'string' && isNum(f['size']);
}

const isJobMachine = (m: unknown): boolean => m === null || (isObject(m) && typeof m['id'] === 'string' && isNum(m['revision']) && typeof m['name'] === 'string');

function isJobSetup(s: unknown): boolean {
  if (!isObject(s) || !isBed(s['bed']) || !(s['bedFrom'] === 'machine' || s['bedFrom'] === 'own') || !readStock(s['stock']).ok) return false;
  if (!(s['stockOutline'] === null || isStockOutline(s['stockOutline'])) || !(s['fixture'] === null || readFixture(s['fixture']).ok)) return false;
  return isArray(s['clamps']) && s['clamps'].every(isClamp) && isArray(s['tools']) && s['tools'].every(isToolRef) && isArray(s['references']) && s['references'].every(isReference);
}

const isDatum = (d: unknown): boolean => isObject(d) && CORNERS.includes(d['corner'] as StockCorner) && (d['height'] === 'top' || d['height'] === 'bottom');
const isOffset = (o: unknown): boolean => o === undefined || (isObject(o) && isNum(o['x']) && isNum(o['y']) && (o['z'] === undefined || isNum(o['z'])));
const isDatumFrom = (f: unknown): boolean => f === undefined || (isObject(f) && (f['kind'] === 'user' || f['kind'] === 'file') && isNullableString(f['hash']));

function isJobPlacement(p: unknown): boolean {
  if (!isObject(p) || p['wcs'] !== 'G54' || p['frame'] !== 'bed' || !isDatum(p['datum'])) return false;
  if (!isOffset(p['offset']) || !isDatumFrom(p['datumFrom']) || !(p['zeroFrom'] === undefined || p['zeroFrom'] === 'machine')) return false;
  return p['plannedZero'] === null || isXyz(p['plannedZero']);
}

const isJobHead = (v: Record<string, unknown>): boolean =>
  v['v'] === JOB_FORMAT && typeof v['id'] === 'string' && typeof v['name'] === 'string' && isNum(v['revision']) && isNullableString(v['projectId']) && typeof v['createdAt'] === 'string' && typeof v['updatedAt'] === 'string';

/** A stored record that still reads as a job (anything else is skipped, never trusted). */
export function isJob(v: unknown): v is Job {
  return isObject(v) && isJobHead(v) && isJobFile(v['file']) && isJobMachine(v['machine']) && isJobSetup(v['setup']) && isJobPlacement(v['placement']);
}
