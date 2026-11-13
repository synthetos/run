import { blockedFileNote } from '../blockingFindings.ts';
/**
 * The Run step (owner, 2026-11-09: "the ugliest cnc page I have ever seen: text everywhere, check boxes everywhere,
 * warnings everywhere"). One "Ready to start?" list (readyModel.ts), at most one tick for the confirmations that apply,
 * and Start job, the only primary button, enabled the moment nothing blocks. A blocker says the action that clears
 * it, as a button. What Start must still ask comes as a modal: the travel question (C40/C41), then the start
 * confirmation (C30) with W5. The explanations go to the Notes tab (notes/notes.ts).
 *
 * The file goes to the worker to be checked with this board, and Start sends every confirmation the session requires
 * (unhomed, work zero, spindle, travel); the session decides again (SAFETY §4.4a, H73).
 */
import { h, type ComponentChild } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { c30, c31, c32, c36, w5 } from '@synthetos/safety';
import type { PreviewParts } from '../../preview/PreviewPanel.ts';
import { fileKey, loadBreakpoints } from '../../preview/gcodeList.ts';
import { positionEstablished } from '../../preview/livePlacement.ts';
import { advisorSummary } from '../advisorState.ts';
import { settingsOf } from '../boardFacts.ts';
import { ClearAlarmConfirm, blockAction, currentBlock } from '../ControlBlockCard.ts';
import { confirmFor, type Asking } from '../homing.ts';
import { activeJob } from '../jobModel.ts';
import { boardZero, bytesText, duration, jobUi, loadPlan, savePlan, textHash, zeroText, type JobSnapshot } from '../jobUi.ts';
import { checkedText } from '../lineWords.ts';
import type { WorkspaceModel } from '../model.ts';
import { homingView } from '../motion.ts';
import type { MotionAxis } from '../../machine-worker/rpc.ts';
import { usePublishNotes } from '../notes/usePublishNotes.ts';
import { noteAction, useNoteAction } from '../notes/noteActions.ts';
import { toolStore } from '../library.ts';
import { mismatchSummary, toolMismatches } from '../toolMismatch.ts';
import { editToolAction, useFileToolAction } from '../ToolMismatchNotes.ts';
import { zeroNote } from './zeroNote.ts';
import type { Note } from '../notes/notes.ts';
import { ConfirmCard } from '../ui.ts';
import { jobStep } from '../jobWorkflow.ts';
import { signalText } from '../../shell/signal.ts';
import { runZeroCheck, setupPlan } from '../zeroPlan.ts';
import { liveWorkZero } from '../liveZero.ts';
import { c30ZeroNumbers, c30ZeroWords } from './c30Zero.ts';
import { Details } from './ChoiceModal.ts';
import { ReadyList } from './ReadyList.ts';
import { readyModel, type ReadyActionId, type ReadyInput, type TravelAsk } from './readyModel.ts';
import { refusedBody, tickText } from './runCopy.ts';
import { ChoiceModal } from './ChoiceModal.ts';
import { TravelModal } from './TravelModal.ts';
import { askUnknownAgain } from '../unknownModal.ts';
import { setWorkZeroFirst } from './zeroFirst.ts';

/** The spindle's speeds in a few words for the list: "12,000 rpm" or "12,000–18,000 rpm". */
function speedRange(job: JobSnapshot | null): string {
  const speeds = job?.report?.speeds ?? [];
  if (speeds.length === 0) return 'speed set by the machine';
  const lo = Math.min(...speeds);
  const hi = Math.max(...speeds);
  return lo === hi ? `${lo.toLocaleString('en-US')} rpm` : `${lo.toLocaleString('en-US')}–${hi.toLocaleString('en-US')} rpm`;
}

function speedsText(job: JobSnapshot | null): string {
  const speeds = job?.report?.speeds ?? [];
  // In plain words (C12): "16,000 rpm", not the G-code word "S16000".
  return speeds.length === 0 ? 'speed set by the machine' : speeds.map((s) => `${s.toLocaleString('en-US')} rpm`).join(', ');
}

/** The travel question Start asks, from the check's finding: C41 for a move past travel (axis not homed), else C40. */
function travelAskOf(job: JobSnapshot | null, homeable: (axis: string) => boolean, zeroFirst: boolean): TravelAsk | null {
  const f = job?.report?.travel?.confirm ?? null;
  if (f === null) return null;
  if (f.kind === 'outside' && f.past !== undefined && f.line !== null) {
    const p = f.past;
    return { kind: 'past', axis: p.axis, line: f.line, reach: p.reach, limit: p.limit, unit: p.unit, more: p.more, text: f.text, homeable: homeable(p.axis), zeroFirst };
  }
  return { kind: 'unchecked', why: f.text, text: f.text };
}

