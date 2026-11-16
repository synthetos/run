import { onModesAnswer } from '../modes.ts';
import { type ReportStep } from '../reports.ts';
import {
  type Expected
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function onGarbled(t: Tx, at: number, deps: ReducerDeps): void {
  const { owedAnswers, enterFault, consumeOwed, isDataEntry } = deps;
  if (t.s.probe !== null && t.s.probe.settling !== 'none') return;
  const owed = owedAnswers(t.s);
  const index = owed.findIndex((e) => !e.late);
  if (index < 0) return; // nothing was asked: nothing to trust or distrust
  // With job lines owed (line mode), a damaged answer could belong to any of them: stop trusting the link.
  if (owed.some((e) => !e.late && e.purpose === 'job')) {
    enterFault(t, 'unexpectedResponse', 'integrity', 'an answer arrived damaged while job lines were owed', at);
    return;
  }
  // The answer in flight arrived damaged.
  const entry = owed[index] as Expected;
  consumeOwed(t, owed, index, isDataEntry(entry));
  t.cancel('answer');
  if (onGarbledFamily1(t, { entry, at }, deps)) return;
  onGarbledFamily2(t, { entry, at }, deps);
}

export function bindGarbled(deps: ReducerDeps): Pick<ReducerDeps, 'onGarbled'> {
  return {
    onGarbled: (t, at) => onGarbled(t, at, deps),
  };
}

interface GarbledMessage { entry: Expected; at: number; }

function onGarbledSplice(t: Tx, _message: GarbledMessage, _deps: ReducerDeps): void {

  // A damaged answer cannot prove that the first line was parsed as sr.
  // It may have completed a pre-existing motion fragment. Only a validated
  // sr-bearing error in onAnswer may retry; uncertainty stops the probe.
  t.emit({ kind: 'log', text: 'probe: the answer to the first line ({sr:null}) arrived damaged: it cannot show the line was read as a status request, and a leftover partial line in the board\'s buffer may have joined it and run → ORPHANED_MOTION' });
  t.addOverlay('ORPHANED_MOTION');
  t.set({ queue: [] });
  return;

}

function onGarbledProbe(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry } = message;
  const { checkUnclassifiedResting } = deps;

  t.set({
    ready: true,
    base: 'CONNECTED_UNKNOWN',
    queue: [],
    classification: { dialectId: null, mode: 'readOnly', reason: 'probeFailed', detail: `the answer to the ${entry.token} probe arrived damaged`, upgradeOffer: false },
  });
  t.addOverlay('READ_ONLY');
  t.emit({ kind: 'log', text: `probe: the answer to ${entry.token} arrived damaged → unclassified, read-only` });
  checkUnclassifiedResting(t);
  return;
}

function onGarbledReading(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {

  const { finishReading } = deps;

  if (!t.s.queue.some((q) => q.purpose === 'reading')) finishReading(t);
  return;
}

function onGarbledRequest(t: Tx, message: GarbledMessage, _deps: ReducerDeps): void {
  const { entry, at } = message;

  t.set({ values: { ...t.s.values, [entry.token]: { value: null, status: -1, at } } });
  return;
}

function onGarbledVerify(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry } = message;
  const { refuseAck } = deps;

  refuseAck(t, `the ${entry.token} read arrived damaged`);
  return;
}

function onGarbledLiveness(_t: Tx, _message: GarbledMessage, _deps: ReducerDeps): void {

  return;
}

function onGarbledPoll(_t: Tx, _message: GarbledMessage, _deps: ReducerDeps): void {

  return;
}

function onGarbledMotion(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry, at } = message;
  const { enterFault } = deps;

  // Nothing shows whether the line ran: stop trusting the link (SAFETY §3 garbled frame).
  enterFault(t, 'unexpectedResponse', 'integrity', `the answer to a motion line (${String(entry.line)}) arrived damaged`, at);
  return;
}

function onGarbledGate(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry } = message;
  const { finishSettingWrite } = deps;

  finishSettingWrite(t, 'refused', `Not written: the answer to the ${entry.token} read arrived damaged.`);
  return;
}

function onGarbledBootGate(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry } = message;
  const { refuseBoot } = deps;

  refuseBoot(t, `the answer to the ${entry.token} read arrived damaged`);
  return;
}

