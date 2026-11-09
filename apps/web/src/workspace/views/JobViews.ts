/**
 * Phase 3 jobs in the Run view (owner 2026-11-02; SAFETY §4.4a, H70-H78):
 *
 * - `JobSteps`: the Check → Set zero → Start stepper on the job card. The open file goes to the worker, which
 *   checks it with the live board; plan versus board work zero (C31), homed or C36, the spindle (C32), the W5
 *   attestation; Start is enabled only when every blocker is gone, each named in plain words, then C30.
 * - `JobStatus` (JobStatusCard.ts, re-exported here): the job card while a job runs or after it ended.
 * - `JobStopCard`: what to do at a stop: the tool-change card (W37, C34, C35), a refused line (W38, C33), a
 *   breakpoint (W43), a program stop (W17), a reset (W40).
 *
 * Without a LIVE jobs session every control is disabled and says why. The page never decides that the machine
 * moved: the session decides every request again.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { STOP_TEXT, c30, c31, c32, c33, c34, c35, c36, c40, w17, w37, w5 } from '@synthetos/safety';
import type { PreviewParts } from '../../preview/PreviewPanel.ts';
import { fileKey, loadBreakpoints } from '../../preview/gcodeList.ts';
import { signalText } from '../../shell/signal.ts';
import { advisorSummary } from '../advisorState.ts';
import { toolStore } from '../library.ts';
import type { WorkspaceModel } from '../model.ts';
import { ConfirmCard } from '../ui.ts';
import { boardZero, bytesText, duration, jobUi, loadPlan, savePlan, startBlockers, textHash, zeroText, type JobSnapshot, type StartChoices } from '../jobUi.ts';
import { activeJob } from '../jobModel.ts';
import { positionEstablished } from '../../preview/livePlacement.ts';
import { runZeroCheck, setupPlan } from '../zeroPlan.ts';
import type { StopHooks } from './JobStatusCard.ts';
import { checkedText } from '../lineWords.ts';

export { JobStatus, type StopHooks } from './JobStatusCard.ts';

const NO_CHOICES: StartChoices = Object.freeze({ unhomed: false, workZero: false, spindle: false, attended: false, travel: false });

function speedsText(job: JobSnapshot | null): string {
  const speeds = job?.report?.speeds ?? [];
  // In plain words (C12): "16,000 rpm", not the G-code word "S16000".
  return speeds.length === 0 ? 'speed set by the machine' : speeds.map((s) => `${s.toLocaleString('en-US')} rpm`).join(', ');
}

/** The Check → Set zero → Start stepper (H73). */
export function JobSteps({ parts, model, onAnalyze }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly onAnalyze?: () => void }): ComponentChild {
  const { state } = parts;
  const result = state.status === 'ready' ? state.result : null;
  const view = model?.live.value ?? null;
  const ui = jobUi(view);
  const send = model?.actions.value?.job;
  const text = useMemo(() => (result === null ? null : bytesText(result.bytes)), [result]);
  const hash = useMemo(() => (text === null ? null : textHash(text)), [text]);
  const key = useMemo(() => (result === null || state.fileName === null ? null : fileKey(state.fileName, result.bytes)), [result, state.fileName]);
  const [choices, setChoices] = useState<StartChoices>(NO_CHOICES);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [planTick, setPlanTick] = useState(0);
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
  // A new file starts with no confirmations.
  useEffect(() => setChoices(NO_CHOICES), [hash]);

  const plan = useMemo(() => (key === null ? null : loadPlan(key)), [key, planTick]);
  const board = boardZero(s);
  // A saved plan first, else the setup's planned zero from Place job (S6); it compares only once the position is set.
  const setup = activeJob.value;
  const zero = runZeroCheck(board, plan, setup === null ? null : setupPlan(setup), s !== null && positionEstablished({ mpo: {}, pos: {}, home: s.live.home ?? 0, overlays: s.overlays }));
  const blockers = startBlockers(ui, { name: state.fileName, hash }, zero, choices);
  const checked = job !== null && job.hash === hash && (job.phase !== 'loading' && job.report !== null && !job.report.blocked);
  const zeroDone = zero.state === 'match' || (zero.state === 'differs' && choices.workZero);
  const tick = (k: keyof StartChoices) => (e: Event) => setChoices({ ...choices, [k]: (e.currentTarget as HTMLInputElement).checked });
  const startsSpindle = job?.report?.startsSpindle === true;
  const live = send !== undefined && ui.connected;

  if (ui.active) return null;
  return h(
    'div',
    { class: 'job-steps', 'data-job': 'steps' },
    h('div', { class: 'advisor-job-check', 'data-job': 'advisor' }, h('span', null, advisorSummary.value), h('button', { type: 'button', class: 'small', 'data-action': 'advisor-open', onClick: onAnalyze }, 'Analyze')),
    h(
      'ol',
      { class: 'flow', 'aria-label': 'Before you start' },
      h('li', { class: checked ? 'done' : undefined, 'data-step': 'check' }, h('span', null, checked ? '✓' : '1'), 'Check'),
      h('li', { class: zeroDone ? 'done' : undefined, 'data-step': 'zero' }, h('span', null, zeroDone ? '✓' : '2'), 'Set zero'),
      h('li', { 'data-step': 'start' }, h('span', null, '3'), 'Start'),
    ),
    !ui.enabled || !ui.connected
      ? h('p', { class: 'fine', 'data-job': 'later', id: 'start-later' }, ui.connected ? 'Job running is unavailable in this build.' : 'Connect to check this file against the board and run it.')
      : h(
          'div',
          { class: 'job-prep' },
          // 1 Check
          h(
            'div',
            { class: 'job-prep-row', 'data-job': 'check' },
            h('strong', null, 'Check'),
            job === null || job.hash !== hash
              ? h('span', null, state.fileName === null ? 'Open a file.' : 'Checking with this board…')
              : job.phase === 'loading'
                ? h('span', null, 'Checking with this board…')
                : job.report?.blocked === true
                  ? h('span', { class: 'warn-text' }, `Blocked with this board’s values: ${job.report.blocks.map((b) => `line ${b.line}: ${b.message}`).slice(0, 2).join('; ')}`)
                  : h('span', null, `${checkedText(job.total, result === null ? null : result.sourceLines.length, job.report?.splits ?? 0)}${(job.report?.toolChanges.length ?? 0) > 0 ? `, ${job.report?.toolChanges.length} tool ${(job.report?.toolChanges.length ?? 0) === 1 ? 'change' : 'changes'} (Run stops for each)` : ''}${job.report !== null && job.report !== undefined ? `, about ${duration(job.report.seconds)} (estimate)` : ''}.`),
          ),
          // 2 Set zero: plan versus board
          h(
            'div',
            { class: `job-prep-row zero-${zero.state}`, 'data-job': 'zero', 'data-zero': zero.state },
            h('strong', null, 'Work zero'),
            h('span', null, zero.text),
            board !== null && key !== null
              ? h('button', { type: 'button', class: 'small', 'data-action': 'record-plan', onClick: () => { savePlan(key, board); setPlanTick(planTick + 1); } }, plan === null ? 'Save work zero for this file' : 'Update saved work zero')
              : null,
          ),
          zero.state === 'differs'
            ? h('label', { class: 'job-tick', 'data-safety': 'C31' }, h('input', { type: 'checkbox', checked: choices.workZero, 'data-job': 'confirm-zero', onChange: tick('workZero') }), c31({ board: zeroText(zero.board), plan: zero.planText }))
            : null,
          s?.live.home !== 1
            ? h('label', { class: 'job-tick', 'data-safety': 'C36' }, h('input', { type: 'checkbox', checked: choices.unhomed, 'data-job': 'confirm-unhomed', onChange: tick('unhomed') }), c36())
            : null,
          // OD-24: the travel could not be confirmed (position not set by a homing, or a limit not read): C40 before Start.
          job?.report?.travel?.confirm !== null && job?.report?.travel?.confirm !== undefined && checked
            ? h('label', { class: 'job-tick', 'data-safety': 'C40' }, h('input', { type: 'checkbox', checked: choices.travel, 'data-job': 'confirm-travel', onChange: tick('travel') }), c40({ why: job.report.travel.confirm.text }))
            : null,
          startsSpindle ? h('label', { class: 'job-tick', 'data-safety': 'C32' }, h('input', { type: 'checkbox', checked: choices.spindle, 'data-job': 'confirm-spindle', onChange: tick('spindle') }), c32({ speeds: speedsText(job) })) : null,
          // The board's modes as read (OD-19), and what Start writes so the job runs as the preview shows.
          s === null
            ? null
            : h(
                'div',
                { class: 'job-prep-row', 'data-job': 'modes' },
                h('strong', null, 'Board modes'),
                h('span', null, h('span', { 'data-job': 'board-modes' }, s.boardModes.text), checked && job?.startModes !== null && job?.startModes !== undefined ? h('span', { class: 'job-start-modes', 'data-job': 'start-modes' }, job.startModes) : null),
              ),
          // 3 Start: W5 and the attestation
          h('p', { class: 'job-w5', 'data-safety': 'W5' }, ...signalText(w5({ distanceMm: Math.round(job?.queuedBoundMm ?? 0) || 50, seconds: 5 }))),
          h('label', { class: 'job-tick', 'data-job': 'attest' }, h('input', { type: 'checkbox', checked: choices.attended, 'data-job': 'confirm-attended', onChange: tick('attended') }), 'Screen lock and sleep are disabled; I will stay at the machine.'),
          blockers.length === 0 ? null : h('ul', { class: 'job-blockers', 'data-job': 'blockers', 'aria-label': 'Start is not available yet' }, blockers.map((b) => h('li', { key: b.id, 'data-blocker': b.id }, b.text))),
          note === null ? null : h('p', { class: 'unavailable', role: 'status' }, note),
        ),
    asking && job !== null && send !== undefined && state.fileName !== null
      ? h(ConfirmCard, {
          text: c30({ file: state.fileName, lines: job.total, workZero: board === null ? 'not read' : zeroText(board), spindle: startsSpindle ? `starts with ${speedsText(job)}` : 'not used' }),
          confirm: 'Start job',
          safety: 'C30',
          onCancel: () => setAsking(false),
          onConfirm: () => {
            setAsking(false);
            const breakpoints = key === null ? [] : [...loadBreakpoints(key)];
            void send({ op: 'start', breakpoints, confirm: { unhomed: choices.unhomed || s?.live.home === 1, workZero: zeroDone, spindle: !startsSpindle || choices.spindle, travel: choices.travel } }).then(setNote);
          },
        })
      : null,
    h(
      'button',
      {
        type: 'button',
        class: 'primary',
        'data-action': 'start-job',
        'data-machine-control': 'start',
        ...(live && ui.enabled && blockers.length === 0 && !asking ? { onClick: () => setAsking(true) } : { disabled: true }),
        title: blockers.length === 0 ? 'Start the job' : blockers.map((b) => b.text).join(' '),
      },
      'Start job',
    ),
  );
}

