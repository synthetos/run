/**
 * CAM operation headings in a file's comments (docs/design/ANALYZE.md slice 1). Two shapes name the operation that
 * follows:
 * - a numbered heading such as `(01 Pocket)` or `(2 Adaptive - T1)`;
 * - a comment-only line just before a tool change, such as `(O-ring groove: T2 D3 flat end mill)` (the text before a
 *   colon is the name).
 * Descriptive only: a heading never stops motion or changes the interpretation, which comes from the interpreter's
 * event tape alone. Lines that do not start with `(` cost one byte check; only the few lines after a comment are read.
 */
import type { OperationHeading } from '@synthetos/advisor';
import { lineText } from './lines.ts';

const OPEN = 40; // '('
const NUMBERED = /^\s*\(\d{1,3}\s+([^()-]+?)(?:\s*-[^)]*)?\)\s*$/;
const COMMENT = /^\s*\(([^()]{1,200})\)\s*$/;
const TOOL_CHANGE = /(^|[^A-Z0-9.])M0*6(?![0-9.])/i;
/** A comment names the operation when a tool change follows within this many lines. */
const WINDOW = 3;
/** At most this many headings are kept (a CAM file has a handful). */
export const MAX_HEADINGS = 500;

function nameOf(comment: string): string {
  const before = comment.split(':')[0] ?? comment;
  return before.trim().slice(0, 60);
}

export function operationHeadings(bytes: Uint8Array, spans: Uint32Array): OperationHeading[] {
  const out: OperationHeading[] = [];
  const lines = spans.length / 2;
  let pending: { line: number; name: string } | null = null;
  for (let i = 0; i < lines && out.length < MAX_HEADINGS; i++) {
    let at = spans[i * 2] as number;
    const end = spans[i * 2 + 1] as number;
    while (at < end && (bytes[at] === 32 || bytes[at] === 9)) at++;
    if (bytes[at] === OPEN) {
      const text = lineText(bytes, spans, i);
      const numbered = NUMBERED.exec(text);
      if (numbered !== null) {
        out.push({ line: i + 1, name: (numbered[1] as string).trim() });
        pending = null;
        continue;
      }
      const comment = COMMENT.exec(text);
      if (comment !== null && nameOf(comment[1] as string) !== '') pending = { line: i + 1, name: nameOf(comment[1] as string) };
      continue;
    }
    if (pending === null) continue;
    if (i + 1 - pending.line > WINDOW) {
      pending = null;
      continue;
    }
    if (TOOL_CHANGE.test(lineText(bytes, spans, i))) {
      out.push(pending);
      pending = null;
    }
  }
  return out;
}

/** CAM programs a file's header comments may name, and the name Analyze uses for each. */
const CAMS: readonly (readonly [RegExp, string])[] = [
  [/\bfusion\b|autodesk/i, 'Fusion'],
  [/vcarve|aspire|vectric/i, 'Vectric'],
  [/carbide\s*create/i, 'Carbide Create'],
  [/estlcam/i, 'Estlcam'],
  [/freecad/i, 'FreeCAD'],
  [/easel/i, 'Easel'],
];
/** Only this many first lines are read for the CAM's name. */
const HEADER_LINES = 30;

/** The CAM program the file's header comments name, or null. */
export function camName(bytes: Uint8Array, spans: Uint32Array): string | null {
  const lines = Math.min(HEADER_LINES, spans.length / 2);
  for (let i = 0; i < lines; i++) {
    const text = lineText(bytes, spans, i);
    if (!text.includes('(') && !text.includes(';')) continue;
    for (const [re, name] of CAMS) if (re.test(text)) return name;
  }
  return null;
}
