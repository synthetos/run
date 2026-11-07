/**
 * The Phase 1 write gate (ROADMAP P1-02; SAFETY §3 ^X and ^D rules, T-S24a,
 * T-S24b, T-S26, T-S38; PN §2.3).
 *
 * The reducer can only express GETs, `!` and ENQ, but this gate does not
 * trust that: it looks at the exact bytes the session is about to hand to
 * the transport and refuses anything that is not one of
 *
 * - `{"<token>":null}` + LF, where `<token>` is readable now (the probe's
 *   tokens before classification, the classified dialect's read allowlist
 *   after it);
 * - the splice guard `{sr:null}` + LF exactly (a bare key, PN §2.3 step 0);
 * - the single feedhold byte `!`;
 * - the single ENQ byte, only while ENQ is allowed (classified `tinyg-en`
 *   after a revision 2 or 3 footer).
 *
 * So 0x18 (^X), 0x04 (^D), `%`, `~`, G-code, settings writes and any
 * non-allowlisted GET never leave the session in this phase, whatever a bug
 * upstream asks for. A refusal is reported as a FAULT (the code path that
 * built the bytes is the bug, SAFETY §3).
 */
import { BYTE, SPLICE_GUARD_LINE } from '@synthetos/protocol';
import { allowed, type Intent, type Release } from '@synthetos/safety';
import { LINE_INTENTS, motionLineKind, type MotionLineKind } from './motionLines.ts';
import { JV_LINE, reportLineShape } from './reports.ts';
import { enqAllowedNow, matrixSnapshot, readableNow } from './reducer.ts';
import { SETTING_LINE, settingRefusal } from './settingWrite.ts';
import { probeKillWritable, probeLineWritable } from './probe/sync.ts';
import { probeLineAllowed } from './probe/common.ts';
import type { SessionState } from './types.ts';

export interface WriteContext {
  /** True when a GET of this token may be written now. */
  readonly readable: (token: string) => boolean;
  /** True when ENQ may be written now. */
  readonly enqAllowed: boolean;
  /**
   * Phase 2 (SAFETY §4.5b, T-S94): the session's release allows motion. Only then are the motion command
   * kind (a line of the closed grammar in motionLines.ts) and the realtime `%` and `~` admitted.
   */
  readonly motion?: boolean;
  /**
   * Settings writes (amendment 2026-11-02): true when exactly this `{"<token>":<value>}` is the settings
   * write the session is making now. Absent: no settings line is ever accepted.
   */
  readonly settingWritable?: (token: string, value: number) => boolean;
  /**
   * Report configuration (amendment 2026-11-02, H64): true when exactly this line is the configuration step the
   * session is making now. Absent: no configuration line is ever accepted.
   */
  readonly reportWritable?: (line: string) => boolean;
  /**
   * Phase 3 jobs (SAFETY §4.4a): true when this text is exactly the job line the session is writing now (the
   * sanitised `SentLine.text` at the index the reducer emitted). Absent: no job line is ever accepted.
   */
  readonly jobLine?: (text: string) => boolean;
  /** Phase 3 (H77): true when this line is exactly the line-mode step in progress. Absent: never accepted. */
  readonly lineModeWritable?: (line: string) => boolean;
  /** Phase 3: true when this is exactly a job `rt` line the session is sending now. Absent: never accepted. */
  readonly jobRuntimeWritable?: (line: string) => boolean;
  /**
   * The firmware update (SAFETY §4.8 as amended 2026-11-03): true when the session's bootloader entry passed its
   * idle gate and is writing `{"boot":1}` now. Absent: the line is never accepted (`boot` is forbidden outside the
   * flasher, H10).
   */
  readonly bootWritable?: () => boolean;
  /**
   * Probe Z (SAFETY §4.5c): true when this probe or probe-zero line is exactly the probe's own line in the step that
   * sends it. Absent: neither shape is ever accepted.
   */
  readonly probeLine?: (line: string) => boolean;
  /** Probe Z: ^D may be written now (Stop job or Spindle off during a probe). Absent or false: never. */
  readonly kill?: boolean;
}

/** `motion`, `flush`, `resume`: Phase 2. `setting`: one single-token settings write, its own command kind (SAFETY §4.6, amendment 2026-11-02). */
/** `report`: one line of the session's status-report configuration (amendment 2026-11-02). */
export type WriteVerdict =
  | { readonly ok: true; readonly kind: 'get' | 'feedhold' | 'enq' | 'flush' | 'resume' | 'kill' | 'motion' | 'setting' | 'report' | 'job' | 'lineMode' | 'jobRuntime' | 'boot'; readonly token?: string; readonly lineKind?: MotionLineKind }
  | { readonly ok: false; readonly reason: string };

