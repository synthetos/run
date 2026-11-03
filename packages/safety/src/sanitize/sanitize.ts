/**
 * `sanitizeJob`: the job sanitiser (ROADMAP P0-10, SAFETY §4.7, T-S1, T-S2,
 * T-S64, T-S76).
 *
 * Steps, in the order SAFETY §4.7 gives them:
 *  1. line endings → LF; no CR and no blank line is ever sent;
 *  2. comments: the TinyG reject rule (text after a comment, a leading
 *     comment before code, an unclosed `(`), trailing comments stripped;
 *  3. trim;  4. drop empty and `%`-only lines;  5. strip user N words;
 *  6. reject (block the job) on the universal and per-dialect rules;
 *  6a. split long moves so no line exceeds the queued-motion ceiling;
 *  7. mark barriers (M0, M60, the C14 M0, M1 with optional stop on);
 *     M1 with optional stop off is dropped (TG) or sent (EN), as data says;
 *  8. hold back the final M2/M30; a mid-file one blocks (EN) or warns (TG);
 *  8a. end state: outputs still on at the end block the job unless C22,
 *     which adds `M5` and `M9` (before a final M2/M30 where program end is
 *     not known to stop them);
 *  9. prefix `N<k>`, and reject any line then longer than the dialect limit.
 *
 * Pure and deterministic: the same input, dialect and options always give
 * the same result, and sanitising the output again changes nothing.
 */
import type { Dialect } from '@synthetos/protocol';
import { JobModel, type Finding } from './analyze.ts';
import type { Segment } from './geometry.ts';
import { canonicalCode, lexLine, removeWords, type Word } from './lex.ts';
import { applyCommentRule, findControlByte, isTapeMarker, splitLines, trimLine } from './text.ts';
import type {
  LineMotion,
  LineOrigin,
  ReportEntry,
  SanitizeOptions,
  SanitizeResult,
  SentLine,
  SplitRecord,
  ToolChange,
} from './types.ts';

/** SAFETY §4.3: the queued-motion ceiling's default and range, and the default `k`. */
export const CEILING_SECONDS = Object.freeze({ default: 5, min: 2, max: 20 });
export const DEFAULT_K = 0.5;

const FIRST_CHARACTER_REJECTS = new Set(['$', '?', 'H', 'h', '{']);

/** A line on its way out, before numbering. */
interface Candidate {
  readonly sourceLine: number;
  readonly origin: LineOrigin;
  readonly body: string;
  readonly barrier: boolean;
  readonly programEnd: boolean;
  /** The line itself commands the spindle or coolant on. */
  readonly outputsOn: boolean;
  readonly motion: LineMotion | null;
  /** Lines split from one source line share a group, so a failure removes all of them. */
  readonly group: number;
  /** The line commands the spindle on (M3 or M4): a tool change after which the file restarts it (H74). */
  readonly startsSpindle?: boolean;
  /** Phase 3: a manual tool-change stop (H74); `restartsSpindle` is filled in after the last line. */
  readonly toolChange?: Omit<ToolChange, 'restartsSpindle'>;
}

