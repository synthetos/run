/**
 * Analyze (docs/design/ANALYZE.md slice 1): explain the open job before asking anything. Summary (time at
 * programmed speeds, distances, lines, stops), where it slows (linked to the toolpath and lines in Job), and cutting
 * advice that asks only the next question it needs. Advanced adds the motion settings with their sources, every
 * region, the line-density histogram, speed comparisons and the AI demonstration.
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
import type { WorkspaceModel } from '../model.ts';
import { AdviceCard } from './analyze/AdviceCard.ts';
import { DetailsCard } from './analyze/DetailsCard.ts';
import { RegionsCard } from './analyze/RegionsCard.ts';
import { SummaryCard } from './analyze/SummaryCard.ts';

export function AnalyzeView({ model = null }: { readonly model?: WorkspaceModel | null }): ComponentChild {
  const live = model?.live.value ?? null;
  // A connected board's settings are kept as "Last read …" for when it is not connected.
  useEffect(() => rememberReading(boardReading(live, Date.now())), [live?.readout.settings, live?.message?.snapshot?.live.unit]);
  const file = currentFile.value;
  const report = programReport.value;
  const advanced = uiLevel.value.value === 'advanced';
  const view = report === null ? null : motionView(report, inputSources(live, Date.now()));
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
            { class: 'analyze-grid' },
            h(SummaryCard, { view }),
            h(RegionsCard, { report: view.report, advanced }),
            h(AdviceCard, { rows: advisorRows.value, stock: advisorStock.value, problem: advisorOperations.value.problem, advanced }),
            advanced ? h(DetailsCard, { view }) : null,
          ),
    ),
  );
}