const MAX_MOTION_LINE_BYTES = 64;

/**
 * A GET line: one key of lowercase letters, digits and `_` (TinyG tokens
 * such as `1ma` and `_cs1`), value null, LF. Nothing else, not even a
 * space. The allowlist, not this shape, decides which keys may be read.
 */
const GET_LINE = /^\{"([a-z0-9_]{1,8})":null\}\n$/;

const MAX_GET_LINE_BYTES = 32;

/** Longest settings write line: `{"` + 8-byte key + `":` + a 21-byte number + `}` + LF. */
const MAX_SETTING_LINE_BYTES = 40;

/** Longest report-configuration line (the status report list), LF included: under the 254-byte JSON line. */
const MAX_REPORT_LINE_BYTES = 255;

/** Longest job line, LF included: the sanitiser keeps every line within the dialect's limit (SAFETY §4.7 step 9). */
const MAX_JOB_LINE_BYTES = 256;

/** The line-mode lines (H77) and the job `rt` lines (the job flag, the feed-limit window): exact shapes only. */
const LINE_MODE_SHAPE = /^\{"rxm":[01]\}$/;
const JOB_RUNTIME_SHAPE = /^\{"rt":\{"(?:job|fi)":\d{1,2}\}\}$/;

/** Decide one write. Pure; never throws. */
export function phase1WriteVerdict(bytes: Uint8Array, context: WriteContext): WriteVerdict {
  if (bytes.length === 1) {
    const b = bytes[0];
    if (b === BYTE.FEEDHOLD) return { ok: true, kind: 'feedhold' };
    if (b === BYTE.ENQ) return context.enqAllowed ? { ok: true, kind: 'enq' } : { ok: false, reason: 'ENQ is not allowed now (classified edge-next after a rev-2/3 footer only)' };
    if (context.motion === true && b === BYTE.FLUSH) return { ok: true, kind: 'flush' };
    if (context.motion === true && b === BYTE.RESUME) return { ok: true, kind: 'resume' };
    if (context.motion === true && context.kill === true && b === BYTE.KILL) return { ok: true, kind: 'kill' };
    return { ok: false, reason: `realtime byte 0x${(b as number).toString(16).padStart(2, '0')} is never written in this release` };
  }
  const longest = Math.max(MAX_SETTING_LINE_BYTES, context.motion === true ? MAX_MOTION_LINE_BYTES : MAX_GET_LINE_BYTES, context.reportWritable === undefined ? 0 : MAX_REPORT_LINE_BYTES, context.jobLine === undefined ? 0 : MAX_JOB_LINE_BYTES);
  if (bytes.length === 0 || bytes.length > longest) return { ok: false, reason: `a ${bytes.length}-byte write is not a GET, settings, report, motion or job line` };
  let text = '';
  for (const b of bytes) {
    if (b > 0x7e || (b < 0x20 && b !== 0x0a)) return { ok: false, reason: 'a GET line is printable ASCII ending in LF' };
    text += String.fromCharCode(b);
  }
  // The firmware update: exactly `{"boot":1}`, and only while the session's bootloader entry is writing it.
  if (text === '{"boot":1}\n') {
    if (context.bootWritable === undefined || !context.bootWritable()) return { ok: false, reason: '{"boot":1} is written only by the firmware update, after its idle gate' };
    return { ok: true, kind: 'boot' };
  }
  // Phase 3: a job line is exactly the sanitised line being written now, and only when the intent is jobLine.
  if (context.jobLine !== undefined && text.endsWith('\n') && context.jobLine(text.slice(0, -1))) return { ok: true, kind: 'job' };
  // The line-mode kind (H77): `{"rxm":0}` or `{"rxm":1}`, exactly the step in progress.
  if (text.endsWith('\n') && LINE_MODE_SHAPE.test(text.slice(0, -1))) {
    if (context.lineModeWritable === undefined) return { ok: false, reason: 'the line-mode setting is not written in this release' };
    if (!context.lineModeWritable(text.slice(0, -1))) return { ok: false, reason: `${JSON.stringify(text.slice(0, -1))} is not the line-mode step the session is making now` };
    return { ok: true, kind: 'lineMode' };
  }
  // The job `rt` kind: the job flag and the feed-limit window, exactly the line the session is sending now.
  if (text.endsWith('\n') && JOB_RUNTIME_SHAPE.test(text.slice(0, -1))) {
    if (context.jobRuntimeWritable === undefined || !context.jobRuntimeWritable(text.slice(0, -1))) return { ok: false, reason: `${JSON.stringify(text.slice(0, -1))} is not a job rt line the session is sending now` };
    return { ok: true, kind: 'jobRuntime' };
  }
  // The report-configuration kind: one of its exact shapes, and exactly the step in progress.
  if (text.endsWith('\n') && reportLineShape(text.slice(0, -1))) {
    if (context.reportWritable === undefined) return { ok: false, reason: 'report configuration is not allowed in this release' };
    if (!context.reportWritable(text.slice(0, -1))) return { ok: false, reason: `${JSON.stringify(text.slice(0, 32))} is not the report configuration step the session is making now` };
    return { ok: true, kind: 'report' };
  }
  const setting = SETTING_LINE.exec(text);
  if (setting !== null) {
    const token = setting[1] as string;
    const value = Number(setting[2]);
    if (context.settingWritable === undefined) return { ok: false, reason: 'settings writes are not allowed in this release' };
    if (!context.settingWritable(token, value)) return { ok: false, reason: `"${token}" = ${setting[2]} is not the settings write the session is making now` };
    return { ok: true, kind: 'setting', token };
  }
  // The GET kind, within its own cap. (The motion kind has its own, larger cap below: a three-axis jog piece is
  // longer than a GET; independent review 2026-11-03, R8.)
  let getToken: string | undefined;
  if (bytes.length <= MAX_GET_LINE_BYTES) {
    if (text === `${SPLICE_GUARD_LINE}\n`) {
      return context.readable('sr') ? { ok: true, kind: 'get', token: 'sr' } : { ok: false, reason: '"sr" is not readable now (not on the probe list or the dialect\'s read allowlist)' };
    }
    const match = GET_LINE.exec(text);
    if (match !== null) {
      getToken = match[1] as string;
      if (context.readable(getToken)) return { ok: true, kind: 'get', token: getToken };
    }
  }
  // The motion command kind: exactly one line of the closed grammar, within the motion cap, and only with a motion
  // release (`{"clear":null}` has a GET's shape but is the motion grammar's own line).
  const lineKind = context.motion === true && bytes.length <= MAX_MOTION_LINE_BYTES && text.endsWith('\n') ? motionLineKind(text.slice(0, -1)) : undefined;
  if ((lineKind === 'probe' || lineKind === 'probeZero') && (context.probeLine === undefined || !context.probeLine(text.slice(0, -1)))) {
    return { ok: false, reason: `${JSON.stringify(text.slice(0, -1))} is not the probe's own line in the step that sends it` };
  }
  if (lineKind !== undefined) return { ok: true, kind: 'motion', lineKind };
  if (getToken !== undefined) return { ok: false, reason: `"${getToken}" is not readable now (not on the probe list or the dialect's read allowlist)` };
  if (bytes.length > MAX_GET_LINE_BYTES) return { ok: false, reason: `a ${bytes.length}-byte write is not a GET line${context.motion === true ? ' or a motion line' : ''}` };
  return { ok: false, reason: `not a single-token GET: ${JSON.stringify(text.slice(0, 32))}` };
}

