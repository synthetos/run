import { type ViewPreset } from '../camera.ts';
import type { CarveSurface } from '../carve/client.ts';
import type { CellRect } from '../carve/heightmap.ts';
import { type ToolColors } from '../lineTools.ts';
import { type SpinDirection } from '../markerSpin.ts';
import { type Rgba, type SceneLayers } from '../scene.ts';
import { type Box3, type SegmentList, type Vec3 } from '../segments.ts';
import { type SliceOptions } from '../slicer.ts';
import { type ToolShape } from '../toolProfile.ts';

export interface PreviewColors {
  readonly background: Rgba;
  readonly rapid: Rgba;
  readonly feed: Rgba;
  readonly arc: Rgba;
  readonly outOfBounds: Rgba;
  readonly uncertain: Rgba;
  readonly highlight: Rgba;
  readonly envelope: Rgba;
  readonly axisX: Rgba;
  readonly axisY: Rgba;
  readonly axisZ: Rgba;
  /** Bed/work grid, minor lines. */
  readonly grid: Rgba;
  /** Bed/work grid, major lines (every 5 or 10 cells, through the origin). */
  readonly gridMajor: Rgba;
  /** Planner view (a running job): the line executing now, and the queued band; amber while starving. Defaults derive from the others. */
  readonly plannerExec?: Rgba;
  readonly plannerQueued?: Rgba;
  readonly plannerStarving?: Rgba;
  /** The carved stock's cut surfaces, floors and walls (owner, 2026-11-09: "show cut-out sections in a different colour"). */
  readonly carveCut?: Rgba;
}

/**
 * The planner view of a running job, in the drawn list's line indices: lines before `cutEnd` are cut (drawn
 * dimmed), lines in [cutEnd, execEnd) are executing now, lines in [execEnd, queuedEnd) are sent and acknowledged but
 * not yet executed, the rest are not sent yet (normal colours). It comes from the board's reports; it never
 * animates anything by itself.
 */
export interface PlannerOverlay {
  readonly cutEnd: number;
  readonly execEnd: number;
  readonly queuedEnd: number;
  /** Lines in [queuedEnd, sentEnd) are sent and waiting for their acknowledgement (default: none). */
  readonly sentEnd?: number;
  /** The queued band is nearly empty while cutting: drawn amber. */
  readonly starving: boolean;
}

export interface LoadOptions extends Pick<SliceOptions, 'signal' | 'budgetMs' | 'now' | 'yieldToHost'> {
  readonly segmentsPerChunk?: number;
  /** Keep the current drawing until the replacement is complete; cancellation leaves it intact. */
  readonly retainUntilReady?: boolean;
  /** Display sampling only. Original segment endpoints and line indices are retained. */
  readonly sampling?: { readonly stride: number; readonly keepVertices?: readonly number[] };
  /** Fraction of the list uploaded, 0..1. */
  readonly onProgress?: (fraction: number) => void;
  /**
   * Box of the path when the caller already has it (e.g. the interpreter's
   * exact bounds). Without it the box is gathered while the chunks upload,
   * so loading never scans the whole list in one go.
   */
  readonly bounds?: Box3 | null;
}

