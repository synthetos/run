/**
 * The shared scene (FLOW_ANALYSIS §3 "Coordinate contract", §4 step 4): one
 * model of the bed, stock, fixture and clamps in machine coordinates, built
 * from the active job, drawn by the toolpath renderer (3D) and its SVG
 * fallback (top view) in both the Run and Setup views.
 *
 * Frames: the job describes its setup in bed-local coordinates, the Setup
 * view's own frame (bed top at Z 0, front-left corner at X 0 Y 0; stock and
 * fixture positions are their footprints' centres). The bed's `toMachine`
 * transform moves every solid into machine coordinates; nothing here treats
 * the bed top as machine Z 0 unless the transform says so (the draft's own
 * bed, labelled a placeholder).
 *
 * The toolpath is interpreted in work coordinates and drawn offset by the
 * planned work zero (`pathOffset`): for a G54-only file with no internal
 * offset changes, planned machine position is work position plus that zero.
 * Other cases are drawn the same way for now and are not a placement check.
 *
 * Pure: the same job and colours give the same scene.
 */
import type { Box3, Rgba, SceneLayers, SceneRing, SceneSolid, Vec3 } from '@synthetos/gcode-view';
import { sceneBounds } from '@synthetos/gcode-view';
import { bedIsPlaceholder } from '../workspace/library.ts';
import { fixtureTop, plannedZero, stockFootprint, type Job } from '../workspace/jobModel.ts';
import type { SceneColors } from './colors.ts';

export interface SceneHeights {
  /** Machine Z of each top face. */
  readonly bedTop: number;
  readonly fixtureTop: number;
  readonly stockTop: number;
  /** The same heights above the machine table (the bed's underside), as the Setup view reported them. */
  readonly aboveTable: { readonly bedTop: number; readonly fixtureTop: number; readonly stockTop: number };
}

export interface JobScene {
  /** The solids and hole marks, in machine coordinates, for the renderer and the SVG fallback. */
  readonly layers: SceneLayers;
  /** Where the toolpath's origin sits in machine coordinates: the planned work zero. */
  readonly pathOffset: Vec3;
  /** The planned work zero, drawn as the triad. */
  readonly zero: Vec3;
  readonly bounds: Box3 | null;
  readonly heights: SceneHeights;
  /** The bed's dimensions are unverified (shown as Placeholder; never a fit certainty). */
  readonly bedPlaceholder: boolean;
  /** What the bed is, in words, for the viewer's key. */
  readonly bedLabel: string;
  /** Plain notes on how the live machine placed the job (livePlacement.ts), for the viewer's key; none when planned. */
  readonly notes?: readonly string[];
}

type Pt = readonly [number, number];

/** A colour with alpha. */
const alpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];

