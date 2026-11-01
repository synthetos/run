/**
 * T-S1 (ROADMAP P0-10, SAFETY §10; OLD-S T-S1) as fast-check properties over
 * random files on every dialect that streams jobs:
 * - no sent line contains `!`, `~`, `%`, CR, LF, or a control byte other than tab;
 * - a kept file line keeps every word it had (only comments and N words go);
 * - N numbers are 1..k with no gaps, and `text` is `N<n> <body>`;
 * - no sent line starts with `$`, `?`, `H`, `h` or `{`;
 * - TinyG: no sent line has a comment at all (so none has text after one, or an unclosed `(`);
 * - no sent line is longer than the dialect limit or models above the ceiling;
 * - sanitising the output of an unblocked result again gives the same lines.
 *
 * "Preview geometry equals interpret(sanitize(x))" needs the preview
 * interpreter, which is TB-02's acceptance; it is not in this package.
 */
import fc from 'fast-check';
import { TINYG_440, TINYG_EN, type Dialect } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { canonicalCode, lexLine } from '../src/sanitize/lex.ts';
import { applyCommentRule, splitLines, trimLine } from '../src/sanitize/text.ts';
import { sanitizeJob, type SanitizeOptions, type SanitizeResult } from '../src/index.ts';
import { MOTION, START, runs } from './sanitizeHelpers.ts';

const DIALECTS: readonly Dialect[] = [TINYG_EN, TINYG_440];

const num = fc.oneof(
  fc.integer({ min: -400, max: 400 }).map(String),
  fc.double({ min: -400, max: 400, noNaN: true, noDefaultInfinity: true }).map((v) => v.toFixed(3)),
);

const word = fc.oneof(
  fc.constantFrom('G0', 'G1', 'G2', 'G3', 'G4', 'G17', 'G18', 'G19', 'G20', 'G21', 'G90', 'G91', 'G54', 'G55', 'G80', 'G92', 'G10', 'G53'),
  fc.constantFrom('M0', 'M1', 'M2', 'M3', 'M5', 'M6', 'M8', 'M9', 'M30', 'M60', 'G59.1', 'G01', 'M201.3', 'G38.2', 'M100', 'G93'),
  fc.tuple(fc.constantFrom('X', 'Y', 'Z', 'A', 'I', 'J', 'K', 'R', 'F', 'S', 'T', 'P', 'L', 'N', 'E', 'x'), num).map(([l, n]) => `${l}${n}`),
);

const comment = fc.oneof(
  fc.string({ maxLength: 12 }).map((s) => `(${s.replace(/[()\r\n]/g, '')})`),
  fc.string({ maxLength: 12 }).map((s) => `;${s.replace(/[\r\n]/g, '')}`),
  fc.constantFrom('(50% stepover)', '(TOOL CHANGE!)', '(unclosed', ')'),
);

const noise = fc.constantFrom('!', '~', '%', '$', '?', '{', 'h', 'H', '\x18', '\x04', '\x7f', 'é', '/', '#', '\t', ' ', '  ');

const line = fc.oneof(
  { weight: 6, arbitrary: fc.array(word, { minLength: 1, maxLength: 5 }).map((w) => w.join(' ')) },
  { weight: 2, arbitrary: fc.tuple(fc.array(word, { maxLength: 3 }), comment).map(([w, c]) => `${w.join(' ')} ${c}`) },
  { weight: 1, arbitrary: fc.tuple(comment, fc.array(word, { maxLength: 2 })).map(([c, w]) => `${c} ${w.join(' ')}`) },
  { weight: 2, arbitrary: fc.array(fc.oneof(word, noise), { minLength: 1, maxLength: 4 }).map((p) => p.join('')) },
  { weight: 1, arbitrary: fc.constantFrom('', '%', '%%', '   ', 'N10', 'M30') },
);

const file = fc
  .tuple(fc.array(line, { maxLength: 25 }), fc.array(fc.constantFrom('\n', '\r\n', '\r', '\n\r'), { minLength: 25, maxLength: 25 }))
  .map(([ls, seps]) => ls.map((l, i) => l + (seps[i] as string)).join(''));

const options = fc.record({
  c14: fc.boolean(),
  c22: fc.boolean(),
  optionalStop: fc.boolean(),
  known: fc.boolean(),
});

