/** Owner 2026-11-15: bounded live controls, no keyboard bindings or preview changes. */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { WorkspaceModel } from '../model.ts';
import type { SnapshotMessage } from '../../machine-worker/rpc.ts';
type SessionSnapshot = SnapshotMessage['snapshot'];
type Channel = 'feed' | 'spindle';
type Reading = NonNullable<SessionSnapshot['overrides']>['feed'];
export function overrideVisible(snapshot: SessionSnapshot | null): boolean {
  return snapshot !== null && (snapshot.identity?.fb ?? 0) >= 450.06 &&
    snapshot.classification?.dialectId === 'tinyg-en' &&
    snapshot.job !== null && ['running', 'draining', 'ending', 'paused', 'breakpoint', 'programStop'].includes(snapshot.job.phase);
}
export function nextOverride(value: number, step: number): number {
  return Math.max(10, Math.min(150, Math.round((value + step) / 10) * 10));
}
function readout(reading: Reading | undefined): { text: string; reason: string | null; disabled: boolean; value: number } {
  if (!reading || reading.requested === null || reading.effective === null || reading.permitted === null) return { text: '—', reason: 'Waiting for board values', disabled: true, value: 100 };
  return {
    text: `${reading.requested}% requested · ${reading.effective}% in effect`,
    reason: !reading.permitted ? 'locked by the program' : reading.capped ? 'held at a speed limit' : null,
    disabled: !reading.permitted, value: reading.requested,
  };
}
function OverrideRow({ channel, reading, blocked, change }: {
  readonly channel: Channel; readonly reading: Reading | undefined; readonly blocked: boolean;
  readonly change: (channel: Channel, percent: number) => void;
}) {
  const r = readout(reading), disabled = blocked || r.disabled, label = channel === 'feed' ? 'Feed' : 'Spindle';
  return h('div', { class: 'override-row', 'data-override': channel },
    h('strong', null, label), h('span', { 'aria-live': 'polite' }, r.text),
    h('div', { class: 'override-buttons', role: 'group', 'aria-label': `${label} override` },
      h('button', { type: 'button', disabled: disabled || r.value <= 10, onClick: () => change(channel, nextOverride(r.value, -10)), 'aria-label': `${label} minus 10%` }, '−10%'),
      h('button', { type: 'button', disabled, onClick: () => change(channel, 100), 'aria-label': `${label} 100%` }, '100%'),
      h('button', { type: 'button', disabled: disabled || r.value >= 150, onClick: () => change(channel, nextOverride(r.value, 10)), 'aria-label': `${label} plus 10%` }, '+10%')),
    r.reason ? h('small', null, r.reason) : null);
}
export function OverrideControls({ model }: { readonly model: WorkspaceModel | null }) {
  const [error, setError] = useState<string | null>(null);
  const snapshot = model?.live.value.message?.snapshot ?? null;
  if (!overrideVisible(snapshot) || !snapshot) return null;
  const view = snapshot.overrides, send = model?.actions.value?.job;
  const blocked = controlsBlocked(snapshot, send === undefined);
  const change = (channel: Channel, percent: number): void => {
    setError(null);
    void send?.({ op: 'override', channel, percent }).then(setError);
  };
  return h('section', { class: 'override-controls', 'aria-label': 'Live overrides', 'data-region': 'overrides' },
    h('h3', null, 'Live overrides'),
    h(OverrideRow, { channel: 'feed', reading: view?.feed, blocked, change }),
    h(OverrideRow, { channel: 'spindle', reading: view?.spindle, blocked, change }),
    error || view?.error ? h('p', { role: 'status' }, error ?? view?.error) : null);
}

function controlsBlocked(snapshot: SessionSnapshot, noSender: boolean): boolean {
  return snapshot.overlays.length !== 0 || snapshot.job?.stopping === true || snapshot.overrides?.busy === true || noSender;
}
