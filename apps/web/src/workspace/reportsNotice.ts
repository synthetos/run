/** The status-reporting notice (W35, W36, W44), shared by the connect notice (views/RunView.ts) and the dock's Live job tab. */
import { h, type ComponentChild } from 'preact';
import { w35, w36, w44 } from '@synthetos/safety';
import { signalText } from '../shell/signal.ts';
import { connected, type LiveView } from './model.ts';

/**
 * What the session changed in the board's status reporting at connect, in plain words (W35, W36; H64), and why
 * the configuration did not finish when it did not.
 */
export function reportsNotice(view: LiveView | null): ComponentChild {
  const r = view !== null && connected(view) ? view.message?.snapshot.reports : undefined;
  if (r === undefined) return null;
  const lines: ComponentChild[] = [];
  for (const c of r.changes) {
    if (c.setting === 'sr') lines.push(h('p', { key: 'sr', class: 'fine', 'data-safety': 'W35', 'data-reports': 'sr' }, ...signalText(w35())));
    else if (c.from !== undefined && c.to !== undefined) lines.push(h('p', { key: c.setting, class: 'fine', 'data-safety': 'W36', 'data-reports': c.setting }, ...signalText(w36({ setting: c.setting, from: c.from, to: c.to }))));
  }
  if (r.detail !== null) lines.push(h('p', { key: 'detail', class: 'fine', 'data-reports': 'detail' }, `Status reports: ${r.detail}.`));
  // H77: the line mode Run had changed for a job that did not end here, put back at connect (only with this browser's record).
  const rxm = view?.message?.snapshot.rxm;
  if (rxm !== undefined && rxm.changed?.kind === 'restore' && view?.message?.snapshot.job === null) lines.push(h('p', { key: 'rxm', class: 'fine', 'data-safety': 'W44' }, ...signalText(w44({ to: rxm.changed.to }))));
  if (r.phase === 'done' && r.heartbeatMs === null) lines.push(h('p', { key: 'hb', class: 'fine', 'data-reports': 'no-heartbeat' }, 'This firmware has no heartbeat: Run checks the link only after a few seconds of silence.'));
  return lines.length === 0 ? null : h('div', { class: 'reports-notice' }, lines);
}