function toolName(n: number | null): string {
  if (n === null) return 'the next tool';
  const t = toolStore.value.value.find((x) => x.number === n);
  return t === undefined ? `T${n} (not in your library)` : `T${n}, ${t.tool.name} (${t.tool.geometry.diameter} mm)`;
}

/** What to do at a stop point: tool change, refused line, breakpoint, program stop. */
export function JobStopCard({ model, onZeroZ, onStopJob }: { readonly model: WorkspaceModel | null; readonly onZeroZ?: () => void } & StopHooks): ComponentChild {
  const view = model?.live.value ?? null;
  const ui = jobUi(view);
  const job = ui.job;
  const send = model?.actions.value?.job;
  const [asking, setAsking] = useState<'resume' | 'skip' | null>(null);
  const [restart, setRestart] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setAsking(null);
    setRestart(false);
    setNote(null);
  }, [job?.phase]);
  if (job === null || send === undefined) return null;
  const s = ui.snapshot;
  const resume = (skip: boolean, spindleRestart: boolean): void => {
    setAsking(null);
    void send({ op: 'resume', skip, spindleRestart }).then(setNote);
  };
  if (job.phase === 'toolChange' && job.toolChange !== null) {
    const tc = job.toolChange;
    const needsRestart = tc.spindle !== 'off' && !tc.restartsSpindle && tc.speed !== null;
    const reported = s?.live.tool;
    return h(
      'section',
      { class: 'job-stop tool-change', 'data-job': 'tool-change', 'aria-label': 'Tool change' },
      h('h2', null, `Tool change at line ${tc.line}`),
      h('p', { class: 'motion-warning', 'data-safety': 'W37', role: 'alert' }, ...signalText(w37())),
      h(
        'dl',
        { class: 'job-facts' },
        h('div', null, h('dt', null, 'Current tool'), h('dd', { 'data-job': 'tool-current' }, typeof reported === 'number' ? `${toolName(reported)} (reported)` : 'Not reported')),
        h('div', null, h('dt', null, 'Next tool'), h('dd', { 'data-job': 'tool-next' }, toolName(tc.tool))),
        h('div', null, h('dt', null, 'Spindle'), h('dd', { 'data-job': 'tool-spindle' }, s?.live.spe === 0 ? 'Stopped (Run sent M5 and M9)' : 'Run sent M5 and M9: wait until it has stopped')),
        h('div', null, h('dt', null, 'Moved since the stop'), h('dd', { 'data-job': 'tool-moved' }, tc.moved ? 'Yes: Resume returns at a safe height first' : 'No')),
      ),
      h('p', { class: 'fine' }, 'Use the Jog tab to move to a change position. After the change you can re-zero Z here; it is saved as the Z work offset.'),
      h(
        'div',
        { class: 'job-controls' },
        onZeroZ === undefined ? null : h('button', { type: 'button', class: 'small', 'data-machine-control': 'zero', 'data-action': 'tool-zero-z', onClick: onZeroZ }, 'Re-zero Z…'),
        h('button', { type: 'button', class: 'small primary', 'data-machine-control': 'resume', 'data-action': 'tool-resume', onClick: () => setAsking('resume') }, 'Resume…'),
      ),
      asking === 'resume'
        ? h(
            ConfirmCard,
            { text: c34({ tool: toolName(tc.tool), line: tc.line }), confirm: 'Resume', safety: 'C34', onCancel: () => setAsking(null), onConfirm: () => resume(false, needsRestart && restart) },
            needsRestart
              ? h('label', { class: 'job-tick', 'data-safety': 'C35' }, h('input', { type: 'checkbox', checked: restart, 'data-job': 'confirm-restart', onChange: (e: Event) => setRestart((e.currentTarget as HTMLInputElement).checked) }), c35({ direction: tc.spindle === 'ccw' ? 'M4' : 'M3', rpm: tc.speed as number }))
              : null,
          )
        : null,
      note === null ? null : h('p', { class: 'unavailable', role: 'status' }, note),
    );
  }
  if (job.phase === 'refused' && job.refused !== null) {
    const r = job.refused;
    return h(
      'section',
      { class: 'job-stop refused', 'data-job': 'refused', 'aria-label': 'Refused line' },
      h('h2', null, `Line ${r.line} was refused`),
      h('p', { class: 'motion-warning', 'data-safety': 'W38', role: 'alert' }, ...signalText(job.message ?? '')),
      h('pre', { class: 'job-line', 'data-job': 'refused-line' }, r.text),
      h(
        'div',
        { class: 'job-controls' },
        h('button', { type: 'button', class: 'small danger', 'data-machine-control': 'job-stop', ...(onStopJob === undefined ? { disabled: true } : { onClick: onStopJob }) }, STOP_TEXT.stopJob),
        h('button', { type: 'button', class: 'small', 'data-machine-control': 'resume', 'data-action': 'skip-line', onClick: () => setAsking('skip') }, 'Skip line and continue…'),
      ),
      asking === 'skip' ? h(ConfirmCard, { text: c33({ line: r.line, text: r.text }), confirm: 'Skip line and continue', safety: 'C33', onCancel: () => setAsking(null), onConfirm: () => resume(true, false) }) : null,
      note === null ? null : h('p', { class: 'unavailable', role: 'status' }, note),
    );
  }
  if (job.phase === 'breakpoint' || job.phase === 'programStop') {
    return h(
      'section',
      { class: `job-stop ${job.phase}`, 'data-job': job.phase, 'aria-label': job.phase === 'breakpoint' ? 'Breakpoint' : 'Program stop' },
      h('p', { class: 'job-message', 'data-safety': job.phase === 'breakpoint' ? 'W43' : 'W17', role: 'status' }, ...signalText(job.phase === 'breakpoint' ? (job.message ?? '') : w17())),
      h(
        'div',
        { class: 'job-controls' },
        h('button', { type: 'button', class: 'small primary', 'data-machine-control': 'resume', 'data-action': 'job-resume', onClick: () => resume(false, false) }, 'Resume'),
        h('button', { type: 'button', class: 'small danger', 'data-machine-control': 'job-stop', ...(onStopJob === undefined ? { disabled: true } : { onClick: onStopJob }) }, STOP_TEXT.stopJob),
      ),
      note === null ? null : h('p', { class: 'unavailable', role: 'status' }, note),
    );
  }
  return null;
}
