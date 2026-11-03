/**
 * The DRO (ROADMAP P1-07): work and machine coordinates, the active work
 * coordinate system with its offsets, homed flags, and the board's
 * identity, each value labelled with where it came from.
 *
 * - Machine and work coordinates come from the connect-time read and then
 *   from the board's pushed status reports (the worker's `droView`,
 *   amendment 2026-11-02). Their age is the time since the board last said
 *   anything; the lag badge turns amber, then red at the silence window or
 *   STALE (SAFETY §4.2).
 * - Position is never trusted in Phase 1: the panel says so.
 * - Strings from the serial port (`id`, `fbs`) are rendered as text nodes
 *   after `boardText` (T-S85); nothing from the board becomes markup.
 *
 * A pure function of its props.
 */
import { h, type ComponentChild } from 'preact';
import { boardText } from '@synthetos/safety';
import type { SnapshotMessage } from '../machine-worker/rpc.ts';

export type Lag = SnapshotMessage['dro']['machineSource']['lag'];

export interface DroProps {
  readonly message: Pick<SnapshotMessage, 'dro' | 'lag'> & { readonly snapshot: Pick<SnapshotMessage['snapshot'], 'identity' | 'overlays'> };
  /** Milliseconds since the window received `message` (the worker's clock is not the window's). */
  readonly elapsedMs: number;
}

/** The lag at `ageMs` (window side, with the worker's thresholds). */
export function lagAt(ageMs: number | null, stale: boolean, lag: SnapshotMessage['lag']): Lag {
  if (ageMs === null) return 'none';
  if (stale || ageMs >= lag.redMs) return 'red';
  return ageMs >= lag.amberMs ? 'amber' : 'fresh';
}

const LAG_TEXT: Readonly<Record<Lag, string>> = { none: 'waiting for the first read', fresh: 'current', amber: 'lagging', red: 'stale' };

export function formatAxis(v: number | null): string {
  return v === null ? '-' : v.toFixed(3);
}

export function formatAge(ms: number | null): string {
  return ms === null ? 'never' : `${(ms / 1000).toFixed(1)} s ago`;
}

export function Dro({ message, elapsedMs }: DroProps): ComponentChild {
  const { dro, snapshot } = message;
  const base = dro.machineSource.ageMs;
  const ageMs = base === null ? null : base + Math.max(0, elapsedMs);
  const lag = lagAt(ageMs, snapshot.overlays.includes('STALE'), message.lag);
  const shown = dro.axes.filter((a) => a.machine !== null || a.work !== null || ['x', 'y', 'z'].includes(a.axis));
  const units = dro.units ?? 'units unknown';
  const id = boardText(snapshot.identity?.id);
  const fbs = boardText(snapshot.identity?.fbs);
  return h(
    'section',
    { class: 'dro', 'data-region': 'dro', 'aria-labelledby': 'dro-title' },
    h('h2', { id: 'dro-title' }, 'Position'),
    h(
      'p',
      { class: 'dro-identity', 'data-dro': 'identity' },
      'Board ',
      h('span', { 'data-board-text': 'id', dir: 'ltr' }, id === '' ? 'without an id' : id),
      fbs === '' ? null : h('span', null, ', build ', h('span', { 'data-board-text': 'fbs', dir: 'ltr' }, fbs)),
    ),
    h('p', { class: 'dro-untrusted', role: 'note' }, 'Position is not verified in this release: the machine has not been homed or checked from this browser.'),
    h(
      'p',
      { class: 'dro-source' },
      'Position, from the controller’s status reports: ',
      h('span', { 'data-dro': 'age' }, formatAge(ageMs)),
      ' · ',
      h('span', { class: `lag-badge lag-${lag}`, 'data-lag': lag, role: 'status' }, LAG_TEXT[lag]),
      '. The controller reports a change; between changes the last value holds while it keeps talking.',
    ),
    h(
      'table',
      { class: 'dro-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), h('th', { scope: 'col' }, `Work (${units})`), h('th', { scope: 'col' }, 'Machine (mm)'), h('th', { scope: 'col' }, 'Homed'))),
      h(
        'tbody',
        null,
        shown.map((a) =>
          h(
            'tr',
            { 'data-axis': a.axis },
            h('th', { scope: 'row' }, a.axis.toUpperCase()),
            h('td', { 'data-dro': 'work' }, formatAxis(a.work)),
            h('td', { 'data-dro': 'machine' }, formatAxis(a.machine)),
            h('td', { 'data-dro': 'homed' }, a.homed === null ? 'not read' : a.homed ? 'yes' : 'no'),
          ),
        ),
      ),
    ),
    h(
      'p',
      { class: 'dro-wcs', 'data-dro': 'wcs' },
      'Work coordinate system: ',
      dro.wcs.code ?? 'not read',
      // G54..G59 print in the board's current units (F_CONVERT); ofs is always millimetres (EN config_app.c:852-855).
      dro.wcs.offsets === null ? null : ` (offsets ${offsetText(dro.wcs.offsets, dro.units === null ? ', units not read' : ` ${dro.units}`)})`,
      dro.wcs.total === null ? null : `. Total offset including G92: ${offsetText(dro.wcs.total, ' mm')}.`,
    ),
  );
}

function offsetText(o: Readonly<Partial<Record<string, number>>>, unit: string): string {
  const parts = Object.entries(o)
    .filter(([axis]) => ['x', 'y', 'z'].includes(axis))
    .map(([axis, v]) => `${axis.toUpperCase()} ${formatAxis(v ?? null)}`);
  return parts.length === 0 ? 'none' : `${parts.join(', ')}${unit}`;
}
