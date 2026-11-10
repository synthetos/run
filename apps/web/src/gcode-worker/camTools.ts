/**
 * The tools a file's comments describe (tool-mismatch, 2026-11-10): what the CAM said T1 is, so the page can say when
 * the tool table's T1 is something else. Shapes read, from real posts:
 *
 * - Fusion: `(T1 D=6 CR=0 - ZMIN=-5 - flat end mill)`, `(T2 D=3.175 CR=1.5875 - ZMIN=-3 - ball end mill)`;
 * - Carbide Create: `(TOOL/MILL,6.35,0.00,0.00,0.00)` (diameter, corner radius, length, angle) before `M6T102`, which
 *   gives the T number;
 * - Vectric: `( T1 : End Mill (6 mm) )`, `(T3 : 60° V-Bit (1/2"))`;
 * - Estlcam style: `;T1: 6mm Flat End Mill`;
 * - SolidCraft: `(Boss top: T1 D6 flat end mill)`;
 * - CamBam: `( T0 : 0.001 )` (the diameter alone).
 *
 * A comment counts when it names a T number and a diameter or a tool type. A bare diameter is in the file's units
 * (its first G20 or G21; millimetres when it has none); `6mm`, `0.25in`, `1/4"` say their own. The first description
 * of a T number wins. Descriptive only: nothing here changes what is sent or drawn.
 */
import type { ToolType } from '@synthetos/library';
import { lineText } from './lines.ts';

export interface FileTool {
  readonly number: number;
  /** The cutting diameter in millimetres, or null when the comment gives none. */
  readonly diameterMm: number | null;
  /** The tool type the comment names, or null. */
  readonly type: ToolType | null;
  readonly cornerRadiusMm?: number;
  /** A V-bit's or chamfer mill's included angle, degrees. */
  readonly vAngle?: number;
  /** The comment as written (at most 120 characters). */
  readonly text: string;
  /** Its file line, 1-based. */
  readonly line: number;
}

/** At most this many tools are kept. */
export const MAX_FILE_TOOLS = 64;
const MM_PER_IN = 25.4;
/** A diameter outside this range (mm) is a misread, not a tool. */
const MIN_MM = 0.05;
const MAX_MM = 100;

type Unit = 'mm' | 'in' | null;

/** The tool type a description names, most specific first. */
const TYPES: readonly (readonly [RegExp, ToolType])[] = [
  [/bull\s*-?\s*nose|radius\s+(?:end\s*)?mill|corner\s+rad/i, 'bull-nose'],
  [/\bball\b/i, 'ball'],
  [/engrav/i, 'engraver'],
  [/chamfer/i, 'chamfer'],
  [/\bv[\s-]?(?:bit|groove|cutter|carve)\b|\bvee\b|\bv\s*\d{2,3}\s*(?:°|deg)/i, 'v-bit'],
  [/\b(?:spot\s*)?drill\b/i, 'drill'],
  [/\bo[\s-]?flute|single[\s-]flute/i, 'o-flute'],
  [/surfac|fly[\s-]?cut|face\s*mill/i, 'surfacing'],
  [/flat|end\s*-?\s*mill|square|up[\s-]?cut|down[\s-]?cut|compression|slot\s*mill/i, 'flat'],
];

function typeOf(text: string): ToolType | null {
  for (const [re, type] of TYPES) if (re.test(text)) return type;
  return null;
}

function toMm(value: number, unit: Unit, fileUnit: 'mm' | 'in'): number {
  return (unit ?? fileUnit) === 'in' ? value * MM_PER_IN : value;
}

function unitOf(word: string | undefined): Unit {
  if (word === undefined || word === '') return null;
  return /^(?:in|inch|inches|")$/i.test(word.trim()) ? 'in' : 'mm';
}

function num(s: string): number {
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac !== null) return Number(frac[1]) / Number(frac[2]);
  return Number(s);
}

