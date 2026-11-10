/**
 * The stock carving in the preview (docs/design/tool-sim.md, slice 2) as a
 * hook: it owns the carve worker's client, sends it the open file's
 * segments, the stock's grid (carveStock.ts) and the tools per change point
 * (carveTools.ts; the lines before the first tool change with the tool the
 * user chose as already in the spindle, if any), and the target: the scrubbed line, or with nothing
 * scrubbed the whole job. A new file, tool table or stock starts a new
 * carve; the scrubber only moves the target.
 *
 * It returns the feed the 3D drawing uploads from and, for the key, the cell
 * size, the uncarved-lines notes and a progress signal (a signal, so only
 * the key re-renders while the carve runs, not the whole view). Display
 * only: nothing here changes or gates anything sent to the machine.
 *
 * During a job the page sets `target` from the board's last finished line
 * (liveCarve.ts) instead of the scrubber. A tip source (carveFollow.ts:
 * Play's tool, or the drawn tool during a job) takes over while it has a
 * target: it seeks the carve part way along the line the tool is on, as the
 * tool moves, without re-rendering the page.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createCarveClient, sameSpec, type CarveClient, type CarveFeed, type CarveWorkerLike, type GridSpec, type SceneLayers, type Vec3 } from '@synthetos/gcode-view';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import { toolStore } from '../workspace/library.ts';
import { carveGrid } from './carveStock.ts';
import { carvePlan } from './carveTools.ts';
import type { CarveTarget, TipSource } from './carveFollow.ts';

export interface CarveStatus {
  /** The file line carved through (0 for none). */
  readonly through: number;
  /** The carve has reached its target. */
  readonly done: boolean;
  /** The lowest top carved so far, in the path frame (the stock top when nothing is cut). */
  readonly lowest: number;
  /** Why carving stopped, when the worker failed. */
  readonly failed: string | null;
  /** Where the lines carved so far go below the stock (file lines, mm below its bottom), or null. */
  readonly below: { readonly firstLine: number; readonly firstDepth: number; readonly deepestLine: number; readonly deepestDepth: number } | null;
}

export interface CarveInfo {
  /** The heightmap's cell size, mm. */
  readonly cell: number;
  /** The stock's top in the path frame: a carve lower than this has cut something. */
  readonly top: number;
  readonly uncarved: readonly string[];
  readonly status: ReadonlySignal<CarveStatus>;
}

export interface CarveView {
  /** What the 3D drawing uploads from, or null when nothing is carved. */
  readonly feed: CarveFeed | null;
  readonly info: CarveInfo | null;
}

export interface CarveInput {
  /** Starts the carve worker; null without one (no carving). */
  readonly spawn: (() => CarveWorkerLike) | null;
  readonly result: PreviewResult | null;
  readonly layers: SceneLayers | null;
  readonly pathOffset: Vec3;
  /** List lines to carve (lines 0..target-1); null for the whole file. */
  readonly target: number | null;
  /** False where nothing is drawn in 3D (the SVG fallback, lite mode). */
  readonly enabled: boolean;
  /** The T number the user chose as already in the spindle, for the lines before the first tool change, or null. */
  readonly spindleTool?: number | null;
  /** Targets that follow the tool (carveFollow.ts); while it has one, `target` is not used. */
  readonly tips?: TipSource | null;
}

const IDLE: CarveStatus = Object.freeze({ through: 0, done: false, lowest: 0, failed: null, below: null });

export function useCarve({ spawn, result, layers, pathOffset, target, enabled, spindleTool = null, tips = null }: CarveInput): CarveView {
  const [client, setClient] = useState<CarveClient | null>(null);
  const status = useMemo(() => signal<CarveStatus>(IDLE), []);
  const sourceLines = useRef<Uint32Array | null>(null);
  sourceLines.current = result?.sourceLines ?? null;

  useEffect(() => {
    if (spawn === null || !enabled) return;
    const c = createCarveClient(spawn);
    setClient(c);
    const off = c.subscribe({
      progress: (p) => {
        const lines = sourceLines.current;
        const fileLine = (i: number): number => (lines === null ? 0 : (lines[i] ?? 0));
        const below = p.below === null ? null : { firstLine: fileLine(p.below.firstLine), firstDepth: p.below.firstDepth, deepestLine: fileLine(p.below.deepestLine), deepestDepth: p.below.deepestDepth };
        status.value = { through: p.through > 0 ? fileLine(p.through - 1) : 0, done: p.done, lowest: p.lowest, failed: p.error ?? null, below };
      },
    });
    return () => {
      off();
      c.dispose();
      setClient(null);
    };
  }, [spawn, enabled]);

  const segments = enabled ? (result?.segments ?? null) : null;
  // The grid keeps its identity while the stock lays out the same cells, so a scene rebuilt for another reason does not restart the carve.
  const held = useRef<GridSpec | null>(null);
  const next = useMemo(() => (segments === null ? null : carveGrid(layers, pathOffset)), [segments, layers, pathOffset[0], pathOffset[1], pathOffset[2]]);
  if (!sameSpec(held.current, next)) held.current = next;
  const grid = held.current;
  const table = toolStore.value.value;
  const plan = useMemo(() => (result === null || segments === null ? null : carvePlan(result.tools, result.sourceLines, segments, table, spindleTool)), [result, segments, table, spindleTool]);
  const lines = segments === null ? 0 : segments.lineToVertex.length - 1;
  const goal = target === null ? lines : Math.min(lines, Math.max(0, target));
  const goalRef = useRef(goal);
  goalRef.current = goal;
  /** The tip source's target, while it has one: it wins over `goal`. */
  const follow = useRef<CarveTarget | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const seekNow = (c: CarveClient): void => {
    const f = follow.current;
    const n = linesRef.current;
    if (f !== null) c.seek(Math.min(n, f.target), f.target < n ? f.tip : null);
    else c.seek(goalRef.current);
  };

  // The file each client has, so a new client (or a new file) gets it once.
  const sent = useRef<{ readonly client: CarveClient; readonly segments: unknown } | null>(null);
  useEffect(() => {
    if (client === null) return;
    if (sent.current?.client !== client || sent.current.segments !== segments) {
      client.setFile(segments);
      sent.current = { client, segments };
    }
    status.value = IDLE;
    client.setup(grid !== null && plan !== null ? grid : null, plan?.tools ?? { starts: new Uint32Array(0), shapes: [] });
    seekNow(client);
  }, [client, segments, grid, plan]);
  useEffect(() => { if (client !== null && follow.current === null) client.seek(goal); }, [client, goal]);
  useEffect(() => {
    if (client === null || tips === null) return;
    const off = tips.subscribe((t) => {
      follow.current = t;
      seekNow(client);
    });
    return () => {
      off();
      follow.current = null;
      seekNow(client);
    };
  }, [client, tips]);

  const active = client !== null && grid !== null && plan !== null;
  const info = useMemo(() => (active && grid !== null && plan !== null ? { cell: grid.cell, top: grid.top, uncarved: plan.uncarved, status } : null), [active, grid, plan, status]);
  return { feed: active ? client : null, info };
}
