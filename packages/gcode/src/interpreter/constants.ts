import {
  type Axis,
  type Plane
} from '@synthetos/safety';

/** TOOLS_PLAN §6.2: total vertex cap before arcs are coarsened. */
export const DEFAULT_VERTEX_CAP = 20_000_000;

export const ROTARY: ReadonlySet<Axis> = new Set<Axis>(['A', 'B', 'C']);

/** The arc plane's index in the event tape (events.ts). */
export const PLANE_INDEX: Readonly<Record<Plane, number>> = { G17: 0, G18: 1, G19: 2 };

export const MM_PER_INCH = 25.4;
