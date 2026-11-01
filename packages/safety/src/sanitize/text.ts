/**
 * Text-level steps of the sanitiser (SAFETY §4.7 steps 1–4): line endings,
 * comments and the byte checks that must run before anything is parsed.
 */

/**
 * Splits input into lines. CRLF, LFCR, CR and LF each end one line
 * (SAFETY §4.7 step 1; the same set as the protocol framer). A final
 * terminator does not start another line. An iterable is read as a sequence
 * of chunks that are themselves lines: each chunk ends a line, and any
 * terminator inside a chunk ends one more.
 */
export function splitLines(input: string | Iterable<string>): string[] {
  const chunks = typeof input === 'string' ? [input] : input;
  const out: string[] = [];
  for (const chunk of chunks) {
    let current = '';
    let i = 0;
    let endedOnTerminator = false;
    while (i < chunk.length) {
      const c = chunk[i];
      if (c === '\r' || c === '\n') {
        out.push(current);
        current = '';
        const pair = c === '\r' ? '\n' : '\r';
        i += chunk[i + 1] === pair ? 2 : 1;
        endedOnTerminator = true;
        continue;
      }
      current += c;
      i += 1;
      endedOnTerminator = false;
    }
    // A string's final terminator does not start a line. A chunk always ends one,
    // except an empty or terminated chunk, which already did.
    if (typeof input === 'string') {
      if (!endedOnTerminator && current !== '') out.push(current);
    } else if (!endedOnTerminator) {
      out.push(current);
    }
  }
  return out;
}

/** The first C0 control byte other than tab, or undefined. LF and CR never reach here (they end lines). */
export function findControlByte(line: string): number | undefined {
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code < 0x20 && code !== 0x09) return code;
  }
  return undefined;
}

export type CommentResult =
  | { readonly kind: 'ok'; readonly code: string; readonly stripped: boolean }
  | { readonly kind: 'unclosed' }
  | { readonly kind: 'textAfterComment' };

/**
 * Applies the comment rule (SAFETY §4.7 step 2).
 *
 * With `rejectTextAfterComment` (every TinyG dialect, and g2 until B-G2-7):
 * TinyG ends the block at the first `(` or `;` and silently drops the rest
 * (PN §9.3), so a line with code after a comment, a leading comment followed
 * by code, or an unclosed `(` is rejected, never "repaired" into code the
 * firmware would not have run. A trailing comment is stripped; further
 * complete comments after it are comments too and are stripped with it.
 *
 * Without it, every complete `(...)` comment and a final `;...` comment are
 * removed and the code around them is kept; an unclosed `(` is still rejected.
 */
export function applyCommentRule(line: string, rejectTextAfterComment: boolean): CommentResult {
  let code = '';
  let i = 0;
  let stripped = false;
  let sawComment = false;
  while (i < line.length) {
    const c = line[i];
    if (c === ';') {
      stripped = true;
      break;
    }
    if (c === '(') {
      const close = line.indexOf(')', i + 1);
      if (close < 0) return { kind: 'unclosed' };
      stripped = true;
      sawComment = true;
      if (!rejectTextAfterComment) code += ' ';
      i = close + 1;
      continue;
    }
    if (sawComment && rejectTextAfterComment && c !== ' ' && c !== '\t') return { kind: 'textAfterComment' };
    code += c;
    i += 1;
  }
  return { kind: 'ok', code, stripped };
}

/** Spaces and tabs at both ends (SAFETY §4.7 step 3). */
export function trimLine(line: string): string {
  return line.replace(/^[ \t]+|[ \t]+$/g, '');
}

/** A line that is only `%` tape markers (SAFETY §4.7 step 4). */
export function isTapeMarker(line: string): boolean {
  return /^%+$/.test(line);
}
