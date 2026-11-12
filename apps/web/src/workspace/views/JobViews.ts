import { toolDisplayName } from '../tools/displayName.ts';
/**
 * Phase 3 jobs in the Run view (owner 2026-11-02; SAFETY §4.4a, H70-H78):
 *
 * - The Run step's "Ready to start?" list and Start are in ../run/RunPanel.ts (owner, 2026-11-09).
 * - `JobStatus` (JobStatusCard.ts, re-exported here): the job card while a job runs or after it ended.
 * - `JobStopCard`: what to do at a stop: the tool-change card (W37, C34, C35), a refused line (W38, C33), a
 *   breakpoint (W43), a program stop (W17), a reset (W40).
 *
 * Without a LIVE jobs session every control is disabled and says why. The page never decides that the machine
 * moved: the session decides every request again.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { STOP_TEXT, c33, c34, c35, w17, w37 } from '@synthetos/safety';
import { signalText } from '../../shell/signal.ts';
import { toolStore } from '../library.ts';
import type { WorkspaceModel } from '../model.ts';
import { ConfirmCard } from '../ui.ts';
import { jobUi } from '../jobUi.ts';
import type { StopHooks } from './JobStatusCard.ts';
import { pressHandlers } from '../pressAction.ts';

export { JobStatus, type StopHooks } from './JobStatusCard.ts';

function toolName(n: number | null): string {
  if (n === null) return 'the next tool';
  const t = toolStore.value.value.find((x) => x.number === n);
  return t === undefined ? `T${n} (not in your library)` : `T${n}, ${toolDisplayName(t.tool)} (${t.tool.geometry.diameter} mm)`;
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
        h('button', { type: 'button', class: 'small danger', 'data-machine-control': 'job-stop', ...(onStopJob === undefined ? { disabled: true } : pressHandlers('job-stop', onStopJob)) }, STOP_TEXT.stopJob),
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
        h('button', { type: 'button', class: 'small danger', 'data-machine-control': 'job-stop', ...(onStopJob === undefined ? { disabled: true } : pressHandlers('job-stop', onStopJob)) }, STOP_TEXT.stopJob),
      ),
      note === null ? null : h('p', { class: 'unavailable', role: 'status' }, note),
    );
  }
  return null;
}
