/**
 * Analyze → the headline (docs/design/ANALYZE.md §3, slice 1). The cutting time at programmed speeds is a lower
 * bound: the board never runs a feed move faster than its programmed feed, so real time is longer. Then the stops,
 * the rapids and the size of the file, in short words, and one line on how to improve the estimate.
 */
import { h, type ComponentChild } from 'preact';
import type { MotionView } from '../../analysisState.ts';
import { mm, plural, time, whole } from './format.ts';

export function headline(view: MotionView): string {
  const s = view.time.feedSeconds.value;
  return s === null ? 'Cutting time not known' : `At least ${time(s)} of cutting`;
}

export function stopsLine(changes: number, pauses: number): string | null {
  if (changes === 0 && pauses === 0) return null;
  const parts = [changes > 0 ? plural(changes, 'tool change', 'tool changes') : null, pauses > 0 ? plural(pauses, 'pause', 'pauses') : null].filter((p): p is string => p !== null);
  return `Plus ${parts.join(' and ')}.`;
}

export function rapidsLine(view: MotionView): string {
  const r = view.report;
  const t = view.time.rapidSeconds;
  if (r.rapidDeltas.length === 0 && r.untimedRapids === 0) return 'No rapids.';
  return t.value === null ? `Rapids: ${mm(r.rapidMm.value ?? 0)}, not timed yet.` : `Rapids: ${mm(r.rapidMm.value ?? 0)}, about ${time(t.value)} (${t.label}).`;
}

export function HeadlineStrip({ view, connected }: { readonly view: MotionView; readonly connected: boolean }): ComponentChild {
  const r = view.report;
  const stops = stopsLine(r.toolChangeLines.length, r.stopLines.length);
  const untimed = view.time.feedSeconds.value === null;
  return h(
    'section',
    { class: 'panel analyze-strip', 'data-analyze': 'summary', 'aria-labelledby': 'analyze-time' },
    h('h2', { id: 'analyze-time', class: 'analyze-headline', 'data-analyze': 'time' }, headline(view)),
    h('p', { class: 'analyze-strip-sub' }, untimed ? `${plural(r.untimedMoves, 'feed move has', 'feed moves have')} no feed rate.` : 'Real time will be longer.', stops === null ? '' : ` ${stops}`, r.dwells === 0 ? '' : ` ${plural(r.dwells, 'dwell adds', 'dwells add')} ${time(r.dwellSeconds.value ?? 0)}.`),
    h(
      'ul',
      { class: 'analyze-chips' },
      h('li', { 'data-fact': 'feed-mm' }, `${mm(r.feedMm.value ?? 0)} of cutting`),
      h('li', { 'data-fact': 'rapid-time' }, rapidsLine(view)),
      h('li', { 'data-fact': 'lines' }, `${whole(r.lines)} lines`),
    ),
    view.time.rapidSeconds.value === null && !connected && r.rapidDeltas.length > 0 ? h('p', { class: 'fine', 'data-analyze': 'missing' }, "Connect to read your machine's speeds. The time estimate will improve.") : null,
    r.coverage.reasons.length === 0 ? null : h('p', { class: 'fine warn-text', 'data-analyze': 'coverage' }, r.coverage.reasons.join(' ')),
  );
}
