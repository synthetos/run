import {
  type Dialect,
  type Response
} from '@synthetos/protocol';
import { allowed, type Decision } from '@synthetos/safety';
import { restingUsesHold } from '../resting.ts';
import { gateTokens, judgeGate, readBackMatches, readBackValue, settingRefusal } from '../settingWrite.ts';
import {
  type SettingWriteOutcome,
  type SettingWriteState
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function onSettingsWrite(t: Tx, message: { key: unknown; value: unknown; matrix: Decision; }, deps: ReducerDeps): void {
  const { key, value, matrix } = message;
  const { dialectOf, deny, settingWriteActive } = deps;
  const dialect = dialectOf(t.s);
  /* c8 ignore next 4 -- defence in depth: an unclassified or read-only board carries READ_ONLY, which the matrix denies first */
  if (dialect === null || t.s.classification?.mode !== 'full') {
    t.decide('settingsWrite', deny('Settings are written only to an approved, identified board.', 'Connect a board running approved firmware.', 'SAFETY §4.6; P1-03'));
    return;
  }
  /* c8 ignore next 4 -- defence in depth: a move in progress has a motion base, which the settings row already denies */
  if (t.s.motion !== null) {
    t.decide('settingsWrite', deny('A move is in progress. Settings are written only while the machine is idle.', 'Wait for the move to finish.', 'SAFETY §4.6; §4.5b'));
    return;
  }
  if (settingWriteActive(t.s)) {
    t.decide('settingsWrite', deny('One setting at a time: the last write has not finished.', 'Wait for its answer and read-back.', 'SAFETY §4.6 step 6; firmware maintainer 2026-11-02 (one token at a time)'));
    return;
  }
  if (typeof key !== 'string') {
    t.decide('settingsWrite', deny('Name one setting.', 'Name one setting.', 'SAFETY §4.6'));
    return;
  }
  const refusal = settingRefusal(dialect.id, key, value, t.s.values, t.s.identity?.fb);
  if (refusal !== null) {
    t.decide('settingsWrite', deny(`Not written: ${refusal}`, 'Correct the value and try again.', 'SAFETY §4.6; PN §12.4 (forbidden writes); schema overlay'));
    return;
  }
  const holdTrusted = restingUsesHold(dialect);
  const tokens = gateTokens(dialect, holdTrusted);
  const id = (t.s.settingWrite?.id ?? 0) + 1;
  t.set({
    settingWrite: { id, key, value: value as number, phase: 'gate', gate: {} },
    queue: [...tokens.map((token) => ({ token, purpose: 'gate' as const })), ...t.s.queue],
  });
  t.emit({ kind: 'log', text: `settings write #${id}: ${key} = ${String(value)} (gate: ${tokens.join(' ')})` });
  t.decide('settingsWrite', matrix);
}

export function finishSettingWrite(t: Tx, message: { outcome: SettingWriteOutcome; detail: string; patch?: Partial<SettingWriteState> | undefined; }, _deps: ReducerDeps): void {
  const { outcome, detail, patch = {} } = message;
  const w = t.s.settingWrite;
  /* c8 ignore next -- callers finish only a write in progress; kept so a second finish can never overwrite the first */
  if (w === null || w.phase === 'done') return;
  t.set({
    settingWrite: { ...w, ...patch, phase: 'done', outcome, detail },
    queue: t.s.queue.filter((q) => q.purpose !== 'gate' && q.purpose !== 'setting' && q.purpose !== 'readback'),
  });
  t.emit({ kind: 'log', text: `settings write #${w.id}: ${w.key} → ${outcome}${detail === '' ? '' : ` (${detail})`}` });
}

export function onGateAnswer(t: Tx, message: { token: string; r: Response; }, deps: ReducerDeps): void {
  const { token, r } = message;
  const { finishSettingWrite, withNumber, dialectOf, matrixSnapshot } = deps;
  const w = t.s.settingWrite;
  /* c8 ignore next -- gate reads are queued only by a write in its gate phase, and dropped when it ends */
  if (w === null || w.phase !== 'gate') return;
  const value = r.r[token];
  if (r.footer.status !== 0 || typeof value !== 'number' || !Number.isFinite(value)) {
    finishSettingWrite(t, 'refused', `Not written: the board did not answer the ${token} read (status ${r.footer.status}).`);
    return;
  }
  const gate = { ...w.gate, [token]: value };
  t.set({ settingWrite: { ...w, gate }, live: withNumber(t, t.s.live, token, value) });
  if (t.s.queue.some((q) => q.purpose === 'gate')) return;
  const dialect = dialectOf(t.s) as Dialect;
  if (t.s.dwellWait != null) {
    finishSettingWrite(t, 'refused', 'Not written: the dwell has not been confirmed finished.');
    return;
  }
  const verdict = judgeGate(dialect, gate, restingUsesHold(dialect));
  if (!verdict.ok) {
    finishSettingWrite(t, 'refused', verdict.detail);
    return;
  }
  // The state may have changed while the gate was read (an overlay, a status report): ask the matrix again.
  const again = allowed(matrixSnapshot(t.s), 'settingsWrite', t.config.release);
  /* c8 ignore next 4 -- an overlay that denies writes (FAULT, LOST) also ends the write before the gate completes; the re-check stays */
  if (!again.allowed) {
    finishSettingWrite(t, 'refused', `Not written: ${again.reason}`);
    return;
  }
  t.set({ settingWrite: { ...(t.s.settingWrite as SettingWriteState), phase: 'writing' }, queue: [{ token: w.key, purpose: 'setting', value: w.value }, ...t.s.queue] });
}

export function onSettingAnswer(t: Tx, r: Response, deps: ReducerDeps): void {
  const { finishSettingWrite, TINYG_SETTING_REFUSED_IN_CYCLE } = deps;
  const w = t.s.settingWrite;
  /* c8 ignore next -- a setting line is written only in the writing phase */
  if (w === null || w.phase !== 'writing') return;
  const echoed = readBackValue(r.r, w.key);
  if (w.exception !== undefined && r.footer.status === 0) {
    // TG answers 0 after an `er` 9 although nothing was saved (TG-SETTINGS-GATE): the `er` decides.
    finishSettingWrite(t, 'rejected', `The board refused to save the setting (status ${w.exception}: a cycle was active); it may hold the value until a reset.`, { answer: { status: 0, value: echoed } });
    return;
  }
  if (r.footer.status !== 0) {
    const inJob = r.footer.status === TINYG_SETTING_REFUSED_IN_CYCLE && t.s.dialect?.id === 'tinyg-en';
    const text = inJob ? 'The board refused the write: a job is running or has moves queued (status 117). Nothing changed; set it when the machine is idle.' : `The board refused the write (status ${r.footer.status}); the setting was not stored.`;
    finishSettingWrite(t, 'rejected', text, { answer: { status: r.footer.status, value: echoed } });
    return;
  }
  t.set({ settingWrite: { ...w, phase: 'readback', answer: { status: 0, value: echoed } }, queue: [{ token: w.key, purpose: 'readback' }, ...t.s.queue] });
}

export function onReadBackAnswer(t: Tx, message: { r: Response; at: number; }, deps: ReducerDeps): void {
  const { r, at } = message;
  const { dialectOf, finishSettingWrite } = deps;
  const w = t.s.settingWrite;
  /* c8 ignore next -- a read-back is queued only in the readback phase */
  if (w === null || w.phase !== 'readback') return;
  const value = readBackValue(r.r, w.key);
  t.set({ values: { ...t.s.values, [w.key]: { value, status: r.footer.status, at } } });
  const dialect = dialectOf(t.s) as Dialect;
  if (r.footer.status === 0 && readBackMatches(dialect.id, w.key, w.value, value)) {
    finishSettingWrite(t, 'verified', '', { readBack: value });
    return;
  }
  const shown = r.footer.status !== 0 ? `the read-back failed (status ${r.footer.status})` : `the board reads back ${JSON.stringify(value)}, not ${w.value}`;
  finishSettingWrite(t, 'mismatch', `Written, but ${shown}.`, { readBack: value });
}

/** A settings write in progress is cut off (FAULT, LOST, reset, link change). */
export function interruptSettingWrite(t: Tx, why: string, deps: ReducerDeps): void {
  const { interruptBootEntry, settingWriteActive, finishSettingWrite } = deps;
  interruptBootEntry(t, why);
  if (!settingWriteActive(t.s)) return;
  const w = t.s.settingWrite as SettingWriteState;
  // A write already sent may have been stored: say so.
  const outcome: SettingWriteOutcome = w.phase === 'gate' ? 'refused' : 'interrupted';
  finishSettingWrite(t, outcome, outcome === 'refused' ? `Not written: ${why}.` : `Interrupted: ${why}. The board may or may not hold the new value; read it back before trusting it.`);
}

export function bindSettings(deps: ReducerDeps): Pick<ReducerDeps, 'onSettingsWrite' | 'finishSettingWrite' | 'onGateAnswer' | 'onSettingAnswer' | 'onReadBackAnswer' | 'interruptSettingWrite'> {
  return {
    onSettingsWrite: (t, key, value, matrix) => onSettingsWrite(t, { key: key, value: value, matrix: matrix }, deps),
    finishSettingWrite: (t, outcome, detail, patch) => finishSettingWrite(t, { outcome: outcome, detail: detail, patch: patch }, deps),
    onGateAnswer: (t, token, r) => onGateAnswer(t, { token: token, r: r }, deps),
    onSettingAnswer: (t, r) => onSettingAnswer(t, r, deps),
    onReadBackAnswer: (t, r, at) => onReadBackAnswer(t, { r: r, at: at }, deps),
    interruptSettingWrite: (t, why) => interruptSettingWrite(t, why, deps),
  };
}
