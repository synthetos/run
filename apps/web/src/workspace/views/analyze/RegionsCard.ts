/**
 * Analyze → Where it slows (docs/design/ANALYZE.md §2–3, slice 1): dense sections of many short lines, and long
 * stretches at a low programmed feed. Each one is a button that opens Job at its first line, in the toolpath and the
 * line list. Simple shows the three that take longest; Advanced shows them all with the line-density histogram.
 */
import { h, type ComponentChild } from 'preact';
import type { ProgramReport, Region } from '@synthetos/advisor';
import { showRegion, showSent } from '../../analysisState.ts';
import { plungeFindings, type PlungeFinding } from './plunges.ts';
import { lineRange, plural, shortMm, time, whole } from './format.ts';

const SIMPLE_COUNT = 3;
const ADVANCED_COUNT = 12;

/** What a region means, in short sentences, with no claim of cause. Advanced adds the lines per second it needs. */
export function regionText(r: Region, advanced = false): string {
  if (r.kind === 'slow') return `${time(r.seconds)} at ${whole(r.feed)} mm/min.`;
  const rate = advanced ? ` Needs about ${whole(r.linesPerSecond)} lines/s at the programmed feed.` : '';
  return `The machine may not reach the feed here, and the stream may not keep up. ${plural(r.lines, 'very short move', 'very short moves')}, about ${shortMm(r.meanMoveMm)} each.${rate}`;
}

/** What the user can do about it, and where. */
export function regionAdvice(r: Region): string {
  return r.kind === 'dense'
    ? 'In your CAM, allow longer moves where the shape permits: a larger tolerance, or arcs instead of short lines.'
    : 'If it should be faster, check this feed in your CAM.';
}

/** The operation a line belongs to, for the region's heading. */
function operationAt(report: ProgramReport, line: number): string | null {
  return report.operations.find((o) => o.spans.some((s) => s.fromLine <= line && line <= s.toLine))?.name ?? null;
}

function PlungeItem({ finding }: { readonly finding: PlungeFinding }): ComponentChild {
  const { operation: op, regime: r, share } = finding;
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'analyze-region', 'data-region-kind': 'plunge', 'data-action': 'show-region', 'data-from-line': String(r.firstLine), onClick: () => showSent(r.firstSent) },
      h('strong', null, `Plunges · ${op.name}`),
      h('span', null, `${plural(r.moves, 'plunge', 'plunges')} at ${r.feed === null ? 'no set feed' : `${whole(r.feed)} mm/min`} take ${time(r.seconds as number)}, ${whole(share * 100)}% of this operation. About ${shortMm(r.mm / r.moves)} each.`),
      h('span', { class: 'analyze-region-advice' }, 'In your CAM, check the plunge feed and the height plunges start from. Starting closer to the stock, or ramping in, saves time.'),
      h('span', { class: 'analyze-link' }, 'Show the first in Job'),
    ),
  );
}

/** Every region, the longest first. */
export function rankedRegions(report: ProgramReport): Region[] {
  return [...report.density.regions, ...report.slow].sort((a, b) => b.seconds - a.seconds);
}

function Histogram({ report }: { readonly report: ProgramReport }): ComponentChild {
  const most = Math.max(1, ...report.density.buckets.map((b) => b.lines));
  return h(
    'div',
    { class: 'analyze-histogram', 'data-analyze': 'histogram' },
    h('h3', null, 'Line density'),
    h(
      'table',
      { class: 'analyze-table' },
      h('caption', { class: 'fine' }, `Feed lines by how many lines per second they need. Dense from ${whole(report.density.threshold.value ?? 0)} lines/s: ${report.density.threshold.label.toLowerCase()}.`),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Lines per second'), h('th', { scope: 'col' }, 'Lines'), h('th', { scope: 'col', 'aria-hidden': 'true' }, ''))),
      h('tbody', null, report.density.buckets.map((b) => h('tr', { key: b.label }, h('th', { scope: 'row' }, b.label), h('td', { class: 'num' }, whole(b.lines)), h('td', { class: 'analyze-bar-cell', 'aria-hidden': 'true' }, h('span', { class: 'analyze-bar', style: { width: `${(b.lines / most) * 100}%` } }))))),
    ),
  );
}

export function RegionsCard({ report, advanced }: { readonly report: ProgramReport; readonly advanced: boolean }): ComponentChild {
  const plunges = plungeFindings(report);
  const all = rankedRegions(report);
  const shown = all.slice(0, Math.max(0, (advanced ? ADVANCED_COUNT : SIMPLE_COUNT) - plunges.length));
  const denseLines = report.density.regions.reduce((n, r) => n + r.lines, 0);
  const feedLines = report.density.buckets.reduce((n, b) => n + b.lines, 0);
  return h(
    'section',
    { class: 'panel analyze-card', 'data-analyze': 'regions', 'aria-labelledby': 'analyze-regions-title' },
    h('h2', { id: 'analyze-regions-title' }, 'Where it slows'),
    denseLines === 0 ? null : h('p', { class: 'fine', 'data-analyze': 'dense-share' }, `${plural(denseLines, 'feed line is', 'feed lines are')} in dense sections, of ${whole(feedLines)}.`),
    shown.length + plunges.length === 0
      ? h('p', { class: 'fine', 'data-analyze': 'no-regions' }, 'No dense or slow sections found.')
      : h(
          'ul',
          { class: 'analyze-regions' },
          plunges.map((f) => h(PlungeItem, { finding: f, key: `plunge-${f.operation.id}` })),
          shown.map((r) => {
            const op = operationAt(report, r.fromLine);
            return h(
              'li',
              { key: r.id },
              h(
                'button',
                { type: 'button', class: 'analyze-region', 'data-region-kind': r.kind, 'data-action': 'show-region', 'data-from-line': String(r.fromLine), onClick: () => showRegion(r) },
                h('strong', null, [r.kind === 'dense' ? 'Dense section' : 'Slow section', lineRange(r.fromLine, r.toLine).toLowerCase(), op].filter((p) => p !== null).join(' · ')),
                h('span', null, regionText(r, advanced)),
                h('span', { class: 'analyze-region-advice' }, regionAdvice(r)),
                h('span', { class: 'analyze-link' }, 'Show in Job'),
              ),
            );
          }),
        ),
    all.length > shown.length ? h('p', { class: 'fine' }, advanced ? `${plural(all.length - shown.length, 'smaller section', 'smaller sections')} not shown.` : `${plural(all.length - shown.length, 'more section', 'more sections')} in Advanced.`) : null,
    advanced ? h(Histogram, { report }) : null,
  );
}
