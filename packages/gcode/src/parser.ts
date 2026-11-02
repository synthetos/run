/**
 * G-code line parser (ROADMAP TB-02, old P1-02).
 *
 * Forked from cncjs `gcode-parser` 2.2.0 (`parseLine` and its comment
 * stripper), converted to TypeScript and made streaming.
 *
 *   The MIT License (MIT)
 *   Copyright (c) 2015-present Cheton Wu
 *   (full text in THIRD_PARTY_NOTICES.md)
 *
 * Changes from upstream:
 * - it never throws: anything it cannot read becomes a `ParseError` item on
 *   the line, never a silently dropped word (upstream drops a lone letter and
 *   keeps a non-numeric argument as a string);
 * - every word keeps its value as a number, including 0: no truthiness test
 *   is ever applied to a value (upstream's interpreter had `if (params.R)`,
 *   which turns `R0` into "no R");
 * - input is an `AsyncIterable<string>` of chunks (or a string / lines),
 *   split on CR, LF or CRLF across chunk boundaries;
 * - no Node streams, timers, fs or events: this package has no runtime npm
 *   dependencies and runs in a worker.
 *
 * The parser is for display and analysis. What the interpreter acts on is
 * always the sanitiser's output (`sanitizeJob(...).lines`), never a raw file.
 */

export interface Word {
  /** Upper-case letter. */
  readonly letter: string;
  /** The numeric value as written (`R0` is 0, never "absent"). */
  readonly value: number;
  /** The word as written, whitespace removed (`G01`, `X-1.5`). */
  readonly text: string;
}

export interface ParseError {
  readonly kind: 'badNumber' | 'unparsed';
  /** The text that could not be read. */
  readonly text: string;
  readonly message: string;
}

export interface ParsedLine {
  /** 1-based line number in the input. */
  readonly lineNo: number;
  /** The line exactly as given, without its terminator. */
  readonly raw: string;
  /** Words other than the first N (line number) word. */
  readonly words: readonly Word[];
  /** The first N word's value, if any. */
  readonly n?: number;
  /** Comment bodies, in order, trimmed. */
  readonly comments: readonly string[];
  /** Controller commands (`$...`, `{...}`, `%...`) the line carries; never G-code. */
  readonly cmds: readonly string[];
  readonly errors: readonly ParseError[];
}

/**
 * Comments: `(...)` (nesting counted, as upstream) and `;` to end of line
 * outside parentheses. Returns the code with comments removed (trimmed) and
 * the comment bodies.
 */
function stripComments(line: string): { code: string; comments: string[] } {
  let code = '';
  let current = '';
  const comments: string[] = [];
  let open = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === ';' && open === 0) {
      comments.push(line.slice(i + 1).trim());
      break;
    }
    if (ch === '(') {
      if (open > 0) current += ch;
      else current = '';
      open++;
    } else if (ch === ')') {
      if (open === 0) {
        code += ch; // a stray ')' is code: it will be reported as unparsed
        continue;
      }
      open--;
      if (open === 0) {
        comments.push(current.trim());
        current = '';
      } else current += ch;
    } else if (open > 0) current += ch;
    else code += ch;
  }
  if (open > 0) comments.push(current.trim()); // unclosed: upstream keeps it as a comment too
  return { code: code.trim(), comments };
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const TOKEN = /(%.*)|(\{.*)|(\$\$|\$[a-zA-Z0-9#]*)|([a-zA-Z][0-9+\-.]*)|(\*[0-9]+)/g;

/** Parses one line. Never throws. */
export function parseLine(raw: string, lineNo = 1): ParsedLine {
  const { code, comments } = stripComments(raw);
  const compact = code.replace(/\s+/g, '');
  const words: Word[] = [];
  const cmds: string[] = [];
  const errors: ParseError[] = [];
  let n: number | undefined;
  let checksum = false;
  let consumed = 0;
  for (const m of compact.matchAll(TOKEN)) {
    const token = m[0];
    const at = m.index;
    if (at > consumed) errors.push(unparsed(compact.slice(consumed, at)));
    consumed = at + token.length;
    if (token === '') {
      // An empty match cannot happen with these alternatives; guard the loop anyway.
      consumed++;
      continue;
    }
    const first = token.charAt(0);
    if (first === '%' || first === '{') {
      cmds.push(raw.trim());
      continue;
    }
    if (first === '$') {
      cmds.push(token);
      continue;
    }
    if (first === '*') {
      if (checksum) errors.push(unparsed(token));
      checksum = true;
      continue;
    }
    const letter = first.toUpperCase();
    const arg = token.slice(1);
    if (!NUMBER.test(arg)) {
      errors.push({ kind: 'badNumber', text: token, message: `"${token}" has no valid number` });
      continue;
    }
    const value = Number(arg);
    if (letter === 'N' && n === undefined) {
      n = value;
      continue;
    }
    words.push({ letter, value, text: token });
  }
  if (consumed < compact.length) errors.push(unparsed(compact.slice(consumed)));
  return n === undefined
    ? { lineNo, raw, words, comments, cmds, errors }
    : { lineNo, raw, words, n, comments, cmds, errors };
}

function unparsed(text: string): ParseError {
  return { kind: 'unparsed', text, message: `"${text}" is not a G-code word` };
}

/** Parses a whole text or a sequence of lines. */
export function* parseLines(input: string | Iterable<string>): Generator<ParsedLine> {
  const lines = typeof input === 'string' ? input.split(/\r\n|\r|\n/) : input;
  let lineNo = 0;
  for (const line of lines) yield parseLine(line, ++lineNo);
}

/**
 * Parses a stream of text chunks (for example `File.stream()` through a
 * `TextDecoderStream`). Lines end at CR, LF or CRLF, also when the CR and the
 * LF arrive in different chunks. A final line without a terminator is parsed;
 * an empty final line after a terminator is not.
 */
export async function* parseStream(chunks: AsyncIterable<string>): AsyncGenerator<ParsedLine> {
  let carry = '';
  let lineNo = 0;
  let pendingCr = false;
  for await (const chunk of chunks) {
    let text = chunk;
    if (pendingCr && text.startsWith('\n')) text = text.slice(1);
    pendingCr = false;
    text = carry + text;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch !== 10 && ch !== 13) continue;
      yield parseLine(text.slice(start, i), ++lineNo);
      if (ch === 13) {
        if (i + 1 < text.length) {
          if (text.charCodeAt(i + 1) === 10) i++;
        } else pendingCr = true;
      }
      start = i + 1;
    }
    carry = text.slice(start);
  }
  if (carry !== '') yield parseLine(carry, ++lineNo);
}

/**
 * The canonical code of a G or M word: letter, integer without leading zeros
 * and, for a sub-code, the decimal without trailing zeros (`G01` → `G1`,
 * `G28.10` → `G28.1`), the form the dialect data uses.
 */
export function codeOf(word: Word): string | undefined {
  if (word.letter !== 'G' && word.letter !== 'M') return undefined;
  return `${word.letter}${String(word.value)}`;
}
