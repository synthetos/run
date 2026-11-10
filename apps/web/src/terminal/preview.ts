/**
 * What a typed move will do, in words, before it is sent (H91, design doc "Modes are shown"): "Moves X to 10 mm
 * (absolute, G54)". The modes come from the board's own reads, never assumed; a mode not read is said so. A G20, G21,
 * G90, G91, G53 or G54..G59 in the line itself is what the board will use for it. The session decides again.
 *
 * Pure.
 */
import type { TypedLine } from '@synthetos/safety';

/** The board's modes as read: `unit` (0 inches, 1 mm), `dist` (0 absolute, 1 relative), `coor` (1..6 = G54..G59). */
export interface BoardModes {
  readonly units: number | undefined;
  readonly dist: number | undefined;
  readonly coor: number | undefined;
}

const AXES = ['X', 'Y', 'Z', 'A', 'B', 'C'] as const;

function unitWord(units: number | undefined): string {
  return units === 1 ? 'mm' : units === 0 ? 'in' : '(units not read)';
}

function system(coor: number | undefined): string {
  return coor !== undefined && Number.isInteger(coor) && coor >= 1 && coor <= 6 ? `G${53 + coor}` : 'work system not read';
}

/** The modes in effect, for the line above the input: "mm · absolute · G54". */
export function modesLine(m: BoardModes): string {
  const dist = m.dist === 0 ? 'absolute' : m.dist === 1 ? 'relative' : 'distance mode not read';
  return `${unitWord(m.units)} · ${dist} · ${system(m.coor)}`;
}

/** The modes this line runs with: the board's, with the line's own G20/G21, G90/G91 and G53/G54..G59 over them. */
export function lineModes(t: TypedLine, m: BoardModes): { readonly units: number | undefined; readonly dist: number | undefined; readonly frame: string } {
  const g = new Set(t.gcodes);
  const units = g.has(21) ? 1 : g.has(20) ? 0 : m.units;
  const dist = g.has(90) ? 0 : g.has(91) ? 1 : m.dist;
  const wcs = t.gcodes.find((x) => x >= 54 && x <= 59);
  const frame = g.has(53) ? 'machine coordinates' : wcs !== undefined ? `G${wcs}` : system(m.coor);
  return { units, dist, frame };
}

/** "Moves X to 10 mm (absolute, G54)", "Moves X by 2 mm (relative, G54)", "Waits 0.5 s". */
export function movePreview(t: TypedLine, m: BoardModes): string {
  if (t.motion === 4) return `Waits ${t.words.P as number} s`;
  const l = lineModes(t, m);
  const u = unitWord(l.units);
  const axes = AXES.filter((a) => t.words[a] !== undefined).map((a) => `${a} ${l.dist === 1 ? 'by' : 'to'} ${t.words[a] as number}${a === 'X' || a === 'Y' || a === 'Z' ? ` ${u}` : ''}`);
  const verb = t.motion === 0 ? 'Rapid: moves' : t.motion === 1 ? 'Moves' : t.motion === 2 ? 'Arc clockwise: moves' : 'Arc counter-clockwise: moves';
  const where = axes.length === 0 ? 'in a full circle' : axes.join(', ');
  const dist = l.dist === 0 ? 'absolute' : l.dist === 1 ? 'relative' : 'distance mode not read';
  const feed = t.words.F === undefined ? '' : ` at F${t.words.F}`;
  return `${verb} ${where}${feed} (${dist}, ${l.frame})`;
}