/** A diameter in a description: value and unit (null: the file's units). */
function diameterOf(text: string): { readonly value: number; readonly unit: Unit } | null {
  const patterns: readonly RegExp[] = [
    /\bD\s*=\s*(\d*\.?\d+)\s*(mm|in|")?/i,
    /(?:dia(?:meter)?|Ø|⌀)\s*[:=]?\s*(\d+\s*\/\s*\d+|\d*\.?\d+)\s*(mm|inch|in|")?/i,
    /\bD(\d*\.?\d+)\s*(mm|in|")?(?![\d.])/,
    /(\d+\s*\/\s*\d+)\s*("|in(?:ch)?\b)/i,
    /(\d*\.?\d+)\s*(mm|inch|in|")(?![a-z])/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m === null) continue;
    const value = num((m[1] as string).replace(/\s+/g, ''));
    if (Number.isFinite(value) && value > 0) return { value, unit: unitOf(m[2]) };
  }
  return null;
}

/** The comment parts of a line: `( … )` (outermost, so Vectric's inner brackets stay) and `; …`. */
export function commentsOf(line: string): readonly string[] {
  const out: string[] = [];
  const open = line.indexOf('(');
  const semi = line.indexOf(';');
  if (open >= 0 && (semi < 0 || open < semi)) {
    const close = line.lastIndexOf(')');
    out.push(close > open ? line.slice(open + 1, close) : line.slice(open + 1));
  } else if (semi >= 0) {
    out.push(line.slice(semi + 1));
  }
  return out.map((c) => c.trim()).filter((c) => c.length > 0);
}

const T_WORD = /(?:^|[^A-Z0-9])T\s?(\d{1,3})(?![\d.])/i;
const CARBIDE = /^TOOL\/MILL\s*,\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)/i;
const CAMBAM = /^T(\d{1,3})\s*:\s*(\d*\.?\d+)\s*$/i;
const TOOL_CHANGE_T = /(?:^|[^A-Z0-9.])(?:M0*6\s*T\s*(\d{1,3})|T\s*(\d{1,3})\s*M0*6)(?![\d.])/i;
const UNITS = /(?:^|[^A-Z0-9.])G\s*(20|21)(?![\d.])/i;

/** A tool from one comment, before units are known: the diameter keeps its unit (null: the file's). */
interface Raw {
  readonly number: number;
  readonly diameter: { readonly value: number; readonly unit: Unit } | null;
  readonly type: ToolType | null;
  readonly corner?: { readonly value: number; readonly unit: Unit };
  readonly vAngle?: number;
  readonly text: string;
  readonly line: number;
}

/**
 * One comment as a tool, or null. `number` is the T number to use when the comment carries none: the tool change
 * after a Carbide Create TOOL/MILL line, or the T on the comment's own line (`M6 T1 (6mm end mill)`).
 */
export function toolOfComment(comment: string, line: number, number: number | null = null): Raw | null {
  const text = comment.slice(0, 120);
  const carbide = CARBIDE.exec(comment);
  if (carbide !== null) {
    if (number === null) return null;
    const d = Number(carbide[1]);
    const r = Number(carbide[2]);
    const angle = Number(carbide[4]);
    const type: ToolType = angle > 0 ? 'v-bit' : r > 0 && Math.abs(r - d / 2) < 1e-3 ? 'ball' : r > 0 ? 'bull-nose' : 'flat';
    return { number, diameter: { value: d, unit: null }, type, ...(r > 0 && type === 'bull-nose' ? { corner: { value: r, unit: null } } : {}), ...(angle > 0 ? { vAngle: angle } : {}), text, line };
  }
  const cambam = CAMBAM.exec(comment);
  if (cambam !== null) return { number: Number(cambam[1]), diameter: { value: Number(cambam[2]), unit: null }, type: null, text, line };
  const t = T_WORD.exec(comment);
  const tool = t !== null ? Number(t[1]) : number;
  if (tool === null) return null;
  // The rest of the comment after the T number, so "T1" itself is never read as a size.
  const rest = t === null ? comment : comment.slice(t.index + t[0].length);
  const before = t === null ? '' : comment.slice(0, t.index);
  const diameter = diameterOf(rest) ?? diameterOf(before);
  // The description after the T number names the type; the operation's name before it ("Drill holes: T3 D2 flat end
  // mill") only when the description names none.
  let type = typeOf(rest) ?? typeOf(before);
  // Fusion's corner radius: half the diameter is a ball, more than 0 a bull-nose.
  const cr = /\bCR\s*=\s*(\d*\.?\d+)/i.exec(comment);
  const corner = cr === null ? 0 : Number(cr[1]);
  if (diameter !== null && corner > 0 && (type === null || type === 'flat')) type = Math.abs(corner - diameter.value / 2) < 1e-3 ? 'ball' : 'bull-nose';
  // Fusion's TAPER is the angle per side, so the included angle is twice it; "60°" or "60 deg" is the included angle.
  const angle = /TAPER\s*=\s*(\d{1,3})/i.exec(comment) ?? /(\d{2,3})\s*(?:°|deg)/i.exec(comment);
  if (diameter === null && type === null) return null;
  const vAngle = angle !== null && (type === 'v-bit' || type === 'chamfer' || type === 'engraver') ? Number(angle[1]) * (/TAPER/i.test(angle[0]) ? 2 : 1) : undefined;
  return {
    number: tool,
    diameter,
    type,
    ...(corner > 0 && type === 'bull-nose' && diameter !== null ? { corner: { value: corner, unit: diameter.unit } } : {}),
    ...(vAngle === undefined ? {} : { vAngle }),
    text,
    line,
  };
}

function resolve(raw: Raw, fileUnit: 'mm' | 'in'): FileTool | null {
  const d = raw.diameter === null ? null : toMm(raw.diameter.value, raw.diameter.unit, fileUnit);
  if (d !== null && (d < MIN_MM || d > MAX_MM)) return raw.type === null ? null : { number: raw.number, diameterMm: null, type: raw.type, text: raw.text, line: raw.line };
  return {
    number: raw.number,
    diameterMm: d === null ? null : Math.round(d * 1000) / 1000,
    type: raw.type,
    ...(raw.corner === undefined ? {} : { cornerRadiusMm: Math.round(toMm(raw.corner.value, raw.corner.unit, fileUnit) * 1000) / 1000 }),
    ...(raw.vAngle === undefined ? {} : { vAngle: raw.vAngle }),
    text: raw.text,
    line: raw.line,
  };
}

/** The described tools of a file given as lines (tests, and the worker through `fileTools`). */
export function fileToolsFromLines(lines: Iterable<string>): readonly FileTool[] {
  const raws: Raw[] = [];
  const seen = new Set<number>();
  let unit: 'mm' | 'in' | null = null;
  let carbide: { readonly comment: string; readonly line: number } | null = null;
  let n = 0;
  for (const text of lines) {
    n++;
    const comments = commentsOf(text);
    const code = (text.split('(')[0] ?? '').split(';')[0] ?? '';
    if (unit === null && code.length > 0) {
      const u = UNITS.exec(code);
      if (u !== null) unit = u[1] === '20' ? 'in' : 'mm';
    }
    const tc = code.length > 0 ? TOOL_CHANGE_T.exec(code) : null;
    const codeTool = tc === null ? null : Number(tc[1] ?? tc[2]);
    if (carbide !== null && codeTool !== null) {
      const raw = toolOfComment(carbide.comment, carbide.line, codeTool);
      if (raw !== null && !seen.has(raw.number)) {
        seen.add(raw.number);
        raws.push(raw);
      }
      carbide = null;
    }
    for (const c of comments) {
      if (CARBIDE.test(c)) {
        carbide = { comment: c, line: n };
        continue;
      }
      const raw = toolOfComment(c, n, codeTool);
      if (raw === null || seen.has(raw.number) || raws.length >= MAX_FILE_TOOLS) continue;
      seen.add(raw.number);
      raws.push(raw);
    }
  }
  const fileUnit = unit ?? 'mm';
  return raws.map((r) => resolve(r, fileUnit)).filter((t): t is FileTool => t !== null).sort((a, b) => a.number - b.number);
}

const OPEN = 40; // '('
const SEMI = 59; // ';'
const G = 71;
const g = 103;
const M = 77;
const m = 109;

/**
 * The worker's pass over the file: only lines with a comment, a G (units) or an M (a Carbide Create tool change) are
 * read as text; every other line costs a byte scan.
 */
export function fileTools(bytes: Uint8Array, spans: Uint32Array): readonly FileTool[] {
  function* lines(): Generator<string> {
    const count = spans.length / 2;
    for (let i = 0; i < count; i++) {
      const start = spans[i * 2] as number;
      const end = spans[i * 2 + 1] as number;
      let wanted = false;
      for (let at = start; at < end; at++) {
        const b = bytes[at];
        if (b === OPEN || b === SEMI || b === G || b === g || b === M || b === m) {
          wanted = true;
          break;
        }
      }
      yield wanted ? lineText(bytes, spans, i) : '';
    }
  }
  return fileToolsFromLines(lines());
}