function checkOptions(options: SanitizeOptions): void {
  const { ceilingSeconds, k, maxVelocity, feedrateMax, rotary, linear } = options.motion;
  if (!(ceilingSeconds >= CEILING_SECONDS.min && ceilingSeconds <= CEILING_SECONDS.max)) {
    throw new RangeError(`ceilingSeconds must be from ${CEILING_SECONDS.min} to ${CEILING_SECONDS.max} (SAFETY §4.3)`);
  }
  if (!(k > 0 && k <= 1)) throw new RangeError('k must be in (0, 1] (SAFETY §4.3)');
  for (const [name, table] of [['maxVelocity', maxVelocity], ['feedrateMax', feedrateMax]] as const) {
    if (typeof table !== 'object' || table === null) throw new RangeError(`${name} must be given (SAFETY §4.3)`);
    for (const [axis, v] of Object.entries(table)) {
      if (!(typeof v === 'number' && v > 0 && Number.isFinite(v))) throw new RangeError(`${name}.${axis} must be a positive number`);
    }
  }
  if (typeof rotary !== 'object' || rotary === null) throw new RangeError('rotary axis modes must be given (an empty object when none are known)');
  for (const [axis, cfg] of Object.entries(rotary)) {
    if (!['A', 'B', 'C'].includes(axis)) throw new RangeError(`rotary.${axis} is not a rotary axis`);
    if (!(typeof cfg === 'object' && cfg !== null && [0, 1, 2, 3].includes(cfg.mode))) throw new RangeError(`rotary.${axis}.mode must be 0, 1, 2 or 3`);
    const r = cfg.radiusMm;
    if (r !== undefined && !(typeof r === 'number' && r > 0 && Number.isFinite(r))) throw new RangeError(`rotary.${axis}.radiusMm must be a positive number`);
  }
  if (typeof linear !== 'object' || linear === null) throw new RangeError('linear axis modes must be given (an empty object when none are known)');
  for (const [axis, mode] of Object.entries(linear)) {
    if (!['X', 'Y', 'Z'].includes(axis)) throw new RangeError(`linear.${axis} is not a linear axis`);
    if (![0, 1, 2, 3].includes(mode as number)) throw new RangeError(`linear.${axis} must be 0, 1, 2 or 3`);
  }
}

/**
 * Sanitises a job for a dialect. `lines` is the file as one string, or its
 * lines. A result with `report.blocked` must never be armed or streamed;
 * its `lines` are still returned so the preview can show what was kept.
 */
