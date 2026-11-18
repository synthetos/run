/**
 * The job's file, at step 3 "Open & place job" (spec 2026-11-16 §7). The top "No file open" bar that used to carry
 * these controls is gone; this block keeps what worked: the file's name and lines, the picker (which the viewer's
 * "Open a file" prompt clicks by its `data-preview="file"`), Close job, and Save to project for a draft. It stays in
 * the tree on every step, hidden, so the picker is always there to click.
 */
import { h, type ComponentChild } from 'preact';
import { useState, type Dispatch, type StateUpdater } from 'preact/hooks';
import type { PreviewResult } from '../../../gcode-worker/pipeline.ts';
import { type PreviewParts } from '../../../preview/PreviewPanel.ts';
import { on, type PreviewViewActions, type PreviewViewState } from '../../../preview/PreviewView.ts';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import { closeJob, executionLock, pendingOpen, reopening } from '../../fileBridge.ts';
import { Icon } from '../../icons.ts';
import { activeJob } from '../../jobModel.ts';
import { jobUi } from '../../jobUi.ts';
import { jobStep, type JobStep } from '../../jobWorkflow.ts';
import { type WorkspaceModel } from '../../model.ts';
import { num } from '../../status.ts';
import { openFrom } from '../openRunFile.ts';
import { JobProjectLine } from './projectLine.ts';

type Note = Dispatch<StateUpdater<string | null>>;

export function JobFileBlock({ parts, model, step }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly step: JobStep }): ComponentChild {
  const { state, actions } = parts;
  const loading = state.status === 'loading';
  const locked = jobUi(model?.live.value ?? null).active;
  const disabled = !state.ready || loading || locked;
  const result = state.status === 'ready' ? state.result : null;
  const [note, setNote] = useState<string | null>(null);
  return h(
    'section',
    { class: 'job-file-block', hidden: step !== 'place', 'data-job-panel': 'file', 'data-region': 'job' },
    h('h2', null, 'File'),
    fileLine({ state, loading, result }),
    h(
      'div',
      { class: 'job-file-actions' },
      picker({ actions, disabled, result, setNote }),
      state.fileName === null ? null : closeButton({ actions, locked, setNote }),
      executionLock.value === null ? null : h(ContextHelp, { id: 'job-file-lock-help', label: 'Why closing or replacing the job is unavailable' }, `${executionLock.value} Stop the current job before closing it or opening another file.`),
    ),
    h(JobProjectLine, { job: activeJob.value, fileOpen: result !== null, onNote: setNote }),
    note === null ? null : h('p', { class: 'fine tone-warn', role: 'status', 'data-job': 'note' }, note),
  );
}

function fileLine({ state, loading, result }: { readonly state: PreviewViewState; readonly loading: boolean; readonly result: PreviewResult | null }): ComponentChild {
  const open = state.fileName !== null;
  return h(
    'p',
    { class: 'job-file-line' },
    h('span', { class: open ? 'mono' : 'sr-only', 'data-preview': 'file-name' }, state.fileName ?? 'none'),
    !open
      ? (loading ? 'Checking the file…' : reopening.value || pendingOpen.value !== null ? 'Opening the file…' : 'Open a G-code file, or a sample from the drawing.')
      : result === null ? (loading ? ' · checking…' : '') : ` · ${num(result.fileLines)} lines`,
  );
}

function picker({ actions, disabled, result, setNote }: { readonly actions: PreviewViewActions; readonly disabled: boolean; readonly result: PreviewResult | null; readonly setNote: Note }): ComponentChild {
  return h(
    'label',
    { class: `file-button${disabled ? ' is-disabled' : ''}` },
    h('input', {
      type: 'file',
      accept: '.nc,.gcode,.ngc,.tap,.txt,.cnc,text/plain',
      disabled,
      'data-preview': 'file',
      ...on('onChange', actions.onFile, () => (e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file !== undefined) openFrom(file, { kind: 'picker' }, setNote);
        input.value = '';
      }),
    }),
    Icon('upload', 15),
    result === null ? 'Open a file' : 'Open another',
  );
}

function closeButton({ actions, locked, setNote }: { readonly actions: PreviewViewActions; readonly locked: boolean; readonly setNote: Note }): ComponentChild {
  return h('button', {
    type: 'button', class: 'small', 'data-action': 'job-close', disabled: locked || actions.onCancel === undefined, onClick: () => {
      const result = closeJob();
      if (!result.ok) { setNote(result.reason); return; }
      actions.onCancel?.();
      setNote(null);
      jobStep.value = 'machine';
    },
  }, 'Close job');
}
