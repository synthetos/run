/**
 * Analyze (docs/design/ANALYZE.md slice 1): explain the open job before asking anything. A headline (at least
 * how long the cutting takes at programmed speeds, the stops, the rapids), "What to fix" (each finding with what it
 * means, what to do, and links to the toolpath and the line in Job), then the operations with the cutting check, one
 * question at a time. Advanced adds every finding, the dense sections, the machine speeds with their source, the
 * move-rate histogram and the speed comparison.
 *
 * Review only: nothing here changes the file, the machine or the Job checks, and Pause and Stop never wait on it.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect } from 'preact/hooks';
import { advisorOperations, advisorRows, advisorStock } from '../advisorState.ts';
import { boardReading } from '../analysisInputs.ts';
import { inputSources, motionView, programReport, rememberReading } from '../analysisState.ts';
import { currentFile } from '../fileBridge.ts';
import { uiLevel } from '../jobWorkflow.ts';
import { connected, type WorkspaceModel } from '../model.ts';
import { usePublishNotes } from '../notes/usePublishNotes.ts';
import { analysisNotes } from './analyze/analysisNotes.ts';
import { DetailsCard } from './analyze/DetailsCard.ts';
import { fixesFor } from './analyze/findings.ts';
import { FixList } from './analyze/FixList.ts';
import { HeadlineStrip } from './analyze/HeadlineStrip.ts';
import { OperationsCard } from './analyze/OperationsCard.ts';

export function AnalyzeView({ model = null }: { readonly model?: WorkspaceModel | null }): ComponentChild {
  const live = model?.live.value ?? null;
  // A connected board's settings are kept as "Last read …" for when it is not connected.
  useEffect(() => rememberReading(boardReading(live, Date.now())), [live?.readout.settings, live?.message?.snapshot?.live.unit]);
  const file = currentFile.value;
  const report = programReport.value;
  const advanced = uiLevel.value.value === 'advanced';
  const view = report === null ? null : motionView(report, inputSources(live, Date.now()));
  // The findings also go to the Notes tab, so the Run step can point at them without inline text.
  usePublishNotes('analyze', report === null ? [] : analysisNotes(fixesFor(report, file?.preview?.cam ?? null)));
  return h(
    'div',
    { class: 'analyze-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Analyze'), h('p', null, file?.name ?? 'Open a file in Job.'))),
    h(
      'div',
      { class: 'scroll-region analyze-scroll', tabindex: 0 },
      view === null
        ? h('div', { class: 'panel', 'data-analyze': 'empty' }, h('p', null, 'Open a file in Job to see what it does.'), h('p', { class: 'fine' }, `Stock: ${advisorStock.value?.name ?? 'not chosen'}.`))
        : h(
            'div',
            { class: 'analyze-page' },
            h(HeadlineStrip, { view, connected: live !== null && connected(live) }),
            h(FixList, { report: view.report, cam: file?.preview?.cam ?? null, advanced }),
            h(OperationsCard, { rows: advisorRows.value, stock: advisorStock.value, problem: advisorOperations.value.problem, advanced }),
            advanced ? h(DetailsCard, { view }) : null,
          ),
    ),
  );
}
