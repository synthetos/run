/**
 * Probe Z's Setup form (SAFETY §4.5c): the owner's text in, millimetres and plain messages out, against the limits
 * the session enforces again. Presets plus a custom value for the depth limit and the feed. Pure.
 */
import { PROBE_LIMITS, probeStopMm } from '../../machine-worker/probeShared.ts';

export interface ProbeForm {
  /** Plate thickness as typed, mm. */
  readonly thickness: string;
  /** The depth limit as typed or picked, mm, and whether the custom field is open. */
  readonly depth: string;
  readonly depthCustom: boolean;
  /** The probe feed as typed or picked, mm/min, and whether the custom field is open. */
  readonly feed: string;
  readonly feedCustom: boolean;
  /** "The spindle or router is stopped." */
  readonly spindleStopped: boolean;
}

export type ProbeField = 'thickness' | 'depth' | 'feed';

export type ProbeFormResult =
  | { readonly ok: true; readonly thicknessMm: number; readonly depthMm: number; readonly feed: number; readonly stopMm: number }
  | { readonly ok: false; readonly errors: Readonly<Partial<Record<ProbeField, string>>>; readonly stopMm: number | null };

/** A new form: the last thickness used on this board (or empty), and the default depth and feed. */
export function initialForm(lastThicknessMm: number | null): ProbeForm {
  return Object.freeze({
    thickness: lastThicknessMm === null ? '' : String(lastThicknessMm),
    depth: String(PROBE_LIMITS.depthMm.default),
    depthCustom: false,
    feed: String(PROBE_LIMITS.feed.default),
    feedCustom: false,
    spindleStopped: false,
  });
}

/** A plain decimal number, or null: digits with an optional point, nothing else. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  return Number(t);
}

function inRange(v: number | null, r: { readonly min: number; readonly max: number }): v is number {
  return v !== null && v >= r.min && v <= r.max;
}

/** Checks the form against the limits and the board's `zjh`. The spindle box is not an error; it holds the button. */
export function checkForm(form: ProbeForm, zjh: number | null): ProbeFormResult {
  const L = PROBE_LIMITS;
  const errors: Partial<Record<ProbeField, string>> = {};
  const thickness = parseNumber(form.thickness);
  const depth = parseNumber(form.depth);
  const feed = parseNumber(form.feed);
  if (form.thickness.trim() === '') errors.thickness = 'Enter the plate’s thickness.';
  else if (!inRange(thickness, L.thicknessMm)) errors.thickness = `Plate thickness can be ${L.thicknessMm.min} to ${L.thicknessMm.max} mm.`;
  if (!inRange(depth, L.depthMm)) errors.depth = `Depth limit can be ${L.depthMm.min} to ${L.depthMm.max} mm.`;
  const stopMm = inRange(feed, L.feed) ? probeStopMm(feed, zjh) : null;
  if (!inRange(feed, L.feed)) errors.feed = `Feed can be ${L.feed.min} to ${L.feed.max} mm/min.`;
  else if (stopMm === null) errors.feed = 'Run can’t work out how far Z travels after contact: the board’s Z jerk isn’t read.';
  else if (stopMm > L.maxStopMm) errors.feed = 'At this feed Z would travel too far after contact. Choose a slower feed.';
  if (errors.thickness !== undefined || errors.depth !== undefined || errors.feed !== undefined || stopMm === null) return { ok: false, errors, stopMm };
  return { ok: true, thicknessMm: thickness as number, depthMm: depth as number, feed: feed as number, stopMm };
}

/** Seconds the probe takes to reach the depth limit at the feed, rounded up. */
export function probeSeconds(depthMm: number, feed: number): number {
  return Math.ceil((depthMm / feed) * 60);
}
