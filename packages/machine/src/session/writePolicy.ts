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
 * - the single feedhold byte `!`;
 * - the single ENQ byte, only while ENQ is allowed (classified `tinyg-en`
 *   after a revision 2 or 3 footer).
 *
 * So 0x18 (^X), 0x04 (^D), `%`, `~`, G-code, settings writes and any
 * non-allowlisted GET never leave the session in this phase, whatever a bug
 * upstream asks for. A refusal is reported as a FAULT (the code path that
 * built the bytes is the bug, SAFETY §3).
 */
import { BYTE } from '@synthetos/protocol';
import { allowed, type Release } from '@synthetos/safety';
import { enqAllowedNow, matrixSnapshot, readableNow } from './reducer.ts';
import type { SessionState } from './types.ts';

export interface WriteContext {
  /** True when a GET of this token may be written now. */
  readonly readable: (token: string) => boolean;
  /** True when ENQ may be written now. */
  readonly enqAllowed: boolean;
}

export type WriteVerdict = { readonly ok: true; readonly kind: 'get' | 'feedhold' | 'enq'; readonly token?: string } | { readonly ok: false; readonly reason: string };

/**
 * A GET line: one key of lowercase letters, digits and `_` (TinyG tokens
 * such as `1ma` and `_cs1`), value null, LF. Nothing else, not even a
 * space. The allowlist, not this shape, decides which keys may be read.
 */
const GET_LINE = /^\{"([a-z0-9_]{1,8})":null\}\n$/;

const MAX_GET_LINE_BYTES = 32;

/** Decide one write. Pure; never throws. */
export function phase1WriteVerdict(bytes: Uint8Array, context: WriteContext): WriteVerdict {
  if (bytes.length === 1) {
    const b = bytes[0];
    if (b === BYTE.FEEDHOLD) return { ok: true, kind: 'feedhold' };
    if (b === BYTE.ENQ) return context.enqAllowed ? { ok: true, kind: 'enq' } : { ok: false, reason: 'ENQ is not allowed now (classified edge-next after a rev-2/3 footer only)' };
    return { ok: false, reason: `realtime byte 0x${(b as number).toString(16).padStart(2, '0')} is never written in this release` };
  }
  if (bytes.length === 0 || bytes.length > MAX_GET_LINE_BYTES) return { ok: false, reason: `a ${bytes.length}-byte write is not a GET line` };
  let text = '';
  for (const b of bytes) {
    if (b > 0x7e || (b < 0x20 && b !== 0x0a)) return { ok: false, reason: 'a GET line is printable ASCII ending in LF' };
    text += String.fromCharCode(b);
  }
  const match = GET_LINE.exec(text);
  if (match === null) return { ok: false, reason: `not a single-token GET: ${JSON.stringify(text.slice(0, 32))}` };
  const token = match[1] as string;
  if (!context.readable(token)) return { ok: false, reason: `"${token}" is not readable now (not on the probe list or the dialect's read allowlist)` };
  return { ok: true, kind: 'get', token };
}

/** What a write is for: the allow-matrix intent it is checked against. */
export type WriteIntent = 'read' | 'feedhold' | 'enq';

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
): { readonly kind: 'denied' | 'refused'; readonly reason: string } | undefined {
  const decision = allowed(matrixSnapshot(current), intent, release);
  if (!decision.allowed) return { kind: 'denied', reason: `not written: the allow-matrix denies ${intent} now (${decision.reason})` };
  const verdict = phase1WriteVerdict(bytes, { readable: (token) => readableNow(emitted, token), enqAllowed: enqAllowedNow(current) });
  if (!verdict.ok) return { kind: 'refused', reason: verdict.reason };
  if (verdict.kind !== (intent === 'read' ? 'get' : intent)) return { kind: 'refused', reason: `a ${verdict.kind} write was issued as ${intent}` };
  return undefined;
}