export function sanitizeJob(lines: string | Iterable<string>, dialect: Dialect, options: SanitizeOptions): SanitizeResult {
  checkOptions(options);
  const entries: ReportEntry[] = [];
  const add = (line: number, f: Finding): void => {
    entries.push({ line, severity: f.severity, rule: f.rule, message: f.message });
  };
  const job = dialect.gcode.job;
  if (job === null) {
    add(0, { severity: 'block', rule: 'read-only-dialect', message: `${dialect.label} is read-only in this version: no job is ever sent to it` });
    return {
      lines: [],
      report: { dialect: dialect.id, blocked: true, entries, splits: [], longestMoveSeconds: 0, endState: { spindle: 'off', mist: false, flood: false } },
    };
  }

  const commentRule = dialect.gcode.blocked.find((r) => r.kind === 'textAfterComment');
  const model = new JobModel(dialect, job, options);
  const candidates: Candidate[] = [];
  const splits: SplitRecord[] = [];
  let group = 0;

  splitLines(lines).forEach((raw, index) => {
    const lineNo = index + 1;
    const control = findControlByte(raw);
    if (control !== undefined) {
      add(lineNo, { severity: 'block', rule: 'control-byte', message: `the line contains control byte 0x${control.toString(16).padStart(2, '0')}` });
      return;
    }
    const comment = applyCommentRule(raw, commentRule !== undefined);
    if (comment.kind === 'unclosed') {
      add(lineNo, { severity: 'block', rule: 'unclosed-comment', message: 'an unclosed "(" comment: TinyG would drop the rest of the line' });
      return;
    }
    if (comment.kind === 'textAfterComment') {
      // Only reachable when the dialect has the rule.
      add(lineNo, { severity: 'block', rule: (commentRule as { id: string }).id, message: (commentRule as { reason: string }).reason });
      return;
    }
    if (comment.stripped) add(lineNo, { severity: 'change', rule: 'comment-stripped', message: 'comment removed' });
    const code = trimLine(comment.code);
    if (code === '') {
      add(lineNo, { severity: 'change', rule: 'dropped-empty', message: 'empty line not sent' });
      return;
    }
    if (isTapeMarker(code)) {
      add(lineNo, { severity: 'change', rule: 'dropped-tape-marker', message: '"%" tape marker not sent' });
      return;
    }
    const first = code.charAt(0);
    if (FIRST_CHARACTER_REJECTS.has(first)) {
      add(lineNo, { severity: 'block', rule: 'first-character', message: `a line starting with "${first}" is a controller command, not G-code` });
      return;
    }
    const realtime = /[!~%]/.exec(code);
    if (realtime !== null) {
      add(lineNo, { severity: 'block', rule: 'realtime-character', message: `"${realtime[0]}" is a realtime command byte and is never sent inside job data` });
      return;
    }
    if (/[^\x20-\x7e\t]/.test(code)) {
      add(lineNo, { severity: 'block', rule: 'non-ascii', message: 'the line contains a byte outside printable ASCII' });
      return;
    }
    const lexed = lexLine(code);
    if (lexed.kind === 'invalidCharacter') {
      add(lineNo, { severity: 'block', rule: 'invalid-character', message: `"${lexed.char}" is not valid in G-code here` });
      return;
    }
    if (lexed.kind === 'malformed') {
      add(lineNo, { severity: 'block', rule: 'malformed', message: `malformed line: ${lexed.detail}` });
      return;
    }
    const nWords = lexed.words.filter((w) => w.letter === 'N');
    const words = lexed.words.filter((w) => w.letter !== 'N');
    if (words.length === 0) {
      add(lineNo, { severity: 'change', rule: 'dropped-empty', message: 'a line with only a line number is not sent' });
      return;
    }
    if (nWords.length > 0) add(lineNo, { severity: 'change', rule: 'n-word-stripped', message: 'line number replaced by the host line number' });

    const before = { spindle: model.spindle, speed: model.speed, mist: model.mist, flood: model.flood };
    const analysis = model.analyze(words);
    for (const f of analysis.findings) add(lineNo, spacedCode(f, code, words, lineNo));
    if (!analysis.ok) return;

    const removals: Word[] = [...nWords];
    const m1 = analysis.optionalStop;
    const optionalStopOn = options.optionalStop === true;
    if (m1 !== null && !optionalStopOn && job.optionalStopOff === 'drop') {
      removals.push(m1);
      add(lineNo, { severity: 'change', rule: 'm1-dropped', message: 'M1 removed: optional stop is off' });
    }
    const barrier = analysis.programStop || (m1 !== null && optionalStopOn);

    if (analysis.toolChange && options.c14 === true) {
      insertC14(candidates, lineNo, ++group, add);
      // The M5 and M9 before the tool change turn the outputs off on the machine before this line runs, so the
      // model follows them, except for what this line itself switches (an M3/M4/M7/M8 on the M6 line turns on again
      // after the stop). Without this the end-state check still saw the file's own M3 on and added a second M5 M9
      // after the M0, and sanitising that output again inserted the C14 block once more (T-S1 counterexample
      // `M3 ()\nM6 M2`, 2026-11-03).
      const codes = words.filter((w) => w.letter === 'M').map(canonicalCode);
      if (!codes.some((c) => c === 'M3' || c === 'M4' || c === 'M5')) model.spindle = 'off';
      if (!codes.some((c) => c === 'M7' || c === 'M8' || c === 'M9')) {
        model.mist = false;
        model.flood = false;
      }
    }
    // Phase 3 (H74): without C14 an M6 that passed is a manual tool-change stop (edge-next only; others block it).
    const toolChange = analysis.toolChange && options.c14 !== true ? { tool: model.tool, ...before } : undefined;
    const startsSpindle = words.some((w) => w.letter === 'M' && (canonicalCode(w) === 'M3' || canonicalCode(w) === 'M4'));

    group++;
    if (analysis.motion?.kind === 'split') {
      const { bodies, segments, seconds } = analysis.motion;
      splits.push({ line: lineNo, segments: bodies.length, seconds });
      add(lineNo, { severity: 'change', rule: 'split', message: `long move split into ${bodies.length} segments (about ${seconds.toFixed(1)} s modelled)` });
      bodies.forEach((body, i) => {
        const last = i === bodies.length - 1;
        const seg = segments[i] as Segment;
        candidates.push({
          sourceLine: lineNo,
          origin: 'split',
          body: last && removals.includes(m1 as Word) ? removeCode(body, 'M1') : body,
          barrier: last && barrier,
          programEnd: last && analysis.programEnd,
          outputsOn: i === 0 && analysis.outputsOn,
          motion: { plannerLength: seg.plannerLength, boundMm: seg.boundMm, seconds: seg.seconds },
          group,
          ...(i === 0 && startsSpindle ? { startsSpindle } : {}),
          ...(i === 0 && toolChange !== undefined ? { toolChange } : {}),
        });
      });
      return;
    }
    const body = removeWords(code, removals);
    if (body === '') {
      add(lineNo, { severity: 'change', rule: 'dropped-empty', message: 'nothing left to send on this line' });
      return;
    }
    const motion =
      analysis.motion === null
        ? null
        : { plannerLength: analysis.motion.plannerLength, boundMm: analysis.motion.boundMm, seconds: analysis.motion.seconds };
    candidates.push({ sourceLine: lineNo, origin: 'file', body, barrier, programEnd: analysis.programEnd, outputsOn: analysis.outputsOn, motion, group, ...(startsSpindle ? { startsSpindle } : {}), ...(toolChange === undefined ? {} : { toolChange }) });
  });

  // Step 8: program end.
  const lastIndex = candidates.length - 1;
  candidates.forEach((c, i) => {
    if (c.programEnd && i !== lastIndex) {
      const severity = job.midFileProgramEnd === 'block' ? 'block' : 'warn';
      add(c.sourceLine, {
        severity,
        rule: 'mid-file-program-end',
        message:
          severity === 'block'
            ? 'M2/M30 before the end of the file: a buffered program end clears an alarm on this firmware (H35)'
            : 'M2/M30 before the end of the file: the lines after it still run',
      });
    }
  });
  const finalEnd = lastIndex >= 0 && (candidates[lastIndex] as Candidate).programEnd;

  // Step 8a: end state.
  if (model.outputsOn()) {
    const end = describeEnd(model);
    const finalTurnsOn = finalEnd && (candidates[lastIndex] as Candidate).outputsOn;
    if (options.c22 === true && finalTurnsOn) {
      // M5 M9 before the final line would be undone by that line, and after it the program end would no longer be last.
      add((candidates[lastIndex] as Candidate).sourceLine, {
        severity: 'block',
        rule: 'end-state',
        message: `the last line turns the spindle or coolant on together with the program end, so the file ends with ${end}; move the M3/M4/M7/M8 off that line`,
      });
    } else if (options.c22 === true) {
      const at = finalEnd ? lastIndex : candidates.length;
      const source = candidates[lastIndex]?.sourceLine ?? 0;
      group++;
      candidates.splice(at, 0, inserted(source, 'c22', 'M5', false, group), inserted(source, 'c22', 'M9', false, group));
      add(source, { severity: 'change', rule: 'c22-inserted', message: `M5 and M9 added (C22): the file ended with ${end}` });
      model.spindle = 'off';
      model.mist = false;
      model.flood = false;
    } else {
      add(candidates[lastIndex]?.sourceLine ?? 0, { severity: 'block', rule: 'end-state', message: `the file ends with ${end}; accept C22 to add M5 and M9` });
    }
  }

  // Step 9: number, then refuse any line over the limit (numbering can shift, so repeat until stable).
  const max = dialect.limits.maxLineBytes;
  for (;;) {
    const tooLong = candidates.findIndex((c, i) => `N${i + 1} ${c.body}`.length > max);
    if (tooLong < 0) break;
    const c = candidates[tooLong] as Candidate;
    if (c.origin === 'split') {
      add(c.sourceLine, { severity: 'block', rule: 'split-impossible', message: `a sub-segment of this move would be longer than ${max} bytes` });
    } else {
      add(c.sourceLine, { severity: 'block', rule: 'too-long', message: `longer than ${max} bytes with its line number: TinyG would reject or truncate it` });
    }
    for (let i = candidates.length - 1; i >= 0; i--) if ((candidates[i] as Candidate).group === c.group) candidates.splice(i, 1);
  }

  const holdbackIndex = finalEnd && (candidates[candidates.length - 1]?.programEnd ?? false) ? candidates.length - 1 : -1;
  const sent: SentLine[] = candidates.map((c, i) => ({
    n: i + 1,
    text: `N${i + 1} ${c.body}`,
    body: c.body,
    sourceLine: c.sourceLine,
    origin: c.origin,
    barrier: c.barrier,
    holdback: i === holdbackIndex,
    motion: c.motion,
    ...(c.toolChange === undefined ? {} : { toolChange: { ...c.toolChange, restartsSpindle: restartsSpindle(candidates, i) } }),
  }));
  const longestMoveSeconds = sent.reduce((m, l) => Math.max(m, l.motion?.seconds ?? 0), 0);
  return {
    lines: sent,
    report: {
      dialect: dialect.id,
      blocked: entries.some((e) => e.severity === 'block'),
      entries,
      splits,
      longestMoveSeconds,
      endState: { spindle: model.spindle, mist: model.mist, flood: model.flood },
    },
  };
}

