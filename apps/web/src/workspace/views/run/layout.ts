import type { ViewPreset } from '@synthetos/gcode-view';
import { w13 } from '@synthetos/safety';
import { h, type ComponentChild } from 'preact';
import { useEffect, useState, type Dispatch, type StateUpdater } from 'preact/hooks';
import type { FileTool } from '../../../gcode-worker/camTools.ts';
import type { PreviewResult } from '../../../gcode-worker/pipeline.ts';
import { ExpandButton, previewExpanded } from '../../../preview/expandPreview.ts';
import { PlayControls, PlayNotice } from '../../../preview/PlayControls.ts';
import { type PreviewParts } from '../../../preview/PreviewPanel.ts';
import { on, progressText, type PreviewSlots, type PreviewViewActions, type PreviewViewState } from '../../../preview/PreviewView.ts';
import type { JobScene } from '../../../preview/sceneModel.ts';
import { openSceneSettings, type ScenePart } from '../../../preview/sceneSettings.ts';
import { ViewButtons } from '../../../preview/SceneView.ts';
import { ViewerOptions } from '../../../preview/ViewerOptions.ts';
import type { ViewerOverlayProps } from '../../../preview/ViewerOverlay.ts';
import { ViewerOverlay } from '../../../preview/ViewerOverlay.ts';
import { JobFiles } from '../../../projects/ProjectsView.ts';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import { Dock } from '../../dock/Dock.ts';
import { pendingOpen, reopening } from '../../fileBridge.ts';
import { feedDiagnosis, jobUi } from '../../jobUi.ts';
import { JOB_STEPS, jobStep, uiLevel } from '../../jobWorkflow.ts';
import { type WorkspaceModel } from '../../model.ts';
import { sampleFile, SAMPLES } from '../../samples.ts';
import { ToolMismatchNotes } from '../../ToolMismatchNotes.ts';
import { openToolNumber } from '../../toolNumbers.ts';
import { type StopHooks } from '../JobViews.ts';
import { openFrom } from '../openRunFile.ts';
import { OverrideControls } from '../OverrideControls.ts';
import { RunBridge } from './bridge.ts';
import { JobCard } from './fileCard.ts';
import { RunInspector } from './inspector.ts';
import { JobWorkPanel, stepStatus } from './steps.ts';
import { TraverseToggle } from './traverses.ts';

/** No file, no described tools (one array, so the note's memo holds). */
const NO_FILE_TOOLS: readonly FileTool[] = Object.freeze([]);

export function runLayout(parts: PreviewParts, model: WorkspaceModel | null, onView: (view: string) => void, stops: StopHooks = {}): ComponentChild {
  return h(RunLayout, { parts, model, onView, stops });
}

function RunLayout({ parts, model, onView, stops }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly onView: (view: string) => void; readonly stops: StopHooks }): ComponentChild {
  const { state, actions, slots, scene } = parts;
  const simple = uiLevel.value.value !== 'advanced';
  const [preset, setPreset] = useState<ViewPreset>('iso');
  const [files, setFiles] = useState(false);
  const step = jobStep.value;
  const active = jobUi(model?.live.value ?? null).active;
  useEffect(() => { if (active) jobStep.value = 'run'; }, [active]);
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading || jobUi(model?.live.value ?? null).active;
  const result = state.status === 'ready' ? state.result : null;
  const { sent, scrubLine } = scrubPosition({ result, state });
  return h(
    'div',
    { class: 'run-view job-view', 'data-region': 'preview', 'data-job-stage': step, 'data-preview-expanded': previewExpanded.value ? 'true' : 'false' },
    h(RunBridge, { parts }),
    // The file's tools against the tool table (tool-mismatch): a note, its actions and their confirmation.
    h(ToolMismatchNotes, { fileTools: result?.fileTools ?? NO_FILE_TOOLS, onView }),
    // The machine pane is a rail beside everything (OD-13 §3): it gets the view's full height, so it fits 720 px without scrolling.
    h(
      'div',
      { class: 'job-main' },
      h('div', null, h(JobCard, { parts, model, onView, onFiles: () => setFiles(!files) }), h(OverrideControls, { model })),
      h('nav', { class: 'job-step-bar', 'aria-label': 'Job steps' }, JOB_STEPS.map((item, i) => h('button', { type: 'button', key: item.id, 'data-action': `job-step-${item.id}`, 'data-job-step': item.id, 'aria-current': step === item.id ? 'step' : undefined, 'aria-controls': 'job-work-panel', onClick: () => { jobStep.value = item.id; } }, h('span', { class: 'step-number' }, String(i + 1)), h('span', null, h('strong', null, item.label), h('small', null, stepStatus(item.id, parts, model)))))),
      h('div', { class: 'job-files-drawer', hidden: !files, 'aria-label': 'Job files' }, files ? h(JobFiles, { onView: (view) => { if (view === 'job') setFiles(false); onView(view); } }) : null, h('button', { type: 'button', class: 'small', 'data-action': 'job-files-close', onClick: () => setFiles(false) }, 'Close files')),
      h(
        'div',
        { class: 'workspace-grid run-grid job-grid' },
        h(JobWorkPanel, { parts, model, stops, onView }),
        h(
          'div',
          { class: 'canvas-column' },
          previewViewer({ result, scene, state, parts, slots, simple, disabled, preset, actions, setPreset, model, active, onView, loading, step }),
          previewTimeline({ parts, sent, state, result, scrubLine, actions }),
          h(Dock, { parts, model, stops }),
        ),
      ),
    ),
    h(RunInspector, { model, stops, fileTool: parts.tool?.number ?? null }),
  );
}

