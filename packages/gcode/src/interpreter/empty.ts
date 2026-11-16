import type { Dialect } from '@synthetos/protocol';
import {
  WCS_CODES,
  type Axis,
  type Wcs
} from '@synthetos/safety';
import { DEFAULT_CHORD_MM } from '../arcs.ts';
import { emptyTape } from '../events.ts';
import { emptyFrames } from '../frames.ts';
import { LINE_FLAG, type Finding, type InterpretOptions, type JobAnalysis } from '../types.ts';
import { zero } from './coordinates.ts';

export function emptyAnalysis(dialect: Dialect, findings: Finding[], lineCount: number, options: InterpretOptions): JobAnalysis {
  const { machine, offsets } = emptyState({ options });
  return {
    dialect: dialect.id,
    blocked: true,
    vertices: new Float32Array(0),
    kinds: new Uint8Array(0),
    lineToVertex: new Uint32Array(lineCount + 1),
    lineFlags: new Uint8Array(lineCount).fill(LINE_FLAG.NOT_DRAWN),
    lineFeeds: new Float32Array(lineCount).fill(Number.NaN),
    bounds: null,
    findings,
    pausePoints: [],
    frameTable: emptyFrames(),
    events: emptyTape(),
    stats: { lines: lineCount, rapidMm: 0, feedMm: 0, arcs: 0, estimatedSeconds: null, chordMm: options.chordMm ?? DEFAULT_CHORD_MM },
    end: {
      machine,
      units: options.start?.units ?? 'G21',
      distance: options.start?.distance ?? 'G90',
      plane: options.start?.plane ?? 'G17',
      wcs: options.start?.wcs ?? 'G54',
      wcsOffsets: offsets,
      g92: { offsets: zero(), active: false },
      spindle: 'off',
      mist: false,
      flood: false,
    },
  };
}

export function emptyState({ options }: EmptyStateInput): { machine: { X: number; Y: number; Z: number; A: number; B: number; C: number; }; offsets: Readonly<Record<Wcs, Readonly<Record<Axis, number>>>> } {

  const s = options.start?.machine ?? {};
  const machine = { X: s.X ?? 0, Y: s.Y ?? 0, Z: s.Z ?? 0, A: s.A ?? 0, B: s.B ?? 0, C: s.C ?? 0 };
  const offsets = Object.fromEntries(WCS_CODES.map((w) => [w, zero()])) as JobAnalysis['end']['wcsOffsets'];
  return { machine, offsets };
}

interface EmptyStateInput {
  options: InterpretOptions
}
