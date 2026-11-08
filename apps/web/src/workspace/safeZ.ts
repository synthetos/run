/**
 * Go to zero's safe Z (SAFETY H53, §4.5b; OD-23, owner 2026-11-08: "A: no lift unless homed").
 *
 * The session raises Z first in machine coordinates to the safe Z it is given, never lower than where Z already is.
 * `ztm − 1` (just under the top of Z travel) is a safe Z only when the machine position came from a homing cycle this
 * connection saw complete: after "Set machine zero here" (G28.3) the board also reports homed, but machine Z 0 is
 * wherever the tool was, so `ztm − 1` may lie above the real top of travel (a Z stall that loses the position). And a
 * position set before this connection cannot be told apart from one set by hand. In every case but a homing seen
 * here, Z stays where it is, and C25 says the top of Z travel is not known (`handSet`).
 *
 * Pure.
 */

export interface SafeZ {
  /** Machine Z the session raises to (it never lowers Z). */
  readonly safe: number;
  /** The position is set (homed) but not by a homing cycle seen in this connection: C25 adds its hand-set sentence. */
  readonly handSet: boolean;
}

export function goToZeroSafeZ(p: { readonly homed: boolean | null; readonly positionBy: 'homing' | 'hand' | undefined; readonly ztm: number | null; readonly zNow: number | null }): SafeZ {
  if (p.homed === true && p.positionBy === 'homing' && p.ztm !== null) return { safe: Math.round((p.ztm - 1) * 1000) / 1000, handSet: false };
  return { safe: p.zNow ?? 0, handSet: p.homed === true };
}