/**
 * What a write is for. `read`, `feedhold` and `enq` are checked against the matrix intent of that name;
 * `motion` (a motion line), `flush` (`%`) and `resume` (`~`) against the intent that issued them;
 * `settingsWrite` (a settings line) against `settingsWrite`.
 */
export type WriteIntent = 'read' | 'feedhold' | 'enq' | 'motion' | 'flush' | 'resume' | 'kill' | 'settingsWrite' | 'configureReports' | 'jobLine' | 'lineMode' | 'jobRuntime' | 'flash';

const VERDICT_FOR: Readonly<Record<WriteIntent, 'get' | 'feedhold' | 'enq' | 'motion' | 'flush' | 'resume' | 'kill' | 'setting' | 'report' | 'job' | 'lineMode' | 'jobRuntime' | 'boot'>> = {
  read: 'get',
  feedhold: 'feedhold',
  enq: 'enq',
  motion: 'motion',
  flush: 'flush',
  resume: 'resume',
  kill: 'kill',
  settingsWrite: 'setting',
  configureReports: 'report',
  jobLine: 'job',
  lineMode: 'lineMode',
  jobRuntime: 'jobRuntime',
  flash: 'boot',
};

/** True when `text` is exactly job line `index` of the job `state` is running, and that line has been emitted. */
export function jobLineWritableIn(state: SessionState, index: number | undefined, text: string): boolean {
  const job = state.job;
  if (job === null || index === undefined || !Number.isInteger(index) || index < 0 || index >= job.next) return false;
  return job.lines[index]?.text === text;
}

/** True when `line` is exactly the line-mode write `state` is making. */
export function lineModeWritableIn(state: SessionState, line: string): boolean {
  const step = state.rxm.step;
  return step !== null && step.kind === 'write' && line === `{"rxm":${step.value}}`;
}