function scrubPosition({ result, state }: { readonly result: PreviewResult | null; readonly state: PreviewViewState }) {
  const sent = result?.sourceLines.length ?? 0;
  const scrubLine = state.scrub > 0 && result !== null ? (result.sourceLines[state.scrub - 1] ?? 0) : 0;
  return { sent, scrubLine };
}

function previewViewer({ result, scene, state, parts, slots, simple, disabled, preset, actions, setPreset, model, active, onView, loading, step }: { readonly result: PreviewResult | null; readonly scene: JobScene | null; readonly state: PreviewViewState; readonly parts: PreviewParts; readonly slots: PreviewSlots; readonly simple: boolean; readonly disabled: boolean; readonly preset: ViewPreset; readonly actions: PreviewViewActions; readonly setPreset: Dispatch<StateUpdater<ViewPreset>>; readonly model: WorkspaceModel | null; readonly active: boolean; readonly onView: (view: string) => void; readonly loading: boolean; readonly step: string }): ComponentChild {
  return h(
    'div',
    { class: 'viewer', ...(result === null ? {} : { 'data-lite': result.lite ? 'true' : 'false' }) },
    (scene !== null || result !== null) && !result?.lite ? h('div', { class: 'preview-drawing', 'data-preview': 'drawing', 'data-drawing': state.drawing, 'data-tool': parts.toolInPath?.map((v) => v.toFixed(3)).join(' ') }, slots.drawing ?? null) : null,
    viewerToolbar({ simple, parts, disabled, scene, result, state, preset, actions, setPreset }),
    // The viewer's bar (settings menu, position chip, notes) and the legend; the live position is in the Position panel.
    viewerOverlay({ parts, scene, result, simple, model, active, onView, loading, state, step, disabled, actions }),
    loading
      ? h(
        'div',
        { class: 'empty-prompt preview-progress', role: 'status', 'data-preview': 'progress' },
        h('h2', null, progressText(state.progress)),
        h('button', { type: 'button', class: 'small', 'data-preview': 'cancel', ...on('onClick', actions.onCancel, (f) => () => { f(); }) }, 'Cancel')
      )
      : null,
    h('div', { class: 'viewer-notice viewer-help' }, h(ContextHelp, { id: 'run-preview-help', label: 'About the preview', safety: 'W13', end: true }, w13()))
  );
}

function viewerOverlay({ parts, scene, result, simple, model, active, onView, loading, state, step, disabled, actions }: { readonly parts: PreviewParts; readonly scene: JobScene | null; readonly result: PreviewResult | null; readonly simple: boolean; readonly model: WorkspaceModel | null; readonly active: boolean; readonly onView: (view: string) => void; readonly loading: boolean; readonly state: PreviewViewState; readonly step: string; readonly disabled: boolean; readonly actions: PreviewViewActions }): ComponentChild {
  return h(ViewerOverlay, overlayProps({ parts, scene, result, simple, model, active, onView, loading, state, step, disabled, actions }));
}

function overlayProps({ parts, scene, result, simple, model, active, onView, loading, state, step, disabled, actions }: { readonly parts: PreviewParts; readonly scene: JobScene | null; readonly result: PreviewResult | null; readonly simple: boolean; readonly model: WorkspaceModel | null; readonly active: boolean; readonly onView: (view: string) => void; readonly loading: boolean; readonly state: PreviewViewState; readonly step: string; readonly disabled: boolean; readonly actions: PreviewViewActions }): ViewerOverlayProps {
  return {
    // Play preview's notice stays in view for the whole session (OD-25).
    notice: h(PlayNotice, { play: parts.play }),
    sceneKey: (scene === null && parts.tool === null) || result?.lite ? null : { scene, tool: parts.tool, markerPreview: parts.markerPreview, carve: parts.carve, simple, tools: parts.tools, planner: parts.planner !== null, starved: parts.starved, feedDiagnosis: jobUi(model?.live.value ?? null).job?.phase === 'running' ? feedDiagnosis(jobUi(model?.live.value ?? null).job?.feedLimit ?? null) : null, spin: parts.spin, ...(active ? {} : { onOpen: (part: ScenePart) => openSceneSettings(part, onView), onAddTool: (n: number) => { openToolNumber(n); onView('tools'); } }) },
    // With no file open, the prompt to open one leads the stack, so the key never covers its buttons. While the
    // job's file is being reopened after a reload (or a chosen file waits for the preview), it says so instead of
    // offering the samples for a moment.
    prompt: viewerPrompt({ result, loading, scene, state, step, disabled, actions }),
  };
}