/** Builds the scene of a job. `stockColor` is the material's family colour (0..255), or null for the default. */
export function jobScene(job: Job, colors: SceneColors, stockColor: readonly number[] | null): JobScene {
  const bed = job.setup.bed;
  const t = bed.toMachine;
  const mx = (p: Pt): Pt => [p[0] + t.x, p[1] + t.y];
  const solids: SceneSolid[] = [];
  const rings: SceneRing[] = [];
  const bedTop = t.z;
  // The bed slab: its top at the bed's machine height, its underside one thickness below.
  if (bed.outline !== null && bed.outline.length >= 3) solids.push({ kind: 'prism', outline: bed.outline.map(mx), z0: bedTop - bed.thickness, z1: bedTop, color: colors.bed, tag: 'bed' });
  else solids.push({ kind: 'box', min: [t.x, t.y, bedTop - bed.thickness], max: [t.x + bed.width, t.y + bed.depth, bedTop], color: colors.bed, tag: 'bed' });
  for (const [hx, hy, r] of bed.holes) rings.push({ center: [hx + t.x, hy + t.y, bedTop], radius: r, color: colors.bed });
  // The fixture: an extruded outline whose `position` is its footprint's centre (Setup semantics).
  const fx = job.setup.fixture;
  const fTop = bedTop + fixtureTop(job);
  const st = job.setup.stock;
  const foot = stockFootprint(st);
  if (fx !== null && fx.outline.length >= 3) {
    const fw = Math.max(...fx.outline.map((p) => p[0]));
    const fd = Math.max(...fx.outline.map((p) => p[1]));
    const ox = fx.position.x - fw / 2;
    const oy = fx.position.y - fd / 2;
    solids.push({ kind: 'prism', outline: fx.outline.map(([x, y]) => mx([ox + x, oy + y])), z0: bedTop, z1: fTop, color: colors.fixture, tag: 'fixture' });
    for (const [hx, hy, r] of fx.holes) {
      const x = ox + hx;
      const y = oy + hy;
      // Holes under the stock are hidden, as the Setup view hid them.
      if (x > foot.x0 && x < foot.x0 + foot.w && y > foot.y0 && y < foot.y0 + foot.d) continue;
      rings.push({ center: [x + t.x, y + t.y, fTop], radius: r, color: colors.fixture });
    }
  }
  // The stock: a block or sheet, a round, or the imported outline, on the fixture (or the bed).
  const sTop = fTop + st.thickness;
  const stock: Rgba = stockColor === null ? colors.stock : [(stockColor[0] ?? 0) / 255, (stockColor[1] ?? 0) / 255, (stockColor[2] ?? 0) / 255, 1];
  const outline = job.setup.stockOutline;
  if (outline !== null && outline.outline.length >= 3) solids.push({ kind: 'prism', outline: outline.outline.map(([x, y]) => mx([foot.x0 + x, foot.y0 + y])), z0: fTop, z1: sTop, color: stock, tag: 'stock' });
  else if (st.shape === 'round') {
    const ring: Pt[] = Array.from({ length: 48 }, (_, k) => mx([st.position.x + (foot.w / 2) * Math.cos((k / 48) * Math.PI * 2), st.position.y + (foot.d / 2) * Math.sin((k / 48) * Math.PI * 2)]));
    solids.push({ kind: 'prism', outline: ring, z0: fTop, z1: sTop, color: stock, tag: 'stock' });
  } else solids.push({ kind: 'box', min: [foot.x0 + t.x, foot.y0 + t.y, fTop], max: [foot.x0 + foot.w + t.x, foot.y0 + foot.d + t.y, sTop], color: stock, tag: 'stock' });
  // Clamps: records in bed-local coordinates, sitting on the stock top (the illustrative toe clamps) or where placed.
  for (const c of job.setup.clamps) solids.push({ kind: 'box', min: [c.x + t.x, c.y + t.y, sTop - 2], max: [c.x + c.w + t.x, c.y + c.d + t.y, sTop - 2 + c.h], color: alpha(colors.clamp, 1), tag: 'clamp' });
  const layers: SceneLayers = { solids, rings };
  const z = plannedZero(job);
  const zero: Vec3 = [z.x, z.y, z.z];
  return {
    layers,
    pathOffset: zero,
    zero,
    bounds: sceneBounds(layers),
    heights: { bedTop, fixtureTop: fTop, stockTop: sTop, aboveTable: { bedTop: bed.thickness, fixtureTop: bed.thickness + fixtureTop(job), stockTop: bed.thickness + fixtureTop(job) + st.thickness } },
    bedPlaceholder: bedIsPlaceholder(bed),
    bedLabel: bedLabel(job),
  };
}

/** "Bed 790 × 790 mm, placeholder" / "Bed of Shop X-Carve, revision 2, measured". */
export function bedLabel(job: Job): string {
  const bed = job.setup.bed;
  const who = job.machine === null || job.setup.bedFrom === 'own' ? 'Bed' : `Bed of ${job.machine.name}, revision ${bed.revision}`;
  const how = bed.source.kind === 'placeholder' ? 'placeholder' : bed.source.kind === 'measured' ? 'measured' : `from ${bed.source.file}`;
  return `${who} · ${Math.round(bed.width)} × ${Math.round(bed.depth)} mm · ${how}`;
}

// ---------------------------------------------------------------- the live machine

/** Where the machine is, from its reports: the tool and the live work zero, both in machine millimetres. */
export interface LiveFrame {
  /** The tool tip: the reported machine position (`mpo`, always millimetres). */
  readonly tool: Vec3;
  /** The work zero the board is using now: machine minus work position, so it follows Set work zero at once. */
  readonly zero: Vec3;
}

type AxisValues = Readonly<Partial<Record<'x' | 'y' | 'z' | 'a' | 'b' | 'c', number>>>;

/**
 * The live frame of a status-report snapshot, or null until both positions are known on X, Y and Z.
 * `mpo` is in millimetres; `pos` is in the board's units (`unit` 0 is inches).
 */
export function liveFrame(live: { readonly mpo: AxisValues; readonly pos: AxisValues; readonly unit?: number }): LiveFrame | null {
  const k = live.unit === 0 ? 25.4 : 1;
  const axes = ['x', 'y', 'z'] as const;
  const m = axes.map((a) => live.mpo[a]);
  const p = axes.map((a) => live.pos[a]);
  if (m.some((v) => v === undefined || !Number.isFinite(v)) || p.some((v) => v === undefined || !Number.isFinite(v))) return null;
  const mm = m as number[];
  const pm = (p as number[]).map((v) => v * k);
  return { tool: [mm[0] as number, mm[1] as number, mm[2] as number], zero: [(mm[0] as number) - (pm[0] as number), (mm[1] as number) - (pm[1] as number), (mm[2] as number) - (pm[2] as number)] };
}