/**
 * Presentation only (the finding's level and rule are unchanged): an unsupported G or M code that was
 * written with spaces inside its number (`G92 064`), which TinyG reads as one number (`G92064`) because
 * it ignores spaces. Says so in plain words; this is usually a line the post-processor broke.
 */
export function spacedCode(f: Finding, code: string, words: readonly Word[], lineNo: number): Finding {
  if (f.rule !== 'unsupported-code') return f;
  for (const w of words) {
    if (w.letter !== 'G' && w.letter !== 'M') continue;
    const written = code.slice(w.start, w.end);
    if (!/[0-9][ \t]+[0-9.]/.test(written)) continue;
    const joined = `${w.letter}${w.text}`;
    const canonical = canonicalCode(w);
    if (!f.message.startsWith(`${joined} `) && (canonical === undefined || !f.message.startsWith(`${canonical} `))) continue;
    const shown = written.replace(/[ \t]+/g, ' ').toUpperCase();
    return { ...f, message: `'${shown}' reads as ${canonical ?? joined} because TinyG ignores spaces, and that isn't a valid command. This looks like a broken line from the post-processor. Check the file around line ${String(lineNo)}.` };
  }
  return f;
}

/** H74: does the file turn the spindle on at or after the tool change at `index`, before its next move? */
function restartsSpindle(candidates: readonly Candidate[], index: number): boolean {
  for (let j = index; j < candidates.length; j++) {
    const c = candidates[j] as Candidate;
    if (c.startsSpindle === true) return true;
    if (c.motion !== null) return false;
  }
  return false;
}