function viewerPrompt({ result, loading, scene, state, step, disabled, actions }: { readonly result: PreviewResult | null; readonly loading: boolean; readonly scene: JobScene | null; readonly state: PreviewViewState; readonly step: string; readonly disabled: boolean; readonly actions: PreviewViewActions }): ComponentChild {
  return result === null && !loading && fileReopening()
    ? reopeningPrompt({ scene })
    : result === null && !loading && state.status !== 'error' && (step === 'machine' || step === 'stock')
      ? h('button', { type: 'button', class: 'small viewer-step-chip', 'data-action': 'job-step-place', onClick: () => { jobStep.value = 'place'; } }, 'Step 3 opens your file.')
      : result === null && !loading
        ? h(
          'div',
          { class: `empty-prompt${scene === null ? '' : ' scene-empty-prompt'}` },
          h('h2', null, state.status === 'error' ? 'The file could not be checked' : 'Open a file to check and preview it'),
          h('button', { type: 'button', class: 'primary', disabled, 'data-action': 'job-open-file', onClick: () => document.querySelector<HTMLInputElement>('[data-preview="file"]')?.click() }, 'Open a file'),
          state.status === 'error'
            ? h('p', { class: 'preview-error', role: 'alert', 'data-preview': 'error' }, state.error ?? 'The preview failed.')
            : null,
          h('div', { class: 'sample-row' }, SAMPLES.map((s) => h('button', { type: 'button', class: 'small', key: s.id, disabled, 'data-sample': s.id, ...on('onClick', actions.onFile, () => () => { openFrom(sampleFile(s), { kind: 'sample' }, () => undefined); }) }, `Open the ${s.title.toLowerCase()} sample`)))
        )
        : null;
}

function reopeningPrompt({ scene }: { readonly scene: JobScene | null }): ComponentChild {
  return h('div', { class: `empty-prompt${scene === null ? '' : ' scene-empty-prompt'}`, 'data-preview': 'reopening' }, h('h2', null, 'Opening the file…'));
}

function viewerToolbar({ simple, parts, disabled, scene, result, state, preset, actions, setPreset }: { readonly simple: boolean; readonly parts: PreviewParts; readonly disabled: boolean; readonly scene: JobScene | null; readonly result: PreviewResult | null; readonly state: PreviewViewState; readonly preset: ViewPreset; readonly actions: PreviewViewActions; readonly setPreset: Dispatch<StateUpdater<ViewPreset>> }): ComponentChild {
  return h(
    'div',
    { class: 'viewer-top' },
    // How the file is read and drawn: Advanced only (Simple keeps the defaults, Auto included), in plain words.
    simple ? null : h(ViewerOptions, { parts, disabled }),
    h(
      'div',
      { class: 'viewer-tools', role: 'group', 'aria-label': 'View' },
      h(TraverseToggle, { parts }),
      h(ExpandButton, null),
      (scene !== null || result !== null) && !result?.lite && state.drawing === 'webgl' ? h(ViewButtons, { current: preset, ...(actions.onView === undefined ? {} : { onView: (p: ViewPreset) => { setPreset(p); actions.onView?.(p); } }), ...(actions.onFit === undefined ? {} : { onFit: () => actions.onFit?.() }) }) : null
    )
  );
}

function previewTimeline({ parts, sent, state, result, scrubLine, actions }: { readonly parts: PreviewParts; readonly sent: number; readonly state: PreviewViewState; readonly result: PreviewResult | null; readonly scrubLine: number; readonly actions: PreviewViewActions }): ComponentChild {
  return h(
    'div',
    { class: 'timeline', 'aria-label': 'Line scrubber' },
    h(PlayControls, { play: parts.play }),
    h(
      'div',
      { class: 'track-wrap' },
      h('label', { class: 'sr-only', for: 'preview-scrub' }, 'Highlight lines up to'),
      h('input', {
        id: 'preview-scrub',
        type: 'range',
        min: 0,
        max: sent,
        step: 1,
        value: state.scrub,
        disabled: result === null,
        'data-preview': 'scrubber',
        'aria-valuetext': state.scrub === 0 ? 'no lines highlighted' : `highlighting up to file line ${String(scrubLine)}`,
        ...on('onInput', actions.onScrub, (f) => (e: Event) => { f(Number((e.currentTarget as HTMLInputElement).value)); }),
      })
    ),
    h('output', { class: 'time', for: 'preview-scrub', 'data-preview': 'scrub-line' }, state.scrub === 0 ? 'none' : `file line ${String(scrubLine)}`)
  );
}

function fileReopening(): boolean {
  return reopening.value || pendingOpen.value !== null;
}
