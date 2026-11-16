import type { Dialect, DialectJobGcode } from '@synthetos/protocol';
import {
  type SanitizeResult,
  type SentLine
} from '@synthetos/safety';
import { codeOf, parseLine } from '../parser.ts';
import { LINE_FLAG, type InterpretOptions } from '../types.ts';
import { offset } from './coordinates.ts';
import { addFinding } from './findings.ts';
import { createInterpreter } from './initialize.ts';
import { type InterpreterContext } from './state.ts';
import { stepLine } from './words.ts';

export function interpretLines({ dialect, job, lines, options, result }: InterpretLinesInput): { it: InterpreterContext; lastIndex: number; lineFeeds: Float32Array<ArrayBuffer> } {


  const it = createInterpreter(dialect, job, lines, options);

  // Lines the sanitiser rejected were not sent: everything after the first one is uncertain.
  const sentSources = new Set(lines.map((l) => l.sourceLine));
  // A loop, not Math.min(...spread): a large file can reject more lines than the engine accepts as arguments.
  let firstRejected = Infinity;
  for (const e of result.report.entries) {
    if (e.severity === 'block' && e.line > 0 && e.line < firstRejected && !sentSources.has(e.line)) firstRejected = e.line;
  }
  const lastIndex = lines.length - 1;
  const lineFeeds = new Float32Array(lines.length);
  lines.forEach((line, i) => {
    if (!it.uncertain && line.sourceLine > firstRejected) {
      it.uncertain = true;
      addFinding(it, line.sourceLine, line.n, 'info', 'after-rejected-line', `Line ${String(firstRejected)} is blocked, so it isn't sent: positions after it may not match what the file intends.`);
    }
    it.events.begin(i);
    stepLine(it, line, i, i === lastIndex);
    it.events.end(((it.flags[i] as number) & LINE_FLAG.NOT_DRAWN) !== 0);
    // The feed after the line's own words: an F on the line applies to its move.
    lineFeeds[i] = it.feed ?? Number.NaN;
    it.frameTable.note(line.sourceLine, offset(it, 'X'), offset(it, 'Y'), offset(it, 'Z'));
  });
  return { it, lastIndex, lineFeeds };
}

export function fileFindings({ lines, it, lastIndex }: FileFindingsInput): void {


  // File-level findings.
  const anyCode = (set: readonly string[]): boolean =>
    lines.some((l) => parseLine(l.body).words.some((w) => set.includes(codeOf(w) ?? '')));
  if (lines.length > 0 && !anyCode(['G20', 'G21'])) addFinding(it, 0, null, 'warn', 'units-never-set', 'the file never sets G20 or G21: it runs in whatever units the board is in');
  if (lines.length > 0 && !anyCode(['G90', 'G91'])) addFinding(it, 0, null, 'warn', 'distance-never-set', 'the file never sets G90 or G91: it runs in whatever distance mode the board is in');
  if (it.distance === 'G91') addFinding(it, lastIndex >= 0 ? (lines[lastIndex] as SentLine).sourceLine : 0, null, 'warn', 'g91-at-end', 'the file ends in G91 (incremental): the next job or jog may move further than expected');
}

interface InterpretLinesInput {
  dialect: Dialect;
  job: DialectJobGcode;
  lines: readonly SentLine[];
  options: InterpretOptions;
  result: SanitizeResult
}

interface FileFindingsInput {
  lines: readonly SentLine[];
  it: InterpreterContext;
  lastIndex: number
}
