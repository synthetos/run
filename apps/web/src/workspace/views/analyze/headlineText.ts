/**
 * Analyze → the headline's words (docs/design/ANALYZE.md §3). Less is more (owner, 2026-11-10): the time, one short
 * line under it, and the facts as numbers. How the time was found goes behind the (?). Pure.
 */
import { PLANNER_BUILD, type Estimate } from '@synthetos/advisor';
import type { MotionView } from '../../analysisState.ts';
import { mm, plural, time, whole } from './format.ts';

/**
 * "About 2 h 04 min" from the firmware model. Without it, the cutting time at programmed feeds: a feed move never
 * runs faster than its feed, so this is a true lower bound, and so is the known part when some moves have no feed.
 */
export function headline(view: MotionView, estimate: Estimate | null = null): string {
  if (estimate?.ok === true) return `About ${time(estimate.seconds)}`;
  const s = view.time.feedSeconds.value ?? view.report.knownFeedSeconds;
  return s > 0 ? `At least ${time(s)}` : 'Time not known yet';
}

export type SubKind = 'estimate' | 'pending' | 'no-estimate' | 'connect' | 'reading' | 'settings';

export interface SubState {
  readonly estimate: Estimate | null;
  /** The planner settings are known (an estimate is coming or here). */
  readonly modelled: boolean;
  readonly connected: boolean;
  /** Some machine settings were read (live or saved). */
  readonly reading: boolean;
}

/** The one line under the time. */
export function subLine({ estimate, modelled, connected, reading }: SubState): { readonly kind: SubKind; readonly text: string } {
  if (estimate?.ok === true) return { kind: 'estimate', text: 'From your machine’s settings.' };
  if (estimate?.ok === false) return { kind: 'no-estimate', text: `No closer time: ${estimate.reason}.` };
  if (modelled) return { kind: 'pending', text: 'Working out a closer time…' };
  if (!connected) return { kind: 'connect', text: 'Connect to get a closer time.' };
  return reading ? { kind: 'settings', text: 'Some machine settings are missing.' } : { kind: 'reading', text: 'Reading your machine’s settings…' };
}

/** Any rapid travel (a G0 to where the tool already is moves nothing). */
const hasRapids = (view: MotionView): boolean => (view.report.rapidMm.value ?? 0) > 0 || view.report.untimedRapids > 0;

/** Behind the (?): how the time was found, or why real time is longer. One short sentence each. */
export function helpLines(view: MotionView, estimate: Estimate | null, settingsLabel: string | null): string[] {
  const r = view.report;
  const stops = r.toolChangeLines.length + r.stopLines.length > 0 ? 'Tool changes and pauses aren’t counted.' : null;
  if (estimate?.ok === true) {
    return [`Timed with the firmware’s planner (TinyG ${PLANNER_BUILD.fb}).`, settingsLabel === null ? null : `Settings: ${settingsLabel}.`, stops].filter((s): s is string => s !== null);
  }
  const out = ['Real time is longer.'];
  if (r.untimedMoves > 0) out.push(`${plural(r.untimedMoves, 'feed move has', 'feed moves have')} no feed rate.`);
  if (hasRapids(view)) out.push(view.time.rapidSeconds.value === null ? 'Rapids aren’t timed yet.' : `Rapids add about ${time(view.time.rapidSeconds.value)} (${view.time.rapidSeconds.label}).`);
  out.push('The machine slows for short moves and corners.');
  if (r.dwells > 0) out.push(`${plural(r.dwells, 'dwell adds', 'dwells add')} ${time(r.dwellSeconds.value ?? 0)}.`);
  if (stops !== null) out.push(stops);
  return out;
}

/** The facts, as numbers: "52.2 m cutting", "54.9 m rapids (12 min 42 s)", "29,710 lines", "5 tool changes", "5 pauses". */
export function chips(view: MotionView): { readonly fact: string; readonly text: string }[] {
  const r = view.report;
  const t = view.time.rapidSeconds.value;
  const out = [{ fact: 'feed-mm', text: `${mm(r.feedMm.value ?? 0)} cutting` }];
  if (hasRapids(view)) out.push({ fact: 'rapid-time', text: `${mm(r.rapidMm.value ?? 0)} rapids${t === null ? '' : ` (${time(t)})`}` });
  out.push({ fact: 'lines', text: `${whole(r.lines)} lines` });
  if (r.toolChangeLines.length > 0) out.push({ fact: 'tool-changes', text: plural(r.toolChangeLines.length, 'tool change', 'tool changes') });
  if (r.stopLines.length > 0) out.push({ fact: 'pauses', text: plural(r.stopLines.length, 'pause', 'pauses') });
  return out;
}