function onGarbledSetting(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {

  const { finishSettingWrite } = deps;

  finishSettingWrite(t, 'unconfirmed', 'The answer to the write arrived damaged. The board may or may not hold the new value; read it back before trusting it.');
  return;
}

function onGarbledReadback(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {

  const { finishSettingWrite } = deps;

  finishSettingWrite(t, 'mismatch', 'Written (status 0), but the read-back arrived damaged.');
  return;
}

function onGarbledSeed(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry, at } = message;
  const { seedAnswered } = deps;

  t.set({ values: { ...t.s.values, [entry.token]: { value: null, status: -1, at } } });
  seedAnswered(t, entry, at);
  return;
}

function onGarbledReport(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {

  const { failReports, reportStepText } = deps;

  failReports(t, `the answer to ${reportStepText(t.s.reports.step as ReportStep)} arrived damaged`);
  return;
}

function onGarbledJobPrep(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry, at } = message;
  const { features } = deps;

  features.onJobPrepAnswer?.(t, entry, null, at);
  return;
}

function onGarbledLineMode(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { at } = message;
  const { features } = deps;

  features.onLineModeAnswer?.(t, null, at);
  return;
}

function onGarbledJobRuntime(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry, at } = message;
  const { features } = deps;

  features.onJobRuntimeAnswer?.(t, entry, null, at);
  return;
}

function onGarbledModes(t: Tx, message: GarbledMessage, _deps: ReducerDeps): void {
  const { entry } = message;

  onModesAnswer(t, entry, undefined);
  return;
}

function onGarbledProbeZ(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry, at } = message;
  const { features, MOTION_DEPS } = deps;

  features.onProbeGarbled?.(t, MOTION_DEPS, entry, at);
  return;
}

function onGarbledFamily1(t: Tx, message: GarbledMessage, deps: ReducerDeps): boolean {
  const { entry } = message;
  switch (entry.purpose) {
    case 'splice':
      onGarbledSplice(t, { ...message, entry }, deps);
      return true;
    case 'probe':
      onGarbledProbe(t, { ...message, entry }, deps);
      return true;
    case 'reading':
      onGarbledReading(t, { ...message, entry }, deps);
      return true;
    case 'request':
      onGarbledRequest(t, { ...message, entry }, deps);
      return true;
    case 'verify':
      onGarbledVerify(t, { ...message, entry }, deps);
      return true;
    case 'liveness':
      onGarbledLiveness(t, { ...message, entry }, deps);
      return true;
    case 'poll':
      onGarbledPoll(t, { ...message, entry }, deps);
      return true;
    case 'motion':
      onGarbledMotion(t, { ...message, entry }, deps);
      return true;
    case 'gate':
      onGarbledGate(t, { ...message, entry }, deps);
      return true;
    case 'bootGate':
      onGarbledBootGate(t, { ...message, entry }, deps);
      return true;
    /* c8 ignore next 2 -- the link closes as soon as {"boot":1} is written */
    case 'boot':
      return true;
    case 'setting':
      onGarbledSetting(t, { ...message, entry }, deps);
      return true;
  }
  return false;
}

function onGarbledFamily2(t: Tx, message: GarbledMessage, deps: ReducerDeps): void {
  const { entry } = message;
  switch (entry.purpose) {
    case 'readback':
      onGarbledReadback(t, { ...message, entry }, deps);
      return;
    case 'seed':
      onGarbledSeed(t, { ...message, entry }, deps);
      return;
    case 'report':
      onGarbledReport(t, { ...message, entry }, deps);
      return;
    /* c8 ignore next 2 -- a job entry owed makes the damaged answer a FAULT above */
    case 'job':
      return;
    case 'jobPrep':
      onGarbledJobPrep(t, { ...message, entry }, deps);
      return;
    case 'lineMode':
      onGarbledLineMode(t, { ...message, entry }, deps);
      return;
    case 'jobRuntime':
      onGarbledJobRuntime(t, { ...message, entry }, deps);
      return;
    case 'modes':
      onGarbledModes(t, { ...message, entry }, deps);
      return;
    case 'probeZ':
      onGarbledProbeZ(t, { ...message, entry }, deps);
      return;
  }
}