function sanitize(input: string, d: Dialect, o: { c14: boolean; c22: boolean; optionalStop: boolean; known: boolean }): SanitizeResult {
  const opts: SanitizeOptions = { motion: MOTION, c14: o.c14, c22: o.c22, optionalStop: o.optionalStop, ...(o.known ? { start: START } : {}) };
  return sanitizeJob(input, d, opts);
}

/** The words of a raw file line as the sanitiser must keep them (N removed, and M1 where it is dropped). */
function expectedWords(raw: string, dropM1: boolean): string[] {
  const c = applyCommentRule(raw, true);
  if (c.kind !== 'ok') throw new Error('a kept line must pass the comment rule');
  const lexed = lexLine(trimLine(c.code));
  if (lexed.kind !== 'ok') throw new Error('a kept line must lex');
  return lexed.words
    .filter((w) => w.letter !== 'N' && !(dropM1 && w.letter === 'M' && canonicalCode(w) === 'M1'))
    .map((w) => `${w.letter}${w.value}`);
}

function wordsOf(body: string): string[] {
  const lexed = lexLine(body);
  if (lexed.kind !== 'ok') throw new Error(`sent body does not lex: ${body}`);
  return lexed.words.map((w) => `${w.letter}${w.value}`);
}

describe('T-S1: sanitiser properties', () => {
  for (const d of DIALECTS) {
    it(`${d.id}: every sent line is clean, numbered, within limits and keeps its words`, () => {
      fc.assert(
        fc.property(file, options, (input, o) => {
          const r = sanitize(input, d, o);
          const raw = splitLines(input);
          const dropM1 = !o.optionalStop && d.gcode.job?.optionalStopOff === 'drop';
          r.lines.forEach((l, i) => {
            expect(l.n).toBe(i + 1);
            expect(l.text).toBe(`N${l.n} ${l.body}`);
            expect(/[!~%\r\n]/.test(l.text)).toBe(false);
            expect(/[^\x20-\x7e\t]/.test(l.text)).toBe(false);
            expect(/^[$?Hh{]/.test(l.body)).toBe(false);
            expect(/[(;)]/.test(l.text)).toBe(false);
            expect(l.text.length).toBeLessThanOrEqual(d.limits.maxLineBytes);
            expect(l.motion?.seconds ?? 0).toBeLessThanOrEqual(MOTION.ceilingSeconds);
            if (l.origin === 'file') expect(wordsOf(l.body)).toEqual(expectedWords(raw[l.sourceLine - 1] as string, dropM1));
          });
          expect(r.report.blocked).toBe(r.report.entries.some((e) => e.severity === 'block'));
        }),
        { numRuns: runs(400) },
      );
    });

    it(`${d.id}: an unblocked job ends with spindle and coolant off, re-derived from the sent lines (T-S76)`, () => {
      fc.assert(
        fc.property(file, options, (input, o) => {
          const r = sanitize(input, d, o);
          fc.pre(!r.report.blocked);
          let on = { spindle: false, mist: false, flood: false };
          for (const l of r.lines) {
            const codes = wordsOf(l.body);
            if (codes.includes('M3') || codes.includes('M4')) on = { ...on, spindle: true };
            if (codes.includes('M7')) on = { ...on, mist: true };
            if (codes.includes('M8')) on = { ...on, flood: true };
            if (codes.includes('M5')) on = { ...on, spindle: false };
            if (codes.includes('M9')) on = { ...on, mist: false, flood: false };
            if ((codes.includes('M2') || codes.includes('M30')) && d.gcode.job?.programEndStopsOutputs === true) {
              on = { spindle: false, mist: false, flood: false };
            }
          }
          expect(on).toEqual({ spindle: false, mist: false, flood: false });
          expect(r.report.endState).toEqual({ spindle: 'off', mist: false, flood: false });
        }),
        { numRuns: runs(400) },
      );
    });

    it(`${d.id}: sanitising an unblocked result again changes nothing`, () => {
      fc.assert(
        fc.property(file, options, (input, o) => {
          const r = sanitize(input, d, o);
          fc.pre(!r.report.blocked);
          const again = sanitize(r.lines.map((l) => l.text).join('\n'), d, o);
          expect(again.lines.map((l) => l.text)).toEqual(r.lines.map((l) => l.text));
          expect(again.lines.map((l) => [l.barrier, l.holdback])).toEqual(r.lines.map((l) => [l.barrier, l.holdback]));
          expect(again.report.blocked).toBe(false);
        }),
        { numRuns: runs(400) },
      );
    });
  }
});
