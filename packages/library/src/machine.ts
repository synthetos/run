/**
 * A machine profile record (the Library's Machines view): the profile in its
 * own words, each axis field mapping to one TinyG key, with the machine's bed.
 * The types live here so the browser (apps/web workspace/library.ts) and the
 * account store (workers/run-data) agree on the shape.
 *
 * `readMachine` is the strict reader a record passes before it enters an
 * account; the browser keeps reading its own stored list leniently. Nothing
 * safety-related is in a profile: homing state, confirmations and the settings
 * reference never leave `device-safety`.
 */
import { frozenCopy } from './freeze.ts';
import { isArray, isDateTime, isNum, isObject } from './shape.ts';
import type { LibraryResult } from './validate.ts';

/** One axis of a machine profile; each field maps to one TinyG key. */
export interface AxisProfile {
  readonly stepAngle?: number;
  readonly microsteps?: number;
  readonly travelPerRev?: number;
  readonly maxVelocity?: number;
  readonly maxFeed?: number;
  readonly jerk?: number;
  readonly homingSearch?: number;
  readonly homingLatch?: number;
  readonly latchBackoff?: number;
  readonly zeroBackoff?: number;
  readonly minSwitch?: number;
  readonly maxSwitch?: number;
}

const AXIS_FIELDS: readonly (keyof AxisProfile)[] = ['stepAngle', 'microsteps', 'travelPerRev', 'maxVelocity', 'maxFeed', 'jerk', 'homingSearch', 'homingLatch', 'latchBackoff', 'zeroBackoff', 'minSwitch', 'maxSwitch'];
const AXES = ['x', 'y', 'z', 'a'] as const;

/** Display-only hole pattern. These coordinates never participate in clearance or travel checks. */
export interface BedHoleGrid {
  readonly pitchX: number;
  readonly pitchY: number;
  readonly columns: number;
  readonly rows: number;
  readonly diameter: number;
  readonly firstX: number;
  readonly firstY: number;
  readonly offsetMeasured: boolean;
}

/**
 * Where a bed's dimensions came from (FLOW_ANALYSIS §5.7): a placeholder until someone measures the bed
 * or imports a drawing of it. Unverified dimensions are shown as Placeholder and never count as a fit check.
 */
export type BedSource =
  | { readonly kind: 'placeholder'; readonly note: string }
  | { readonly kind: 'measured'; readonly note: string; readonly at: string }
  | { readonly kind: 'drawing'; readonly file: string; readonly hash: string; readonly units: 'mm' | 'in'; readonly scale: number; readonly at: string };

/**
 * A machine's bed (spoilboard), one revision at a time. Bed-local coordinates put the front-left corner of
 * the bed's top face at (0, 0, 0), X right, Y back, Z up. `toMachine` is the bed-to-machine transform: the
 * machine coordinates of that corner, so machine = bed-local + toMachine.
 */
export interface MachineBed {
  readonly revision: number;
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
  /** The bed's outline in bed-local XY when it came from a drawing; null for the plain rectangle. */
  readonly outline: readonly (readonly [number, number])[] | null;
  /** Holes in the bed (`[x, y, r]`, bed-local), display only. */
  readonly holes: readonly (readonly [number, number, number])[];
  /** Hole measurements are separate from the dimensions' provenance; a grid never verifies bed size. */
  readonly holeGrid?: { readonly description: BedHoleGrid; readonly source: 'Measured by the owner'; readonly at: string };
  readonly toMachine: { readonly x: number; readonly y: number; readonly z: number };
  readonly source: BedSource;
  readonly savedAt: string;
}

export type HomeFrame = 'front-left-top' | 'back-left-top' | 'front-right-top' | 'back-right-top';
const HOME_FRAMES: readonly HomeFrame[] = ['front-left-top', 'back-left-top', 'front-right-top', 'back-right-top'];
const DRIVES = ['belt', 'screw', 'rack', 'any'] as const;

export interface MachineProfile {
  readonly axes?: Readonly<Partial<Record<(typeof AXES)[number], AxisProfile>>>;
  /** Switch type for every input (TinyG `st`): 0 normally open, 1 normally closed. */
  readonly switchType?: number;
  readonly id: string;
  readonly name: string;
  readonly templateId: string;
  readonly drive: (typeof DRIVES)[number];
  readonly travel: { readonly x: number; readonly y: number; readonly z: number };
  readonly spindle: string;
  readonly createdAt: string;
  /** Bumped on every change to the profile; absent on records from before revisions (read as 1). */
  readonly revision?: number;
  /** The machine's bed; absent means the placeholder bed derived from its travel. */
  readonly bed?: MachineBed;
  readonly homeFrame?: HomeFrame;
}

// ---------------------------------------------------------------- reading

type Issue = { readonly path: string; readonly message: string };
const issue = (path: string, message: string): Issue => ({ path, message });

const isAxis = (v: unknown): boolean => isObject(v) && Object.keys(v).every((k) => AXIS_FIELDS.includes(k as keyof AxisProfile) && isNum(v[k]));

function axesIssues(v: unknown): Issue[] {
  if (v === undefined) return [];
  if (!isObject(v)) return [issue('/axes', 'must be an object of axes')];
  return Object.keys(v).flatMap((k) => (AXES.includes(k as (typeof AXES)[number]) && isAxis(v[k]) ? [] : [issue(`/axes/${k}`, 'must be x, y, z or a with finite numbers')]));
}