function inserted(sourceLine: number, origin: LineOrigin, body: string, barrier: boolean, group: number): Candidate {
  return { sourceLine, origin, body, barrier, programEnd: false, outputsOn: false, motion: null, group };
}

/** C14: `M5`, `M9`, `M0` before a tool change, the M0 a barrier, unless the three lines before it are exactly that. */
function insertC14(candidates: Candidate[], lineNo: number, group: number, add: (line: number, f: Finding) => void): void {
  const tail = candidates.slice(-3).map((c) => c.body);
  if (tail.length === 3 && tail[0] === 'M5' && tail[1] === 'M9' && tail[2] === 'M0') return;
  candidates.push(inserted(lineNo, 'c14', 'M5', false, group), inserted(lineNo, 'c14', 'M9', false, group), inserted(lineNo, 'c14', 'M0', true, group));
  add(lineNo, { severity: 'change', rule: 'c14-inserted', message: 'M5, M9 and M0 added before the tool change (C14); the job waits at M0' });
}

function removeCode(body: string, code: string): string {
  return body
    .split(' ')
    .filter((part) => part !== code)
    .join(' ');
}

function describeEnd(model: JobModel): string {
  const on: string[] = [];
  if (model.spindle !== 'off') on.push(`the spindle on (${model.spindle === 'cw' ? 'M3' : 'M4'})`);
  if (model.mist) on.push('mist coolant on (M7)');
  if (model.flood) on.push('flood coolant on (M8)');
  return on.join(' and ');
}
