/**
 * The job placed by the live machine (FLOW_ANALYSIS §3 "Coordinate contract"): where the Run view's scene
 * draws the stock, its clamps, the toolpath and the tool once a board reports its position.
 *
 * Machine coordinates relate to the bed only once the position is established: homed, or set with G28.3
 * (both read back as `home` 1, all of X, Y and Z), and not since lost (the session's UNKNOWN overlay). A
 * board that powered up unhomed calls wherever it stopped 0, 0, 0, so until then the job is drawn as
 * planned and the tool at the planned zero plus the reported work position, the one frame that means
 * something before the machine knows where it is.
 *
 * Once established, the stock and clamps move in X and Y only (they rest on the fixture or bed, never in
 * it) and the toolpath moves by the full offset, Z included, because that is where the cut will go. The
 * notes say in words what the drawing cannot: a Z zero away from the plan, a stock moved off the bed or
 * over the fixture's edge.
 *
 * Pure: the same scene and reports give the same placement.
 */
import type { Pt2, SceneLayers, SceneSolid, Vec3 } from '@synthetos/gcode-view';
import { sceneBounds } from '@synthetos/gcode-view';
import { liveFrame, type JobScene, type LiveFrame } from './sceneModel.ts';

type AxisValues = Readonly<Partial<Record<'x' | 'y' | 'z' | 'a' | 'b' | 'c', number>>>;

/** What a status-report snapshot tells the scene: positions, units, homing state and the overlays. */
export interface LiveReport {
  readonly mpo: AxisValues;
  readonly pos: AxisValues;
  readonly unit?: number;
  /** `home`: 1 once X, Y and Z are homed or set (G28.3). */
  readonly home?: number;
  /** The session's overlays; UNKNOWN means the position is not trusted. */
  readonly overlays?: readonly string[];
}

export interface LivePlacement {
  /** The scene to draw, with `notes` for its key. */
  readonly scene: JobScene;
  /** The tool tip in the scene's frame, or null until both positions are known. */
  readonly tool: Vec3 | null;
  /** Machine coordinates relate to the bed (homed or set, and trusted). */
  readonly established: boolean;
}

/** Z differences up to this many mm are not worth a note. */
export const Z_NOTE_MM = 0.5;

export const UNSET_NOTE = 'Machine position not set: the job is shown as planned, and the tool from its work position. Home or set the position to place it on the bed.';
export const UNTRUSTED_NOTE = 'Machine position not trusted: the job is shown as planned, and the tool from its work position. Home, or check the machine and confirm it, to place it on the bed.';

/** True when machine coordinates relate to the bed: `home` 1 and no UNKNOWN overlay. */
export function positionEstablished(live: LiveReport): boolean {
  return live.home === 1 && live.overlays?.includes('UNKNOWN') !== true;
}

/** The scene placed by a live report; the planned scene unchanged without one. */
export function placeLive(planned: JobScene, live: LiveReport | null): LivePlacement {
  const frame = live === null ? null : liveFrame(live);
  if (live === null || frame === null) return { scene: planned, tool: null, established: false };
  if (!positionEstablished(live)) {
    const note = live.home === 1 ? UNTRUSTED_NOTE : UNSET_NOTE;
    return { scene: { ...planned, notes: [note] }, tool: workTool(planned, frame), established: false };
  }
  const placed = placeJobAt(planned, frame.zero);
  return { scene: { ...placed, notes: placementNotes(planned, placed) }, tool: frame.tool, established: true };
}

/**
 * The tool tip in the scene's frame: the reported machine position once established, else the planned zero plus
 * the reported work position (machine minus live zero, in mm). Null until both positions are known.
 */
export function liveTool(planned: JobScene, live: LiveReport): Vec3 | null {
  const frame = liveFrame(live);
  if (frame === null) return null;
  return positionEstablished(live) ? frame.tool : workTool(planned, frame);
}

function workTool(planned: JobScene, frame: LiveFrame): Vec3 {
  const z = planned.zero;
  return [z[0] + frame.tool[0] - frame.zero[0], z[1] + frame.tool[1] - frame.zero[1], z[2] + frame.tool[2] - frame.zero[2]];
}

/** The job's solids that follow the work zero (in X and Y): the stock and what clamps it. The bed and fixture stay put. */
const MOVES_WITH_ZERO = new Set(['stock', 'clamp']);

