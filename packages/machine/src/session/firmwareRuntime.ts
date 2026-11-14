/** The open updater's session has no workspace control extensions (SAFETY §4.8). */
import { allowed, type Release } from '@synthetos/safety';
import { BYTE, SPLICE_GUARD_LINE } from '@synthetos/protocol';
import { createSessionReducer } from './reducerCore.ts';
import { snapshotOf } from './snapshotCore.ts';
import { settingRefusal, SETTING_LINE } from './settingWrite.ts';
import { JV_LINE } from './reports.ts';
import type { SessionRuntime, WriteCheck } from './sessionRuntime.ts';
import type { SessionState } from './types.ts';

export const firmwareReducer = createSessionReducer({
  // The host admits this manual acknowledgement only inside this board's required restore.
  // It is the existing positionVerify acknowledgement, not a move; SETs still poll idle afterwards.
  onMotionIntent: (t, request) => {
    if (request.intent !== 'positionVerify') return { allowed: false, reason: 'This session only updates firmware.', remedy: 'Use the signed-in workspace for machine control.', citation: 'SAFETY §4.8' };
    t.set({ overlays: t.s.overlays.filter(o => o !== 'UNKNOWN') });
    return { allowed: true };
  },
});
const refused = (): WriteCheck => ({ kind: 'refused', reason: 'The firmware page cannot send this command.' });

/** Every ordinary write remains matrix-gated; only exact reads, boot, and an in-progress restore SET pass. */
export function firmwareWrite(current: SessionState, emitted: SessionState, release: Release, bytes: Uint8Array, intent: 'read' | 'enq' | 'settingsWrite' | 'flash' | 'configureReports'): WriteCheck {
  const decision = allowed(firmwareReducer.matrixSnapshot(current), intent, release);
  if (!decision.allowed) return { kind: 'denied', reason: decision.reason };
  if (intent === 'enq') return bytes.length === 1 && bytes[0] === BYTE.ENQ && firmwareReducer.enqAllowedNow(current) ? undefined : refused();
  if (bytes.length === 0 || bytes.length > 40 || bytes.some(b => b > 0x7e || (b < 0x20 && b !== 10))) return refused();
  const text = new TextDecoder().decode(bytes);
  if (intent === 'flash') return current.bootEntry?.phase === 'writing' && text === '{"boot":1}\n' ? undefined : refused();
  // Identity negotiation only; never the workspace's report configuration.
  if (intent === 'configureReports') return current.probe?.normalizing === true && text === `${JV_LINE}\n` ? undefined : refused();
  if (intent === 'read') {
    const token = text === `${SPLICE_GUARD_LINE}\n` ? 'sr' : /^\{"([a-z0-9_]{1,8})":null\}\n$/.exec(text)?.[1];
    return bytes.length <= 32 && token !== undefined && firmwareReducer.readableNow(emitted, token) ? undefined : refused();
  }
  const setting = SETTING_LINE.exec(text);
  const w = current.settingWrite;
  if (setting === null || w === null || w.phase !== 'writing' || current.dialect === null) return refused();
  const key = setting[1] as string;
  const value = Number(setting[2]);
  return key === w.key && value === w.value && settingRefusal(current.dialect.id, key, value, current.values) === null ? undefined : refused();
}

export const firmwareRuntime: SessionRuntime = {
  initialState: firmwareReducer.initialState,
  reduce: firmwareReducer.reduce,
  snapshotOf: state => snapshotOf(state, {
    job: () => null,
    probe: () => ({ step: 'closed', block: 'notConnected', input: null, touch: { sawClear: false, sawTouching: false, sawReleased: false, problem: null }, zjh: null, system: null, plan: null, outcome: null, plateOut: false }),
  }),
  checkLine: (current, emitted, release, item) => {
    if (item.motion !== undefined || item.job !== undefined || item.lineMode === true || item.jobRuntime === true) return refused();
    return firmwareWrite(current, emitted, release, item.bytes, item.boot === true ? 'flash' : item.setting === true ? 'settingsWrite' : item.report === true ? 'configureReports' : 'read');
  },
  checkRealtime: (current, release, bytes, name) => name === 'enq' ? firmwareWrite(current, current, release, bytes, 'enq') : refused(),
};