type Modal = null | 'travel' | 'start' | 'alarm' | { readonly home: Asking } | { readonly refused: string };

export function RunPanel({ parts, model, onAnalyze }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly onAnalyze?: () => void }): ComponentChild {
  const { state } = parts;
  const result = state.status === 'ready' ? state.result : null;
  const view = model?.live.value ?? null;
  const ui = jobUi(view);
  const send = model?.actions.value?.job;
  const motion = model?.actions.value?.motion;
  const text = useMemo(() => (result === null ? null : bytesText(result.bytes)), [result]);
  const hash = useMemo(() => (text === null ? null : textHash(text)), [text]);
  const key = useMemo(() => (result === null || state.fileName === null ? null : fileKey(state.fileName, result.bytes)), [result, state.fileName]);
  const [ticked, setTicked] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [travelOk, setTravelOk] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [planTick, setPlanTick] = useState(0);
  const [starting, setStarting] = useState(false);
  const job = ui.job;
  const s = ui.snapshot;
  const idle = s !== null && (s.base === 'IDLE_HOMED' || s.base === 'IDLE_UNHOMED');

  // The open file goes to the worker to be checked with this board (once per file and link, never while a job runs).
  useEffect(() => {
    if (send === undefined || !ui.enabled || !idle || text === null || hash === null || state.fileName === null || ui.active) return;
    if (job !== null && job.hash === hash && job.phase !== 'blocked') return;
    if (job?.phase === 'loading') return;
    void send({ op: 'load', name: state.fileName, text, c22: false }).then(setNote);
  }, [send, ui.enabled, idle, hash, state.fileName, job?.hash, job?.phase, ui.active, s?.epoch]);
  // A new file, or a new travel finding, starts with nothing confirmed (review S3: a new finding needs a new answer).
  const travelText = job?.report?.travel?.confirm?.text ?? null;
  useEffect(() => setTicked(false), [hash]);
  useEffect(() => setTravelOk(null), [travelText, hash]);
  // After Start: a job that failed before streaming (startFailed in the session) is said in the modal.
  useEffect(() => {
    if (!starting || job === null) return;
    if (job.phase === 'failed' && job.startedAt === null && job.message !== null) {
      setStarting(false);
      setModal({ refused: job.message });
    } else if (job.startedAt !== null) setStarting(false);
  }, [starting, job?.phase, job?.startedAt, job?.message]);

  const plan = useMemo(() => (key === null ? null : loadPlan(key)), [key, planTick]);
  const board = boardZero(s);
  const setup = activeJob.value;
  const established = s !== null && positionEstablished({ mpo: {}, pos: {}, home: s.live.home ?? 0, overlays: s.overlays });
  const sp = setup === null ? null : setupPlan(setup, liveWorkZero.value);
  const zero = runZeroCheck(board, plan, sp, established);
  const mine = job !== null && job.hash === hash;
  const report = mine && job.phase !== 'loading' ? job.report : null;
  const hv = homingView(view, settingsOf(view));
  const canHome = hv.enabled && hv.configured.length > 0 && motion !== undefined;
  const homeable = (axis: string): boolean => canHome && hv.configured.includes(axis.toLowerCase() as MotionAxis);
  const block = currentBlock(model);
  const wait = s === null ? null : s.rxm.busy || s.reports.phase === 'seeding' || s.reports.phase === 'configuring' || s.reports.phase === 'pending' ? 'Setting up the connection…' : !idle && block === null ? (ui.active ? 'A job is running.' : 'Waiting for the machine to be idle.') : null;
  // The file's tools against the tool table (ToolMismatchNotes.ts publishes the note and owns its two actions).
  const mismatches = useMemo(() => toolMismatches(result?.fileTools ?? [], toolStore.value.value), [result, toolStore.value.value]);
  const firstMismatch = mismatches[0];
  const input: ReadyInput = {
    connected: ui.connected,
    jobsOn: ui.enabled,
    block,
    wait,
    fileName: state.fileName,
    check: !mine || job.phase === 'loading' || report === null
      ? { state: state.fileName === null ? 'none' : 'checking' }
      : report.blocked
        ? { state: 'blocked', line: report.blocks[0]?.line ?? null, message: report.blocks[0]?.message ?? 'The check stopped this file.', more: Math.max(0, report.counts.block - 1) }
        : { state: 'done', lines: result?.fileLines ?? job.total, toolChanges: report.toolChanges.length, seconds: report.seconds },
    zero: s === null ? null : { state: zero.state === 'match' ? 'match' : zero.state === 'unknown' ? 'unknown' : 'differs', comparable: established || zero.source !== 'setup' },
    homed: s === null || s.live.home === undefined ? null : s.live.home === 1,
    homedBy: s?.notices.position?.by,
    canHome,
    // A move past travel while the board's work zero is not the plan's: the zero is the likely cause, so the modal
    // leads with setting it (owner, 2026-11-09), Start anyway comes after.
    travel: report === null ? null : (travelAskOf(job, homeable, zero.state !== 'match') ?? { kind: 'fits' }),
    modes: s?.boardModes.text ?? null,
    feeds: advisorSummary.value,
    spindle: report === null ? null : { starts: report.startsSpindle, speeds: speedRange(job) },
    toolMismatch: firstMismatch === undefined ? null : { number: firstMismatch.number, summary: mismatchSummary(mismatches) ?? '' },
  };
  const ready = readyModel(input);
  const startsSpindle = report?.startsSpindle === true;
  const zeroDone = zero.state === 'match' || (zero.state === 'differs' && ticked);
  const live = send !== undefined && ui.connected && ui.enabled;
  const canStart = live && !ready.blocked && (ready.tick.length === 0 || ticked) && modal === null;

  // The explanations, as notes (Notes tab; owner, 2026-11-09): a short title, one plain sentence that says what it
  // means (no coordinate dumps), the full detail behind More.
  const notes: Note[] = [];
  if (report !== null && mine) {
    const checked = checkedText(job.total, result === null ? null : result.sourceLines.length, report.splits);
    notes.push(report.blocked
      ? (blockedFileNote(report.blocks)[0] ?? { id: 'file-check', topic: 'File', title: 'This file cannot run.', body: 'Review the G-code findings.', tone: 'warn' })
      : { id: 'file-check', topic: 'File', title: 'File checked.', body: `${(result?.fileLines ?? job.total).toLocaleString('en-US')} lines, about ${duration(report.seconds)}.`, detail: `${checked}.`, tone: 'info' });
  }
  if (s !== null && state.fileName !== null) notes.push(zeroNote(zero, established, canHome));
  if (s !== null && mine && job.startModes !== null && job.startModes !== undefined) notes.push({ id: 'modes', topic: 'Board', title: `Board modes: ${s.boardModes.text}.`, body: job.startModes, tone: 'info' });
  const finding = report?.travel?.confirm ?? null;
  if (finding !== null) {
    const past = finding.past;
    notes.push({ id: 'travel', topic: 'Travel', title: 'A move goes past the travel.', body: past === undefined || finding.line === null ? 'Run could not check the travel.' : `Line ${finding.line.toLocaleString('en-US')} moves ${past.axis} past its limit.`, detail: `${finding.text.charAt(0).toUpperCase()}${finding.text.slice(1)}.`, tone: 'warn', ...(finding.line === null ? {} : { link: { kind: 'line', line: finding.line } }) });
  }
  // W5 once, the approved short text with its fire risk (OD-32); the start confirmation shows it again at Start.
  if (state.fileName !== null && ui.connected) notes.push({ id: 'stay', topic: 'Running a job', title: 'Stay at the machine.', body: w5({ distanceMm: Math.round(job?.queuedBoundMm ?? 0) || 50, seconds: 5 }).replace(/^WARNING — /, ''), tone: 'warn', safety: 'W5' });
  // A note's Home button opens Home's own confirmation (C4) here.
  const homeAll = useCallback(() => setModal({ home: { kind: 'home', axes: hv.configured } }), [hv.configured.join(',')]);
  useNoteAction('home', canHome ? homeAll : null);
  usePublishNotes('run-step', notes);

  const act = (id: ReadyActionId): void => {
    switch (id) {
      case 'connect':
        model?.actions.value?.connect();
        return;
      case 'verify':
        askUnknownAgain();
        return;
      case 'home': {
        const axes = ready.travelAsk?.kind === 'past' && homeable(ready.travelAsk.axis) ? [ready.travelAsk.axis.toLowerCase() as MotionAxis] : hv.configured;
        setModal({ home: { kind: 'home', axes } });
        return;
      }
      case 'analyze':
        onAnalyze?.();
        return;
      case 'edit-tool':
        if (firstMismatch !== undefined) noteAction(editToolAction(firstMismatch.number))?.();
        return;
      case 'use-file-tool':
        if (firstMismatch !== undefined) noteAction(useFileToolAction(firstMismatch.number))?.();
        return;
      case 'save-zero':
        if (board !== null && key !== null) {
          savePlan(key, board);
          setPlanTick(planTick + 1);
        }
        return;
      default:
        if (blockAction(id, model) === 'ask-clear-alarm') setModal('alarm');
    }
  };
  const begin = (): void => setModal(ready.travelAsk !== null && travelOk !== travelText ? 'travel' : 'start');
  const startNow = (): void => {
    if (send === undefined || job === null) return;
    setModal(null);
    const breakpoints = key === null ? [] : [...loadBreakpoints(key)];
    const travel = ready.travelAsk === null ? null : travelOk;
    const pastUnhomed = ready.travelAsk?.kind === 'past' && travel !== null;
    setStarting(true);
    // A refusal now (the session's decision) or later (the start failed before the first line) is a modal, not text
    // in a card: a plain title, the reason in a sentence, and OK.
    void send({ op: 'start', breakpoints, confirm: { unhomed: s?.live.home === 1 || pastUnhomed || (ticked && ready.tick.includes('unhomed')), workZero: zeroDone, spindle: !startsSpindle || ticked, travel } }).then((refusal) => {
      if (refusal !== null) {
        setStarting(false);
        setModal({ refused: refusal });
      }
    });
  };

  if (ui.active) return null;
  const spindleWords = startsSpindle ? `starts with ${speedsText(job)}` : 'not used';
  // Plain words in C30 (where the job cuts from); the board's numbers under Details.
  const workZeroWords = c30ZeroWords(board, zero, sp, established);
  const zeroNumbers = c30ZeroNumbers(board);
  return h(
    'div',
    { class: 'job-steps run-panel', 'data-job': 'steps' },
    h('div', { class: 'ready-scroll' }, h(ReadyList, { items: ready.items, onAction: act })),
    // The tick and Start, right under the list (the list folds what passed, so they fit without scrolling).
    h(
      'div',
      { class: 'ready-footer' },
      ready.tick.length === 0
        ? null
        : h('label', { class: 'job-tick ready-tick', 'data-job': 'confirm-start' }, h('input', { type: 'checkbox', checked: ticked, 'data-job': 'confirm-start-box', onChange: (e: Event) => setTicked((e.currentTarget as HTMLInputElement).checked) }), ' ', tickText(ready.tick)),
      note === null ? null : h('p', { class: 'unavailable', role: 'status' }, note),
      h(
      'div',
      { class: 'ready-buttons' },
      h('button', { type: 'button', class: 'small', 'data-action': 'job-step-back', onClick: () => { jobStep.value = 'check'; } }, 'Back'),
      h(
      'button',
      {
        type: 'button',
        class: 'primary start-job',
        'data-action': 'start-job',
        'data-machine-control': 'start',
        ...(canStart ? { onClick: begin } : { disabled: true }),
        title: canStart ? 'Start the job' : ready.blocked ? 'Clear the items marked ✕ first.' : 'Tick the confirmation first.',
      },
      'Start job',
      ),
      ),
    ),
    modal === 'travel' && ready.travelAsk !== null
      ? h(TravelModal, {
          ask: ready.travelAsk,
          ...(ready.travelAsk.kind === 'past' && ready.travelAsk.homeable ? { onHome: () => act('home') } : {}),
          onZero: () => {
            setModal(null);
            setWorkZeroFirst();
          },
          onStart: () => {
            setTravelOk(travelText);
            setModal('start');
          },
          onCancel: () => setModal(null),
        })
      : null,
    modal === 'start' && job !== null && state.fileName !== null
      ? h(
          ConfirmCard,
          {
            text: c30({ file: state.fileName, workZero: workZeroWords, spindle: spindleWords }),
            confirm: 'Start job',
            safety: 'C30',
            onCancel: () => setModal(null),
            onConfirm: startNow,
          },
          // W5 is given before Start, here, at the moment of the decision.
          h('p', { class: 'start-w5', 'data-safety': 'W5' }, ...signalText(w5({ distanceMm: Math.round(job.queuedBoundMm ?? 0) || 50, seconds: 5 }))),
          h(Details, {
            texts: [
              ...(zeroNumbers === null ? [] : [{ text: zeroNumbers }]),
              ...(ready.tick.includes('workZero') && board !== null ? [{ safety: 'C31', text: c31({ board: zeroText(board), plan: zero.planText }) }] : []),
              ...(ready.tick.includes('unhomed') ? [{ safety: 'C36', text: c36() }] : []),
              ...(startsSpindle ? [{ safety: 'C32', text: c32({ speeds: speedsText(job) }) }] : []),
              { safety: 'attestation', text: 'Screen lock and sleep are disabled; I will stay at the machine.' },
            ],
          }),
        )
      : null,
    modal === 'alarm' ? h(ClearAlarmConfirm, { model, onDone: () => setModal(null) }) : null,
    modal !== null && typeof modal === 'object' && 'refused' in modal
      ? h(ChoiceModal, { title: 'The job didn’t start.', body: refusedBody(modal.refused), choices: [{ id: 'refused-ok', label: 'OK', primary: true, onClick: () => setModal(null) }] })
      : null,
    modal !== null && typeof modal === 'object' && 'home' in modal
      ? confirmFor(modal.home, hv, (c) => {
          setModal(null);
          void motion?.(c).then(setNote);
        }, () => setModal(null))
      : null,
  );
}

