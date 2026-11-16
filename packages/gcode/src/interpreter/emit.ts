import {
  PLANES,
  type ArcModel,
  type Axis,
  type Plane
} from '@synthetos/safety';
import { DEFAULT_CHORD_MM, arcBox, arcSegments, tessellateArc } from '../arcs.ts';
import { KIND, type Box, type InterpretOptions } from '../types.ts';
import { DEFAULT_VERTEX_CAP } from './constants.ts';
import { type Emitted, type Piece, type Pos } from './contract.ts';
import { type InterpreterContext } from './state.ts';

export function emit(it: InterpreterContext, lineCount: number, options: InterpretOptions): Emitted {
  const { total, chord } = sizeVertices({ options, it });
  const vertices = new Float32Array(total * 3);
  const kinds = new Uint8Array(total);
  const lineToVertex = new Uint32Array(lineCount + 1);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const arcBoxes: Emitted['arcBoxes'] = [];
  let v = 0;
  const push = (x: number, y: number, z: number, k: number): void => {
    vertices[v * 3] = x;
    vertices[v * 3 + 1] = y;
    vertices[v * 3 + 2] = z;
    kinds[v] = k;
    v++;
  };
  const grow = (x: number, y: number, z: number): void => {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  };
  const start = it.options.start?.machine ?? {};
  const s = { X: start.X ?? 0, Y: start.Y ?? 0, Z: start.Z ?? 0 };
  push(s.X, s.Y, s.Z, KIND.BREAK);
  let drawnAny = false;
  let line = 0;
  let prev = s;
  for (const p of it.pieces) {
    while (line <= p.line) lineToVertex[line++] = v;
    const from = prev;
    prev = { X: p.to.X, Y: p.to.Y, Z: p.to.Z };
    if (p.kind === 'line' || p.kind === 'jump') {
      if (p.kind === 'line') {
        grow(from.X, from.Y, from.Z);
        grow(p.to.X, p.to.Y, p.to.Z);
        drawnAny = true;
      }
      push(p.to.X, p.to.Y, p.to.Z, p.k);
      continue;
    }
    emitArcPiece({ p, chord, push, arcBoxes, grow });
    drawnAny = true;
  }
  while (line <= lineCount) lineToVertex[line++] = v;
  return { vertices, kinds, lineToVertex, bounds: drawnAny ? { min, max } : null, chordMm: chord, arcBoxes };
}

export function emitArcPiece({ p, chord, push, arcBoxes, grow }: EmitArcPieceInput): void {

  const ax = PLANES[p.plane];
  const a0 = ax.a0 as Axis;
  const a1 = ax.a1 as Axis;
  const lin = ax.lin as Axis;
  const pts = tessellateArc(p.arc, arcSegments(p.arc, chord));
  pts.forEach(([d0, d1, f], idx) => {
    const q = { ...p.from };
    if (idx === pts.length - 1) Object.assign(q, p.to);
    else {
      q[a0] = p.from[a0] + d0;
      q[a1] = p.from[a1] + d1;
      q[lin] = p.from[lin] + (p.to[lin] - p.from[lin]) * f;
    }
    push(q.X, q.Y, q.Z, p.k);
  });
  const b = arcBox(p.arc);
  const bmin = { ...p.from };
  const bmax = { ...p.from };
  bmin[a0] = p.from[a0] + Math.min(b.min[0], p.to[a0] - p.from[a0]);
  bmin[a1] = p.from[a1] + Math.min(b.min[1], p.to[a1] - p.from[a1]);
  bmax[a0] = p.from[a0] + Math.max(b.max[0], p.to[a0] - p.from[a0]);
  bmax[a1] = p.from[a1] + Math.max(b.max[1], p.to[a1] - p.from[a1]);
  bmin[lin] = Math.min(p.from[lin], p.to[lin]);
  bmax[lin] = Math.max(p.from[lin], p.to[lin]);
  const box: Box = { min: [bmin.X, bmin.Y, bmin.Z], max: [bmax.X, bmax.Y, bmax.Z] };
  arcBoxes.push({ line: p.line, box });
  grow(...box.min);
  grow(...box.max);
}

export function sizeVertices({ options, it }: SizeVerticesInput): { total: number; chord: number } {

  const cap = Math.max(2, options.vertexCap ?? DEFAULT_VERTEX_CAP);
  let chord = options.chordMm ?? DEFAULT_CHORD_MM;
  const fixed = 1 + it.pieces.filter((p) => p.kind !== 'arc').length;
  const arcs = it.pieces.filter((p): p is Extract<Piece, { kind: 'arc' }> => p.kind === 'arc');
  const count = (tol: number): number => arcs.reduce((s, p) => s + arcSegments(p.arc, tol), 0);
  // Coarsen arcs until the total fits (chord error grows with the square of the step).
  for (let guard = 0; guard < 64 && fixed + count(chord) > cap && count(chord) > arcs.length; guard++) {
    const ratio = count(chord) / Math.max(1, cap - fixed);
    chord *= Math.max(1.5, ratio * ratio);
  }
  const total = fixed + count(chord);
  return { total, chord };
}

interface EmitArcPieceInput {
  p: { readonly kind: "arc"; readonly line: number; readonly from: Pos; readonly to: Pos; readonly arc: ArcModel; readonly plane: Plane; readonly k: number; };
  chord: number;
  push: (x: number, y: number, z: number, k: number) => void;
  arcBoxes: { line: number; box: Box; }[];
  grow: (x: number, y: number, z: number) => void
}

interface SizeVerticesInput {
  options: InterpretOptions;
  it: InterpreterContext
}