const isTravel = (v: unknown): boolean => isObject(v) && isNum(v['x']) && v['x'] > 0 && isNum(v['y']) && v['y'] > 0 && isNum(v['z']) && v['z'] > 0;
const isHoleGrid = (v: unknown): boolean =>
  isObject(v) && isObject(v['description']) && ['pitchX', 'pitchY', 'columns', 'rows', 'diameter', 'firstX', 'firstY'].every((k) => isNum((v['description'] as Record<string, unknown>)[k]))
  && typeof (v['description'] as Record<string, unknown>)['offsetMeasured'] === 'boolean' && v['source'] === 'Measured by the owner' && isDateTime(v['at']);

const isDrawingSource = (s: Record<string, unknown>): boolean =>
  typeof s['file'] === 'string' && typeof s['hash'] === 'string' && (s['units'] === 'mm' || s['units'] === 'in') && isNum(s['scale']) && s['scale'] > 0 && isDateTime(s['at']);

function sourceIssues(s: unknown): Issue[] {
  if (!isObject(s) || typeof s['kind'] !== 'string') return [issue('/bed/source', 'must name its kind')];
  if (s['kind'] === 'placeholder') return typeof s['note'] === 'string' ? [] : [issue('/bed/source/note', 'must be text')];
  if (s['kind'] === 'measured') return typeof s['note'] === 'string' && isDateTime(s['at']) ? [] : [issue('/bed/source', 'needs a note and a date')];
  if (s['kind'] !== 'drawing') return [issue('/bed/source/kind', 'must be placeholder, measured or drawing')];
  return isDrawingSource(s) ? [] : [issue('/bed/source', 'a drawing source needs file, hash, units, scale and a date')];
}

const isPoint = (v: unknown): boolean => isArray(v) && v.length === 2 && v.every(isNum);
const isHole = (v: unknown): boolean => isArray(v) && v.length === 3 && v.every(isNum);
const isWhole = (v: unknown, min: number): boolean => isNum(v) && Number.isInteger(v) && v >= min;

function bedSizeIssues(b: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  if (!isWhole(b['revision'], 0)) out.push(issue('/bed/revision', 'must be a whole number'));
  for (const k of ['width', 'depth', 'thickness'] as const) if (!(isNum(b[k]) && b[k] > 0)) out.push(issue(`/bed/${k}`, 'must be a positive number'));
  return out;
}

function bedShapeIssues(b: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  if (!(b['outline'] === null || (isArray(b['outline']) && b['outline'].every(isPoint)))) out.push(issue('/bed/outline', 'must be null or a list of [x, y]'));
  if (!(isArray(b['holes']) && b['holes'].every(isHole))) out.push(issue('/bed/holes', 'must be a list of [x, y, r]'));
  if (b['holeGrid'] !== undefined && !isHoleGrid(b['holeGrid'])) out.push(issue('/bed/holeGrid', 'must be a measured grid'));
  if (!(isObject(b['toMachine']) && ['x', 'y', 'z'].every((k) => isNum((b['toMachine'] as Record<string, unknown>)[k])))) out.push(issue('/bed/toMachine', 'must give x, y and z'));
  if (!isDateTime(b['savedAt'])) out.push(issue('/bed/savedAt', 'must be a date'));
  return out;
}

function bedIssues(b: unknown): Issue[] {
  if (b === undefined) return [];
  if (!isObject(b)) return [issue('/bed', 'must be an object')];
  return [...bedSizeIssues(b), ...bedShapeIssues(b), ...sourceIssues(b['source'])];
}

function identityIssues(v: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  for (const k of ['id', 'name', 'templateId'] as const) if (typeof v[k] !== 'string' || v[k] === '') out.push(issue(`/${k}`, 'must be text'));
  // The spindle is a free description; the Machines view saves it empty when cleared.
  if (typeof v['spindle'] !== 'string') out.push(issue('/spindle', 'must be text'));
  if (!DRIVES.includes(v['drive'] as (typeof DRIVES)[number])) out.push(issue('/drive', 'must be belt, screw, rack or any'));
  if (!isTravel(v['travel'])) out.push(issue('/travel', 'must give positive x, y and z'));
  if (!isDateTime(v['createdAt'])) out.push(issue('/createdAt', 'must be a date'));
  return out;
}

function optionIssues(v: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  if (v['revision'] !== undefined && !isWhole(v['revision'], 1)) out.push(issue('/revision', 'must be a whole number from 1'));
  if (v['switchType'] !== undefined && v['switchType'] !== 0 && v['switchType'] !== 1) out.push(issue('/switchType', 'must be 0 or 1'));
  if (v['homeFrame'] !== undefined && !HOME_FRAMES.includes(v['homeFrame'] as HomeFrame)) out.push(issue('/homeFrame', 'must name a top corner'));
  return out;
}

const FIELDS = new Set(['axes', 'switchType', 'id', 'name', 'templateId', 'drive', 'travel', 'spindle', 'createdAt', 'revision', 'bed', 'homeFrame']);

/** A machine profile as it may enter an account: every field checked, unknown fields refused. */
export function readMachine(value: unknown): LibraryResult<MachineProfile> {
  if (!isObject(value)) return { ok: false, issues: [issue('', 'must be an object')] };
  const unknown = Object.keys(value).filter((k) => !FIELDS.has(k)).map((k) => issue(`/${k}`, 'is not a profile field'));
  const issues = [...unknown, ...identityIssues(value), ...optionIssues(value), ...axesIssues(value['axes']), ...bedIssues(value['bed'])];
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: frozenCopy(value as unknown as MachineProfile) };
}
