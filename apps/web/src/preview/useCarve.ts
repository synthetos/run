/**
 * The stock carving in the preview (docs/design/tool-sim.md, slice 2) as a
 * hook: it owns the carve worker's client, sends it the open file's
 * segments, the stock's grid (carveStock.ts) and the tools per change point
 * (carveTools.ts), and the target: the scrubbed line, or with nothing
 * scrubbed the whole job. A new file, tool table or stock starts a new
 * carve; the scrubber only moves the target.
 *
 * It returns the feed the 3D drawing uploads from and, for the key, the cell
 * size, the uncarved-lines notes and a progress signal (a signal, so only
 * the key re-renders while the carve runs, not the whole view). Display
 * only: nothing here changes or gates anything sent to the machine.
 *
 * Live carving during a job (slice 3) sets `target` from the last finished
 * line instead of the scrubber; that is the one input it needs.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createCarveClient, sameSpec, type CarveClient, type CarveFeed, type CarveWorkerLike, type GridSpec, type SceneLayers, type Vec3 } from '@synthetos/gcode-view';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import { toolStore } from '../workspace/library.ts';
import { carveGrid } from './carveStock.ts';
import { carvePlan } from './carveTools.ts';

export interface CarveStatus {
  /** The file line carved through (0 for none). */
  readonly through: number;
  /** The carve has reached its target. */
  readonly done: boolean;
  /** The lowest top carved so far, in the path frame (the stock top when nothing is cut). */
  readonly lowest: number;
  /** Why carving stopped, when the worker failed. */
  readonly failed: string | null;
}

export interface CarveInfo {
  /** The heightmap's cell size, mm. */
  readonly cell: number;
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
}

const IDLE: CarveStatus = Object.freeze({ through: 0, done: false, lowest: 0, failed: null });

export function useCarve({ spawn, result, layers, pathOffset, target, enabled }: CarveInput): CarveView {
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
        status.value = { through: p.through > 0 && lines !== null ? (lines[p.through - 1] ?? 0) : 0, done: p.done, lowest: p.lowest, failed: p.error ?? null };
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
  const plan = useMemo(() => (result === null || segments === null ? null : carvePlan(result.tools, result.sourceLines, segments, table)), [result, segments, table]);
  const lines = segments === null ? 0 : segments.lineToVertex.length - 1;
  const goal = target === null ? lines : Math.min(lines, Math.max(0, target));
  const goalRef = useRef(goal);
  goalRef.current = goal;

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
    client.seek(goalRef.current);
  }, [client, segments, grid, plan]);
  useEffect(() => { client?.seek(goal); }, [client, goal]);

  const active = client !== null && grid !== null && plan !== null;
  const info = useMemo(() => (active && grid !== null && plan !== null ? { cell: grid.cell, uncarved: plan.uncarved, status } : null), [active, grid, plan, status]);
  return { feed: active ? client : null, info };
}
