/**
 * Analyze → the headline (docs/design/ANALYZE.md §3): the time, one short line under it with a (?) for how it was
 * found, the facts as numbers, and the file's coverage limits when there are any. Words in headlineText.ts.
 */
import { h, type ComponentChild } from 'preact';
import type { Estimate } from '@synthetos/advisor';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import type { MotionView } from '../../analysisState.ts';
import { chips, headline, helpLines, subLine } from './headlineText.ts';

export interface HeadlineProps {
  readonly view: MotionView;
  readonly connected: boolean;
  /** The firmware time model's estimate, or null (settings not known, or still running). */
  readonly estimate?: Estimate | null;
  /** Where the settings come from ("Board settings", "Last read …"). */
  readonly settingsLabel?: string | null;
  /** True when the machine's planner settings are known (an estimate is coming or here). */
  readonly modelled?: boolean;
  /** True when some machine settings were read (live or saved). */
  readonly reading?: boolean;
}

export function HeadlineStrip({ view, connected, estimate = null, settingsLabel = null, modelled = false, reading = false }: HeadlineProps): ComponentChild {
  const r = view.report;
  const sub = subLine({ estimate, modelled, connected, reading });
  return h(
    'section',
    { class: 'panel analyze-strip', 'data-analyze': 'summary', 'aria-labelledby': 'analyze-time' },
    h('h2', { id: 'analyze-time', class: 'analyze-headline', 'data-analyze': 'time' }, headline(view, estimate)),
    h(
      'p',
      { class: 'analyze-strip-sub' },
      h('span', { 'data-analyze': sub.kind }, sub.text),
      ' ',
      h(ContextHelp, { id: 'analyze-time-help', label: 'How this time is found', below: true }, helpLines(view, estimate, settingsLabel).map((line) => h('span', { class: 'help-line', key: line, 'data-analyze': 'help-line' }, line))),
    ),
    h('ul', { class: 'analyze-chips' }, chips(view).map((c) => h('li', { key: c.fact, 'data-fact': c.fact }, c.text))),
    r.coverage.reasons.length === 0 ? null : h('p', { class: 'fine warn-text', 'data-analyze': 'coverage' }, r.coverage.reasons.join(' ')),
  );
}
