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
import { jobStep } from '../../jobWorkflow.ts';
import { type WorkspaceModel } from '../../model.ts';
import { num } from '../../status.ts';
import { openFrom } from '../openRunFile.ts';
import { JobIdentity } from './identity.ts';

/** The job: a card at the top of the Run view with the file, its checks, and the Check → Set zero → Start steps. */
export function JobCard({ parts, model, onView, onFiles }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly onView: (view: string) => void; readonly onFiles: () => void }): ComponentChild {
  const { state, actions } = parts;
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading || jobUi(model?.live.value ?? null).active;
  const result = state.status === 'ready' ? state.result : null;
  const title = state.fileName === null ? 'No file open' : state.fileName.replace(/\.[^.]+$/, '');
  const [note, setNote] = useState<string | null>(null);
  return h(
    'section',
    { class: `job-card${result === null ? ' empty' : ''}`, 'data-region': 'job', 'aria-labelledby': 'run-title' },
    fileIdentity({ title, state, loading, result, setNote, note }),
    fileActions({ onFiles, onView, state, model, actions, setNote, disabled, result }),

  );
}

function fileActions({ onFiles, onView, state, model, actions, setNote, disabled, result }: { readonly onFiles: () => void; readonly onView: (view: string) => void; readonly state: PreviewViewState; readonly model: WorkspaceModel | null; readonly actions: PreviewViewActions; readonly setNote: Dispatch<StateUpdater<string | null>>; readonly disabled: boolean; readonly result: PreviewResult | null }): ComponentChild {
  return h(
    'div',
    { class: 'job-actions' },
    h('button', { type: 'button', class: 'small', 'data-action': 'job-files', onClick: onFiles }, 'Files'),
    h('button', { type: 'button', class: 'small', 'data-action': 'job-projects', onClick: () => onView('projects') }, 'Open project'),
    state.fileName === null ? null : h('button', {
      type: 'button', class: 'small', 'data-action': 'job-close', disabled: jobUi(model?.live.value ?? null).active || actions.onCancel === undefined, onClick: () => {
        const result = closeJob();
        if (!result.ok) { setNote(result.reason); return; }
        actions.onCancel?.();
        setNote(null);
        jobStep.value = 'machine';
      }
    }, 'Close job'),
    executionLock.value === null ? null : h(ContextHelp, { id: 'job-file-lock-help', label: 'Why closing or replacing the job is unavailable' }, `${executionLock.value} Stop the current job before closing it or opening another file.`),
    h(
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
      result === null ? 'Open a file' : 'Open another'
    )
  );
}

function fileIdentity({ title, state, loading, result, setNote, note }: { readonly title: string; readonly state: PreviewViewState; readonly loading: boolean; readonly result: PreviewResult | null; readonly setNote: Dispatch<StateUpdater<string | null>>; readonly note: string | null }): ComponentChild {
  return h(
    'div',
    { class: 'job-id' },
    h('span', { class: 'job-icon', 'aria-hidden': 'true' }, Icon('file', 22)),
    h(
      'div',
      { class: 'job-name' },
      h('h1', { id: 'run-title' }, title),
      h(
        'p',
        null,
        h('span', { class: state.fileName === null ? 'sr-only' : 'mono', 'data-preview': 'file-name' }, state.fileName ?? 'none'),
        state.fileName === null ? (loading ? 'Checking the file…' : reopening.value || pendingOpen.value !== null ? 'Opening the file…' : 'Open a G-code file or a sample to check it.') : result === null ? (loading ? ' · checking…' : '') : ` · ${num(result.fileLines)} lines`
      ),
      h(JobIdentity, { job: activeJob.value, fileOpen: result !== null, onNote: setNote }),
      note === null ? null : h('p', { class: 'fine tone-warn', role: 'status', 'data-job': 'note' }, note)
    )
  );
}
