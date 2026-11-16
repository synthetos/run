import {
  type ArcModel,
  type Axis,
  type Plane
} from '@synthetos/safety';
import { type Box } from '../types.ts';

export type Pos = Record<Axis, number>;

export type Motion = 'G0' | 'G1' | 'G2' | 'G3' | 'G80';

/** One drawable piece of a line, collected before tessellation (so the vertex cap can coarsen arcs). */
export type Piece =
  | { readonly kind: 'line'; readonly line: number; readonly to: Pos; readonly k: number }
  | { readonly kind: 'arc'; readonly line: number; readonly from: Pos; readonly to: Pos; readonly arc: ArcModel; readonly plane: Plane; readonly k: number }
  | { readonly kind: 'jump'; readonly line: number; readonly to: Pos; readonly k: number };

export interface Emitted {
  vertices: Float32Array;
  kinds: Uint8Array;
  lineToVertex: Uint32Array;
  bounds: Box | null;
  chordMm: number;
  /** Per vertex: the exact arc box for arc pieces is checked separately. */
  arcBoxes: Array<{ line: number; box: Box }>;
}