export interface PreviewRenderer {
  /** Replaces the drawn list. Uploads in time slices; rejects with AbortError when `signal` aborts. */
  load(list: SegmentList, options?: LoadOptions): Promise<void>;
  clear(): void;
  setRapidsVisible(visible: boolean): void;
  /** Highlights lines 0..line inclusive (the scrubber); -1 for none. */
  setHighlight(line: number): void;
  /** Machine-coordinate work envelope (from the live board only), or null. */
  setEnvelope(envelope: Box3 | null): void;
  /** Shows or hides the bed/work grid (see grid.ts). */
  setGridVisible(visible: boolean): void;
  /** Origin of the active work coordinate system in machine coordinates, or null to hide the triad. */
  setWcsOrigin(origin: Vec3 | null, size?: number): void;
  /** The planner view of a running job (lines cut, executing, queued), or null for none. */
  setPlanner(planner: PlannerOverlay | null): void;
  /**
   * The tool position the board reports (in the path's frame), drawn as a small marker, or null to hide it.
   * `preview` marks a planned position (the end of the scrubbed line, no board): drawn dimmed, and it jumps
   * to each position, so it never reads as a machine moving.
   */
  setToolMarker(position: Vec3 | null, preview?: boolean): void;
  /**
   * Play preview's tool (play/), in the highlight colour so it is never taken for the live machine's marker, which
   * may show at the same time; null to hide it. The geometry is built once; a new position moves it, nothing more.
   */
  setPlayMarker(position: Vec3 | null): void;
  /** The marker's tool, drawn at true size; null for the generic glyph. The geometry is rebuilt only when this changes. */
  setToolShape(shape: ToolShape | null): void;
  /** The spindle as the board reports it (markerSpin.ts): the live marker turns while it is on, unless motion is reduced. */
  setToolSpin(direction: SpinDirection): void;
  /** False on a software renderer, where the bit never turns (the page then shows a badge). */
  readonly turnsBit: boolean;
  /** The scene solids under the path (bed, stock, fixture, clamps), in the drawing's frame, or null for none. */
  setScene(scene: SceneLayers | null): void;
  /** Where the path's origin sits in the drawing's frame (the planned work zero); [0, 0, 0] by default. */
  setPathOffset(offset: Vec3): void;
  /** The carved stock (carve/mesh.ts, in the path's frame), drawn in place of the flat stock solid; null for none. */
  setCarve(surface: CarveSurface | null): void;
  /** Colour by tool (lineTools.ts): a slot per list line and the slots' colours; null for colour by move type only. */
  setToolColors(colors: ToolColors | null): void;
  /** Fades every tool but the one in this slot (the legend's pick); null for none. */
  setToolFocus(slot: number | null): void;
  /** A rectangle of the carved surface changed. */
  updateCarve(rect: CellRect): void;
  /** Turns the view to a named direction and refits it. */
  setView(preset: ViewPreset): void;
  setColors(colors: PreviewColors): void;
  /** Canvas size in CSS pixels and the device pixel ratio. */
  resize(width: number, height: number, pixelRatio?: number): void;
  /** Fits the view to the job: the drawn path with the stock, fixture and clamps (framing.ts). */
  fit(): void;
  orbit(dAzimuth: number, dElevation: number): void;
  zoomBy(factor: number): void;
  /** Zooms toward a canvas point (CSS pixels from its top-left): what is under it stays under it. */
  zoomAt(factor: number, x: number, y: number): void;
  panBy(dx: number, dy: number): void;
  /** The tag of the nearest scene solid under a canvas point (CSS pixels from its top-left), or null. */
  pick(x: number, y: number): string | null;
  /** Schedules one frame; several calls before it runs draw once. */
  requestRender(): void;
  /** Number of frames drawn (for tests and diagnostics). */
  readonly frames: number;
  readonly chunkCount: number;
  /** Number of scene solids uploaded (for tests and diagnostics). */
  readonly solidCount: number;
  dispose(): void;
}

export interface RendererOptions {
  readonly colors: PreviewColors;
  /** Schedules a frame (default `requestAnimationFrame`). */
  readonly requestFrame?: (draw: () => void) => void;
  /**
   * Draw the bed/work grid in the XY plane at the bottom of the drawn extent, over the envelope
   * (machine travel) when known or else the padded path extent (default false).
   */
  readonly grid?: boolean;
  /** The clock for the tool marker's motion, ms (default `performance.now`). */
  readonly now?: () => number;
  /** True to draw each tool position at once (default: the `prefers-reduced-motion` media query). */
  readonly reducedMotion?: () => boolean;
  /** Most vertices per side of the carved stock's mesh (carve/mesh.ts; default: one per cell, fewer on a software renderer). */
  readonly carveMeshMax?: number;
}

export interface GpuChunk {
  readonly vao: WebGLVertexArrayObject;
  readonly buffers: readonly WebGLBuffer[];
  readonly vertexCount: number;
}