/** True when `line` is a job `rt` line `state` has queued or is writing (the job flag only where it is supported). */
export function jobRuntimeWritableIn(state: SessionState, line: string): boolean {
  if (state.job === null) return false;
  const pending = [...state.queue, ...(state.writing === null ? [] : [state.writing])];
  if (!pending.some((q) => q.purpose === 'jobRuntime' && q.line === line)) return false;
  if (line.includes('"job"')) return state.rtLeaves.includes('job');
  return state.rtLeaves.includes('fi');
}

/** True when `line` is exactly the report-configuration step `state` is making. */
export function reportWritableIn(state: SessionState, line: string): boolean {
  if (line === JV_LINE) return state.probe?.normalizing === true;
  return state.reports.phase === 'configuring' && state.reports.step?.line === line;
}

/** True when `token` = `value` is exactly the settings write `state` is making (phase writing, same key and value, still allowed by the schema). */
export function settingWritableIn(state: SessionState, token: string, value: number): boolean {
  const w = state.settingWrite;
  const dialect = state.dialect;
  if (w === null || w.phase !== 'writing' || w.key !== token || w.value !== value || dialect === null) return false;
  return settingRefusal(dialect.id, token, value, state.values) === null;
}

/**
 * The last check before the transport, in two parts:
 * - `denied`: the allow-matrix no longer allows `intent` in `current` (the
 *   state changed since the reducer asked). The write is not made; nothing
 *   is wrong.
 * - `refused`: the bytes themselves break the Phase 1 rules, or are not the
 *   kind of write the intent names. Only a bug can cause that: a FAULT.
 * The token rule is the one in force in `emitted`, the state in which the
 * reducer asked for the write (the probe list, or the classified dialect's
 * allowlist); ENQ is judged on `current`.
 */
export function checkWrite(
  current: SessionState,
  emitted: SessionState,
  release: Release,
  bytes: Uint8Array,
  intent: WriteIntent,
  issuedBy?: Intent,
  index?: number,
): { readonly kind: 'denied' | 'refused'; readonly reason: string } | undefined {
  const own = intent === 'read' || intent === 'feedhold' || intent === 'enq' || intent === 'settingsWrite' || intent === 'configureReports' || intent === 'jobLine' || intent === 'lineMode' || intent === 'jobRuntime' || intent === 'flash';
  const matrixIntent: Intent | undefined = own ? intent : issuedBy;
  if (matrixIntent === undefined) return { kind: 'refused', reason: `a ${intent} write names no issuing intent` };
  // Probe Z: after Pause or Stop job, or once its run has ended, no probe line goes out (held back, never a FAULT).
  if (matrixIntent === 'probeZ' && intent === 'motion' && !probeLineAllowed(current)) return { kind: 'denied', reason: 'not written: the probe was stopped or has ended' };
  const decision = allowed(matrixSnapshot(current), matrixIntent, release);
  if (!decision.allowed) return { kind: 'denied', reason: `not written: the allow-matrix denies ${matrixIntent} now (${decision.reason})` };
  const verdict = phase1WriteVerdict(bytes, {
    readable: (token) => readableNow(emitted, token),
    enqAllowed: enqAllowedNow(current),
    motion: release.motion,
    ...(release.settings === true ? { settingWritable: (token: string, value: number) => settingWritableIn(current, token, value) } : {}),
    ...(release.reports === true ? { reportWritable: (line: string) => reportWritableIn(current, line) } : {}),
    ...(release.jobs === true && intent === 'jobLine' ? { jobLine: (text: string) => jobLineWritableIn(current, index, text) } : {}),
    ...(release.jobs === true ? { lineModeWritable: (line: string) => lineModeWritableIn(current, line), jobRuntimeWritable: (line: string) => jobRuntimeWritableIn(emitted, line) } : {}),
    ...(release.flash === true ? { bootWritable: () => current.bootEntry?.phase === 'writing' } : {}),
    ...(release.motion ? { probeLine: (line: string) => probeLineWritable(current, line), kill: probeKillWritable(current) } : {}),
  });
  if (!verdict.ok) return { kind: 'refused', reason: verdict.reason };
  if (verdict.kind !== VERDICT_FOR[intent]) return { kind: 'refused', reason: `a ${verdict.kind} write was issued as ${intent}` };
  // A motion line only from an intent that may send its kind (amendment 2026-11-02, T-S94).
  if (verdict.lineKind !== undefined && !LINE_INTENTS[verdict.lineKind].includes(matrixIntent)) return { kind: 'refused', reason: `a ${verdict.lineKind} line was issued by ${matrixIntent}` };
  return undefined;
}
