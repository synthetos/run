/**
 * The status-reporting notices (W35, W36, W44): as paragraphs for the connect notice (views/RunView.ts), and as notes
 * for the Notes tab (owner, 2026-11-09), where the Live job tab used to show them.
 */
import { h, type ComponentChild } from 'preact';
import { w35, w36, w44 } from '@synthetos/safety';
import { signalText } from '../shell/signal.ts';
import { connected, type LiveView } from './model.ts';
import type { Note } from './notes/notes.ts';

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

/** The same, as notes for the Notes tab: each registered text in full, with what it is about. */
export function reportsNotes(view: LiveView | null): readonly Note[] {
  const r = view !== null && connected(view) ? view.message?.snapshot.reports : undefined;
  if (r === undefined) return [];
  const board = { kind: 'board', tab: 'comms', label: 'Communications' } as const;
  const out: Note[] = [];
  for (const c of r.changes) {
    if (c.setting === 'sr') out.push({ id: 'reports-sr', topic: 'Board', title: 'Status reports set.', body: 'Run added what it needs to the board’s status reports.', detail: w35(), safety: 'W35', link: board, tone: 'info' });
    else if (c.from !== undefined && c.to !== undefined) out.push({ id: `reports-${c.setting}`, topic: 'Board', title: `${c.setting} changed.`, body: `Run set ${c.setting} from ${String(c.from)} to ${String(c.to)}.`, detail: w36({ setting: c.setting, from: c.from, to: c.to }), safety: 'W36', link: board, tone: 'info' });
  }
  if (r.detail !== null) out.push({ id: 'reports-detail', topic: 'Board', title: 'Status reports.', body: `${r.detail.charAt(0).toUpperCase()}${r.detail.slice(1)}.`, tone: 'warn' });
  const rxm = view?.message?.snapshot.rxm;
  if (rxm !== undefined && rxm.changed?.kind === 'restore' && view?.message?.snapshot.job === null) out.push({ id: 'reports-rxm', topic: 'Board', title: 'Line mode put back.', body: `Run set rxm back to ${String(rxm.changed.to)}.`, detail: w44({ to: rxm.changed.to }), safety: 'W44', tone: 'info' });
  if (r.phase === 'done' && r.heartbeatMs === null) out.push({ id: 'reports-heartbeat', topic: 'Board', title: 'No heartbeat.', body: 'Run checks the link only after a few seconds of silence.' });
  return out;
}
