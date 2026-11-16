import type { Dialect, DialectJobGcode } from '@synthetos/protocol';
import {
  type Plane,
  type SentLine,
  type Wcs
} from '@synthetos/safety';
import { EventRecorder } from '../events.ts';
import { FrameRecorder } from '../frames.ts';
import { type Finding, type InterpretOptions } from '../types.ts';
import { type Motion, type Piece, type Pos } from './contract.ts';

export class InterpreterState {

  readonly findings: Finding[] = [];

  readonly pieces: Piece[] = [];

  readonly flags!: Uint8Array;

  readonly pausePoints: number[] = [];

  /** The analytic event tape (events.ts), recorded as the lines are stepped. */
  readonly events!: EventRecorder;

  /** The program-to-path offset table (frames.ts), filled as the lines are stepped. */
  readonly frameTable!: FrameRecorder;

  machine!: Pos;

  units!: 'G20' | 'G21';

  distance!: 'G90' | 'G91';

  arcDistance!: 'G90.1' | 'G91.1';

  plane!: Plane;

  motion!: Motion;

  feed!: number | undefined;

  wcs!: Wcs;

  wcsOffsets!: Record<Wcs, Pos>;

  g92!: { offsets: Pos; active: boolean };

  tool!: Pos;

  g28!: Pos | null;

  g30!: Pos | null;

  spindle!: 'off' | 'cw' | 'ccw';

  mist!: boolean;

  flood!: boolean;

  readonly defaults!: { units: 'G20' | 'G21'; distance: 'G90' | 'G91'; plane: Plane; wcs: Wcs };

  /** Everything from here on is uncertain. */
  uncertain = false;

  seconds: number | null = 0;

  rapidMm = 0;

  feedMm = 0;

  arcs = 0;

  unitsSeen = false;

  distanceSeen = false;

  movedYet = false;

  readonly once = new Set<string>();


  readonly dialect!: Dialect;

  readonly job!: DialectJobGcode;

  readonly lines!: readonly SentLine[];

  readonly options!: InterpretOptions;
}

export type InterpreterContext = { -readonly [K in keyof InterpreterState]: InterpreterState[K] };
