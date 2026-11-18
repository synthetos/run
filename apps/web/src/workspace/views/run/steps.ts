import { h, type ComponentChild } from 'preact';
import { useMemo } from 'preact/hooks';
import type { PreviewResult } from '../../../gcode-worker/pipeline.ts';
import { type PreviewParts } from '../../../preview/PreviewPanel.ts';
import { AnalysisWarning } from '../../../preview/ViewerOptions.ts';
import { activeJob, type Job } from '../../jobModel.ts';
import { jobUi, PHASE_TEXT, type JobUi } from '../../jobUi.ts';
import { JOB_STEPS, jobStep } from '../../jobWorkflow.ts';
import { type WorkspaceModel } from '../../model.ts';
import { placeTravelText } from '../../placeTravel.ts';
import { RunPanel } from '../../run/RunPanel.ts';
import { fileFacts, type FileFacts } from '../../samples.ts';
import { JobStatus, type StopHooks } from '../JobViews.ts';
import { JobSetupPanel } from '../SetupView.ts';
import { JobFileBlock } from './fileBlock.ts';
import { jobChecks, JobDetails } from './fileDetails.ts';

export function stepStatus(step: typeof JOB_STEPS[number]['id'], parts: PreviewParts, model: WorkspaceModel | null): string {
  const job = activeJob.value;
  const result = parts.state.status === 'ready' ? parts.state.result : null;
  const ui = jobUi(model?.live.value ?? null);
  switch (step) {
    case 'machine': return job?.machine?.name ?? 'Choose machine';
    case 'stock': return job === null ? 'Define stock' : `${job.setup.stock.width} × ${job.setup.stock.depth} × ${job.setup.stock.thickness} mm`;
    case 'place': return placementStatus({ job });
    case 'check': return checkStatus({ result });
    case 'run': return executionStatus({ ui });
  }
}

function executionStatus({ ui }: { readonly ui: JobUi }): string {
  return ui.active ? PHASE_LABEL(ui.job?.phase ?? 'running') : ui.connected ? 'Review & start' : 'Connect machine';
}

function checkStatus({ result }: { readonly result: PreviewResult | null }): string {
  return result === null ? 'Review the safety verdict' : result.summary.blocked ? 'Blocked' : result.summary.counts.warn > 0 ? 'Review findings' : 'File checked';
}

function placementStatus({ job }: { readonly job: Job | null }): string {
  return job === null ? 'Choose datum' : job.placement.zeroFrom === 'machine' ? 'machine’s work zero' : `${job.placement.datum.corner.replaceAll('-', ' ')} · ${job.placement.datum.height}`;
}

export function JobWorkPanel({ parts, model, stops, onView }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly stops: StopHooks; readonly onView: (view: string) => void }): ComponentChild {
  const step = jobStep.value;
  const result = parts.state.status === 'ready' ? parts.state.result : null;
  const facts = useMemo(() => result === null ? null : fileFacts(result.bytes), [result]);
  const ui = jobUi(model?.live.value ?? null);
  const index = JOB_STEPS.findIndex((s) => s.id === step);
  return h('aside', { class: 'job-work-panel', id: 'job-work-panel', 'aria-label': 'Job preparation' },
    // The Run step is a column (owner, 2026-11-09): its list on top, the one tick and Start fixed under it, never scrolled away.
    h('div', { class: `job-panel-scroll${step === 'run' && !ui.active ? ' run-mode' : ''}`, tabindex: 0 },
      // Step 3 opens the file (spec §7): the block is in the tree on every step, hidden, so the viewer's prompt can click its picker.
      h(JobFileBlock, { parts, model, step }),
      h(JobSetupPanel, { step, locked: ui.active, onView, travel: placeTravelText({ connected: ui.connected, homed: ui.snapshot?.live.home === 1, travel: ui.job?.report?.travel }) }),
      fileCheckPanel({ step, ui, result, facts, onView }),
      h('section', { hidden: step !== 'run', 'data-job-panel': 'run' }, h('h2', null, ui.active ? 'Run job' : 'Ready to start?'),
        h(RunPanel, { parts, model, onAnalyze: () => onView('analyze') }),
        h(JobStatus, { model, ...stops }))),
    // On the Run step its own footer carries Back beside Start (RunPanel.ts), so nothing pushes Start out of view.
    step === 'run' && !ui.active ? null : stepActions({ index }));
}

function stepActions({ index }: { readonly index: number }): ComponentChild {
  return h('div', { class: 'job-step-actions' },
    index === 0 ? null : h('button', { type: 'button', class: 'small', 'data-action': 'job-step-back', onClick: () => { jobStep.value = JOB_STEPS[index - 1]?.id ?? 'machine'; } }, 'Back'),
    index === JOB_STEPS.length - 1 ? null : h('button', { type: 'button', class: 'small primary', 'data-action': 'job-step-next', onClick: () => { jobStep.value = JOB_STEPS[index + 1]?.id ?? 'run'; } }, `Next: ${JOB_STEPS[index + 1]?.label ?? 'Run'}`));
}

function fileCheckPanel({ step, ui, result, facts, onView }: { readonly step: string; readonly ui: JobUi; readonly result: PreviewResult | null; readonly facts: FileFacts | null; readonly onView: (view: string) => void }): ComponentChild {
  return h('section', { hidden: step !== 'check', 'data-job-panel': 'check' }, h('h2', null, 'Check file'),
    h(AnalysisWarning, { connected: ui.connected, dialect: ui.snapshot?.classification?.dialectId }),
    result === null || facts === null ? h('p', null, 'Open G-code to check it.') : [
      h('ul', { class: 'job-checks', 'data-preview': 'summary', 'aria-label': 'The file check' }, jobChecks(result, facts)),
      h('details', null, h('summary', null, 'File details'), h(JobDetails, { result, facts })),
    ],
    h('button', { type: 'button', class: 'small', 'data-action': 'advisor-open', onClick: () => onView('analyze') }, 'Analyze feeds & speeds'),
    h('p', { class: 'fine' }, ui.connected ? 'Review the live board check in Run.' : 'Connect for the live board check.'));
}

export const PHASE_LABEL = (phase: string): string => PHASE_TEXT[phase] ?? phase;
