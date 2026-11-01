/**
 * Fact keys and fact patterns (ROADMAP TB-01; OLD TOOLS_PLAN §5.2; SAFETY
 * H28, H38).
 *
 * A fact key names one commissioning fact: a root from `FACT_ROOTS` and
 * zero or more lower-case segments, `dir.x`, `switch.xmin`, `outputs.spindle`,
 * `job.<sha256>.preflight`. A key never contains a wildcard.
 *
 * A pattern is what an invalidation rule clears: the same grammar, where a
 * segment may be `*` (any one segment). A pattern matches every key it is a
 * segment-wise PREFIX of, so `dir.*` clears `dir.x` and `dir.x.verified`,
 * and `softlimits` clears `softlimits.on`. Prefix matching can only clear
 * more facts than an exact match, never fewer: an invalidation rule errs on
 * the side of asking again.
 */
import { FACT_ROOTS } from '../overlays/types.ts';

const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const MAX_SEGMENTS = 6;

function segmentsOf(text: string, wildcard: boolean): string[] | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 300) return null;
  const segs = text.split('.');
  if (segs.length > MAX_SEGMENTS || !(FACT_ROOTS as readonly string[]).includes(segs[0] as string)) return null;
  for (const seg of segs.slice(1)) if (!(SEGMENT.test(seg) || (wildcard && seg === '*'))) return null;
  return segs;
}

/** Whether `key` is a well-formed fact key (no wildcard). */
export function isFactKey(key: unknown): key is string {
  return typeof key === 'string' && segmentsOf(key, false) !== null;
}

/** Whether `pattern` is a well-formed fact pattern (`*` segments allowed). */
export function isFactPattern(pattern: unknown): pattern is string {
  return typeof pattern === 'string' && segmentsOf(pattern, true) !== null;
}

/** Whether `pattern` clears `key`. A malformed pattern or key never matches (and the rules test refuses malformed patterns). */
export function patternMatches(pattern: string, key: string): boolean {
  const p = segmentsOf(pattern, true);
  const k = segmentsOf(key, false);
  if (p === null || k === null || p.length > k.length) return false;
  return p.every((seg, i) => seg === '*' || seg === k[i]);
}

/** The root of a fact key (`dir` for `dir.x`). */
export function factRoot(key: string): string {
  return key.split('.')[0] as string;
}