/**
 * The scene with the job placed at a live work zero: the stock and its clamps move by the XY part of
 * (live zero minus planned zero) and stay at their planned heights; the toolpath and the zero triad move by
 * all of it. Unchanged when the zeros already agree.
 */
export function placeJobAt(scene: JobScene, zero: Vec3): JobScene {
  const dx = zero[0] - scene.zero[0];
  const dy = zero[1] - scene.zero[1];
  if (dx === 0 && dy === 0 && zero[2] === scene.zero[2]) return scene;
  const solids = scene.layers.solids.map((s): SceneSolid => {
    if (s.tag === undefined || !MOVES_WITH_ZERO.has(s.tag) || (dx === 0 && dy === 0)) return s;
    return s.kind === 'box'
      ? { ...s, min: [s.min[0] + dx, s.min[1] + dy, s.min[2]], max: [s.max[0] + dx, s.max[1] + dy, s.max[2]] }
      : { ...s, outline: s.outline.map(([x, y]) => [x + dx, y + dy] as const) };
  });
  const layers: SceneLayers = { solids, rings: scene.layers.rings };
  return { ...scene, layers, pathOffset: zero, zero, bounds: sceneBounds(layers) };
}

const fmt1 = (n: number): string => n.toFixed(1);

/** The notes of an established placement: the Z zero against the plan, then the stock's footprint. */
export function placementNotes(planned: JobScene, placed: JobScene): string[] {
  const notes: string[] = [];
  const dz = placed.zero[2] - planned.zero[2];
  if (Math.abs(dz) > Z_NOTE_MM) {
    notes.push(`Work zero Z is ${fmt1(Math.abs(dz))} mm ${dz < 0 ? 'below' : 'above'} the planned zero${zeroRef(planned)}. The toolpath is drawn where it will cut.`);
  }
  const stock = footprint(placed, 'stock');
  const bed = footprint(placed, 'bed');
  if (stock !== null && bed !== null && !stock.every((p) => inside(p, bed))) notes.push('At this work zero the stock runs off the bed.');
  const fixture = footprint(placed, 'fixture');
  const before = footprint(planned, 'stock');
  if (stock !== null && fixture !== null && before !== null) {
    // Only a change from the plan: a stock planned wider than its fixture is the Setup view's to show.
    const now = supported(stock, fixture);
    if (now < supported(before, fixture) - 0.01) notes.push(now === 0 ? 'At this work zero the stock is off the fixture.' : 'At this work zero the stock overhangs the fixture’s edge.');
  }
  return notes;
}

/** "(the stock top)" or "(the stock bottom)" when the planned zero is at one of them. */
function zeroRef(scene: JobScene): string {
  const z = scene.zero[2];
  if (Math.abs(z - scene.heights.stockTop) < 1e-6) return ' (the stock top)';
  if (Math.abs(z - scene.heights.fixtureTop) < 1e-6) return ' (the stock bottom)';
  return '';
}

/** A solid's footprint as an outline (a box's four corners), or null when the scene has none. */
function footprint(scene: JobScene, tag: string): Pt2[] | null {
  const s = scene.layers.solids.find((x) => x.tag === tag);
  if (s === undefined) return null;
  if (s.kind === 'prism') return [...s.outline];
  return [[s.min[0], s.min[1]], [s.max[0], s.min[1]], [s.max[0], s.max[1]], [s.min[0], s.max[1]]];
}

/** The share of the stock's footprint over the fixture, 0..1, from its outline points and an 11 × 11 grid inside it. */
function supported(stock: readonly Pt2[], fixture: readonly Pt2[]): number {
  const xs = stock.map((p) => p[0]);
  const ys = stock.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pts: Pt2[] = [...stock];
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p: Pt2 = [x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * j) / 10];
      if (inside(p, stock)) pts.push(p);
    }
  }
  return pts.filter((p) => inside(p, fixture)).length / pts.length;
}

/** Point in polygon (even-odd), with points on an edge (within 1 µm) counted inside. */
function inside(p: Pt2, poly: readonly Pt2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt2;
    const b = poly[j] as Pt2;
    if (onSegment(p, a, b)) return true;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

function onSegment(p: Pt2, a: Pt2, b: Pt2): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-3;
  const cross = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
  const along = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
  return Math.abs(cross) < 1e-3 && along >= -1e-3 && along <= len + 1e-3;
}
