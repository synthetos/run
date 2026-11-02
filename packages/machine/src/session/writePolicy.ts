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
import { motionLineKind } from './motionLines.ts';
import { enqAllowedNow, matrixSnapshot, readableNow } from './reducer.ts';
import { SETTING_LINE, settingRefusal } from './settingWrite.ts';
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
}

/** `motion`, `flush`, `resume`: Phase 2. `setting`: one single-token settings write, its own command kind (SAFETY §4.6, amendment 2026-11-02). */
export type WriteVerdict = { readonly ok: true; readonly kind: 'get' | 'feedhold' | 'enq' | 'flush' | 'resume' | 'motion' | 'setting'; readonly token?: string } | { readonly ok: false; readonly reason: string };

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

/** Decide one write. Pure; never throws. */
export function phase1WriteVerdict(bytes: Uint8Array, context: WriteContext): WriteVerdict {
  if (bytes.length === 1) {
    const b = bytes[0];
    if (b === BYTE.FEEDHOLD) return { ok: true, kind: 'feedhold' };
    if (b === BYTE.ENQ) return context.enqAllowed ? { ok: true, kind: 'enq' } : { ok: false, reason: 'ENQ is not allowed now (classified edge-next after a rev-2/3 footer only)' };
    if (context.motion === true && b === BYTE.FLUSH) return { ok: true, kind: 'flush' };
    if (context.motion === true && b === BYTE.RESUME) return { ok: true, kind: 'resume' };
    return { ok: false, reason: `realtime byte 0x${(b as number).toString(16).padStart(2, '0')} is never written in this release` };
  }
  if (bytes.length === 0 || bytes.length > Math.max(MAX_SETTING_LINE_BYTES, context.motion === true ? MAX_MOTION_LINE_BYTES : MAX_GET_LINE_BYTES)) return { ok: false, reason: `a ${bytes.length}-byte write is not a GET, settings or motion line` };
  let text = '';
  for (const b of bytes) {
    if (b > 0x7e || (b < 0x20 && b !== 0x0a)) return { ok: false, reason: 'a GET line is printable ASCII ending in LF' };
    text += String.fromCharCode(b);
  }
  const setting = SETTING_LINE.exec(text);
  if (setting !== null) {
    const token = setting[1] as string;
    const value = Number(setting[2]);
    if (context.settingWritable === undefined) return { ok: false, reason: 'settings writes are not allowed in this release' };
    if (!context.settingWritable(token, value)) return { ok: false, reason: `"${token}" = ${setting[2]} is not the settings write the session is making now` };
    return { ok: true, kind: 'setting', token };
  }
  if (bytes.length > MAX_GET_LINE_BYTES) return { ok: false, reason: `a ${bytes.length}-byte write is not a GET line` };
  if (text === `${SPLICE_GUARD_LINE}\n`) {
    return context.readable('sr') ? { ok: true, kind: 'get', token: 'sr' } : { ok: false, reason: '"sr" is not readable now (not on the probe list or the dialect\'s read allowlist)' };
  }
  const match = GET_LINE.exec(text);
  if (match !== null && context.readable(match[1] as string)) return { ok: true, kind: 'get', token: match[1] as string };
  // The motion command kind: exactly one line of the closed grammar, and only with a motion release.
  if (context.motion === true && text.endsWith('\n') && motionLineKind(text.slice(0, -1)) !== undefined) return { ok: true, kind: 'motion' };
  if (match === null) return { ok: false, reason: `not a single-token GET: ${JSON.stringify(text.slice(0, 32))}` };
  return { ok: false, reason: `"${match[1] as string}" is not readable now (not on the probe list or the dialect's read allowlist)` };
}

/**
 * What a write is for. `read`, `feedhold` and `enq` are checked against the matrix intent of that name;
 * `motion` (a motion line), `flush` (`%`) and `resume` (`~`) against the intent that issued them;
 * `settingsWrite` (a settings line) against `settingsWrite`.
 */
export type WriteIntent = 'read' | 'feedhold' | 'enq' | 'motion' | 'flush' | 'resume' | 'settingsWrite';

const VERDICT_FOR: Readonly<Record<WriteIntent, 'get' | 'feedhold' | 'enq' | 'motion' | 'flush' | 'resume' | 'setting'>> = { read: 'get', feedhold: 'feedhold', enq: 'enq', motion: 'motion', flush: 'flush', resume: 'resume', settingsWrite: 'setting' };

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
): { readonly kind: 'denied' | 'refused'; readonly reason: string } | undefined {
  const matrixIntent: Intent | undefined = intent === 'read' || intent === 'feedhold' || intent === 'enq' || intent === 'settingsWrite' ? intent : issuedBy;
  if (matrixIntent === undefined) return { kind: 'refused', reason: `a ${intent} write names no issuing intent` };
  const decision = allowed(matrixSnapshot(current), matrixIntent, release);
  if (!decision.allowed) return { kind: 'denied', reason: `not written: the allow-matrix denies ${matrixIntent} now (${decision.reason})` };
  const verdict = phase1WriteVerdict(bytes, {
    readable: (token) => readableNow(emitted, token),
    enqAllowed: enqAllowedNow(current),
    motion: release.motion,
    ...(release.settings === true ? { settingWritable: (token: string, value: number) => settingWritableIn(current, token, value) } : {}),
  });
  if (!verdict.ok) return { kind: 'refused', reason: verdict.reason };
  if (verdict.kind !== VERDICT_FOR[intent]) return { kind: 'refused', reason: `a ${verdict.kind} write was issued as ${intent}` };
  return undefined;
}
