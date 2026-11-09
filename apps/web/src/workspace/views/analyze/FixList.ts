/**
 * Analyze → What to fix (docs/design/ANALYZE.md §3, slice 1): at most three findings in Simple, ranked, each with
 * what it means, what to do, and two links: "Show on toolpath" (Job, the lines highlighted in 3D) and "Go to line"
 * (Job, the G-code list at that line). Advanced lists the rest and, collapsed, every dense section.
 */
import { h, type ComponentChild } from 'preact';
import type { ProgramReport } from '@synthetos/advisor';
import { goToLine, showOnToolpath } from '../../analysisState.ts';
import { fixesFor, type Fix } from './findings.ts';
import { lineRange, plural, shortMm, time, whole } from './format.ts';

const SIMPLE_COUNT = 3;

function FixCard({ fix, advanced }: { readonly fix: Fix; readonly advanced: boolean }): ComponentChild {
  return h(
    'li',
    { class: 'analyze-fix', 'data-fix': fix.kind },
    h('h3', null, fix.title),
    fix.meaning.map((m) => h('p', { key: m }, m)),
    h('div', { class: 'analyze-todo' }, h('strong', null, 'What to do'), fix.todo.map((t) => h('p', { key: t }, t))),
    h(
      'div',
      { class: 'analyze-links' },
      h('button', { type: 'button', class: 'small', 'data-action': 'show-on-toolpath', 'data-from-line': String(fix.line), onClick: () => showOnToolpath(fix.fromSent, fix.toSent) }, 'Show on toolpath'),
      h('button', { type: 'button', class: 'small quiet', 'data-action': 'go-to-line', 'data-line': String(fix.line), onClick: () => goToLine(fix.lineSent) }, `Go to line ${whole(fix.line)}`),
    ),
    advanced && fix.regions.length > 1
      ? h(
          'details',
          { class: 'analyze-sections' },
          h('summary', null, `${plural(fix.regions.length, 'dense section', 'dense sections')}`),
          h('ul', null, fix.regions.map((r) => h('li', { key: r.id }, h('button', { type: 'button', class: 'linklike', 'data-action': 'show-section', onClick: () => showOnToolpath(r.fromSent, r.toSent) }, lineRange(r.fromLine, r.toLine)), `: ${plural(r.lines, 'move', 'moves')}, about ${shortMm(r.meanMoveMm)} each, ${time(r.seconds)} at ${whole(r.feed)} mm/min. Needs about ${whole(r.linesPerSecond)} lines/s.`))),
        )
      : null,
  );
}

export function FixList({ report, cam, advanced }: { readonly report: ProgramReport; readonly cam: string | null; readonly advanced: boolean }): ComponentChild {
  const fixes = fixesFor(report, cam);
  const shown = advanced ? fixes : fixes.slice(0, SIMPLE_COUNT);
  return h(
    'section',
    { class: 'panel analyze-fixes', 'data-analyze': 'fixes', 'aria-labelledby': 'analyze-fixes-title' },
    h('h2', { id: 'analyze-fixes-title' }, 'What to fix'),
    shown.length === 0
      ? h('p', { class: 'fine', 'data-analyze': 'no-fixes' }, 'Nothing stands out. The moves are long enough, and no stretch is unusually slow.')
      : h('ul', { class: 'analyze-fix-list' }, shown.map((f) => h(FixCard, { fix: f, advanced, key: f.id }))),
    fixes.length > shown.length ? h('p', { class: 'fine' }, `${plural(fixes.length - shown.length, 'more finding', 'more findings')} in Advanced.`) : null,
  );
}
