/**
 * Messages between the page and the carve worker (docs/design/tool-sim.md,
 * slice 2). Types only.
 *
 * The page sends the file's segments once (`file`), then a carve session
 * (`setup`: the grid and the tools; a new file, tool table or stock starts a
 * new session), then targets (`seek`). The worker answers with `progress`:
 * the cells it changed since the last message (a copy, transferred), how far
 * it has carved, and the lowest top so far. Messages of an older session are
 * ignored on both sides.
 */
import type { ToolShape } from '../toolProfile.ts';
import type { CellRect, GridSpec } from './heightmap.ts';

export interface CarveSegments {
  readonly vertices: Float32Array;
  readonly kinds: Uint8Array;
  readonly lineToVertex: Uint32Array;
}

export interface CarveToolTable {
  readonly starts: Uint32Array;
  readonly shapes: readonly (ToolShape | null)[];
}

export type ToCarveWorker =
  | { readonly type: 'file'; readonly segments: CarveSegments | null }
  | { readonly type: 'setup'; readonly session: number; readonly spec: GridSpec | null; readonly tools: CarveToolTable }
  /** Carve lines 0..target-1 of the file. */
  | { readonly type: 'seek'; readonly session: number; readonly target: number };

export interface CarveProgressMessage {
  readonly type: 'progress';
  readonly session: number;
  /** The changed cells and their new tops (row-major, rect.w · rect.h), or null when none changed. */
  readonly rect: CellRect | null;
  readonly data: Float32Array | null;
  readonly through: number;
  readonly target: number;
  readonly done: boolean;
  readonly lowest: number;
}

export type FromCarveWorker = CarveProgressMessage | { readonly type: 'error'; readonly session: number; readonly message: string };
