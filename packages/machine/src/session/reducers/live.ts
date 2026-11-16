import {
  mapStat,
  type JsonObject,
  type JsonValue,
  type StatusReport
} from '@synthetos/protocol';
import {
  type LiveState
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function mergeLive(t: Tx, fields: JsonObject, deps: ReducerDeps): void {
  const { withNumber } = deps;
  let live = t.s.live;
  for (const [key, v] of Object.entries(fields)) {
    if (typeof v === 'number' && Number.isFinite(v)) live = withNumber(t, live, key, v);
  }
  t.set({ live });
}

export function withNumber(t: Tx, message: { live: LiveState; key: string; v: number; }, deps: ReducerDeps): LiveState {
  const { live, key, v } = message;
  const { dialectOf, AXES } = deps;
  if (key === 'stat') {
    const dialect = dialectOf(t.s);
    return { ...live, stat: v, ...(dialect === null ? {} : { machineClass: mapStat(dialect, v) }) };
  }
  // These are the unchanged scalar cases; spindle/coolant values remain display-only.
  if (['hold', 'vel', 'qr', 'ex', 'line', 'unit', 'feed', 'tool', 'spe', 'spc', 'spd', 'sps', 'cof', 'com', 'home', 'coor', 'dist'].includes(key)) return { ...live, [key]: v };
  for (const axis of AXES) {
    if (key === `pos${axis}`) return { ...live, pos: { ...live.pos, [axis]: v } };
    if (key === `mpo${axis}`) return { ...live, mpo: { ...live.mpo, [axis]: v } };
  }
  return live;
}

export function onStatusReport(t: Tx, message: { report: StatusReport; at: number; }, deps: ReducerDeps): void {
  const { report, at } = message;
  const { mergeLive, features, MOTION_CLASSES } = deps;
  mergeLive(t, report.sr);
  // Homing (amendment 2026-11-02): a pushed report says when the cycle may have ended; polled reads confirm it.
  features.onMotionReport?.(t, report.sr, at);
  if (t.s.base !== 'IDENTIFYING' && t.s.base !== 'READING') return;
  const live = t.s.live;
  const moving = (typeof report.sr['vel'] === 'number' && report.sr['vel'] !== 0) || (live.machineClass !== undefined && MOTION_CLASSES.has(live.machineClass) && 'stat' in report.sr);
  if (moving) {
    // PN §2.3 step 0: unsolicited reports showing motion while connecting.
    t.addOverlay('ORPHANED_MOTION');
    if (t.s.classification === null) t.set({ queue: [] });
  }
}

/** Merges one state read into the live values (scalars, and the `mpo`/`pos` groups). */
export function mergeStateValue(t: Tx, message: { token: string; value: JsonValue | undefined; }, deps: ReducerDeps): void {
  const { token, value } = message;
  const { withNumber, isObject, mergeLive } = deps;
  if (typeof value === 'number' && Number.isFinite(value)) {
    t.set({ live: withNumber(t, t.s.live, token, value) });
    return;
  }
  if ((token === 'mpo' || token === 'pos') && isObject(value)) {
    const fields: Record<string, JsonValue> = {};
    for (const [axis, v] of Object.entries(value)) fields[`${token}${axis}`] = v;
    mergeLive(t, fields);
  }
}

export function bindLive(deps: ReducerDeps): Pick<ReducerDeps, 'mergeLive' | 'withNumber' | 'onStatusReport' | 'mergeStateValue'> {
  return {
    mergeLive: (t, fields) => mergeLive(t, fields, deps),
    withNumber: (t, live, key, v) => withNumber(t, { live: live, key: key, v: v }, deps),
    onStatusReport: (t, report, at) => onStatusReport(t, { report: report, at: at }, deps),
    mergeStateValue: (t, token, value) => mergeStateValue(t, { token: token, value: value }, deps),
  };
}
