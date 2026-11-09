/**
 * The settings view (ROADMAP P1-07): the board's settings as read through
 * the allowlist, grouped and explained, with the drift check's outcome.
 *
 * - Groups and their explanations come from `settingsReadGroups` (schema):
 *   only groups the dialect's read allowlist allows are listed.
 * - A key's label, description and unit come from the reviewed overlay
 *   where one exists (edge-next); other keys show their token only.
 * - Values are text nodes; string values from the board go through
 *   `boardText` (T-S85).
 * - Drift (NEEDS_REVIEW) shows the key-level diff; the default action,
 *   "Keep the board's settings", writes nothing to the machine (RUN_PLAN
 *   §7.2 step 7). There is no action that writes to the board here.
 *
 * A pure function of its props.
 */
import { h, type ComponentChild } from 'preact';
import { boardText } from '@synthetos/safety';
import { settingsReadGroups, settingsSchemaFor, type SettingValue } from '@synthetos/schema';
import type { ReadoutPhase } from '../live/readout.ts';

export interface SettingsViewProps {
  readonly dialectId: string | null;
  readonly phase: ReadoutPhase;
  /** The flattened settings of the last complete read. */
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly onKeep: () => void;
}

export function valueText(v: SettingValue | null | undefined): string {
  if (v === undefined || v === null) return '-';
  return typeof v === 'number' ? String(v) : boardText(v);
}

/** The read's outcome: reading, recorded, match, or the drift diff with "Keep the board's settings". */
export function SettingsStatus({ phase, onKeep }: { readonly phase: ReadoutPhase; readonly onKeep: () => void }): ComponentChild {
  return status(phase, onKeep);
}

function status(phase: ReadoutPhase, onKeep: () => void): ComponentChild {
  switch (phase.kind) {
    case 'idle':
      return h('p', { 'data-settings': 'idle' }, 'Connect a board to read its settings.');
    case 'reading':
      return h('p', { role: 'status', 'data-settings': 'reading' }, 'Reading the settings through the read allowlist…');
    case 'incomplete':
      return h('p', { role: 'alert', 'data-settings': 'incomplete' }, 'The settings read is incomplete: ', phase.message);
    case 'noBoardId':
      return h('p', { 'data-settings': 'no-board-id' }, 'This board reports no id, so its settings cannot be compared with an earlier read.', h('span', { 'data-advanced-only': 'true' }, ' Settings hash ', h('code', null, phase.hash.slice(0, 12)), '.'));
    case 'recorded':
      return h('p', { 'data-settings': 'recorded' }, 'First read of this board on this computer: recorded as the reference for later connections.', h('span', { 'data-advanced-only': 'true' }, ' Settings hash ', h('code', null, phase.hash.slice(0, 12)), '.'));
    case 'match':
      return h('p', { 'data-settings': 'match' }, 'The settings match the reference taken ', phase.reference.at, '.', h('span', { 'data-advanced-only': 'true' }, ' Settings hash ', h('code', null, phase.hash.slice(0, 12)), '.'));
    case 'drift':
      return h(
        'div',
        { class: 'overlay-banner overlay-banner-warn', role: 'alert', 'data-settings': 'drift' },
        h('p', null, phase.accepted
          ? `The board's settings changed since the reference taken ${phase.reference.at} (changed by another program, or on another computer). Run kept the board's settings as the new reference; the differences are below.`
          : `The board's settings changed since the reference taken ${phase.reference.at} (changed by another program, or on another computer). Review the differences before you use this machine.`),
        h(
          'table',
          { class: 'settings-diff' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Key'), h('th', { scope: 'col' }, 'Reference'), h('th', { scope: 'col' }, 'Board now'))),
          h(
            'tbody',
            null,
            phase.result.diffs.map((d) => h('tr', { 'data-key': d.key }, h('th', { scope: 'row' }, d.key), h('td', null, valueText(d.expected)), h('td', null, valueText(d.board)))),
          ),
        ),
        phase.accepted
          ? h('p', { 'data-settings': 'accepted' }, "The board's settings are now the reference on this computer. Nothing was written to the machine. Reconnect to clear NEEDS REVIEW.")
          : h('button', { type: 'button', class: 'button', 'data-action': 'keep-board-settings', onClick: onKeep }, "Keep the board's settings (writes nothing to the machine)"),
      );
  }
}

export function SettingsView({ dialectId, phase, settings, onKeep }: SettingsViewProps): ComponentChild {
  const groups = dialectId === null ? [] : settingsReadGroups(dialectId);
  const defs = dialectId === null || groups.length === 0 ? null : settingsSchemaFor(dialectId).settings;
  return h(
    'section',
    { class: 'settings-read', 'data-region': 'settings', 'aria-labelledby': 'settings-title' },
    h('h2', { id: 'settings-title' }, 'Board settings (read only)'),
    status(phase, onKeep),
    Object.keys(settings).length === 0
      ? null
      : groups.map((g) =>
          h(
            'details',
            { class: 'settings-group', 'data-group': g.token },
            h('summary', null, g.title),
            h('p', { class: 'settings-explain' }, g.explanation),
            h(
              'table',
              null,
              h(
                'tbody',
                null,
                g.members.map((token) => {
                  const o = defs?.get(token)?.overlay;
                  return h(
                    'tr',
                    { 'data-key': token },
                    h('th', { scope: 'row' }, h('code', null, token), o === undefined ? null : ` ${o.label}`),
                    h('td', { 'data-value': '' }, valueText(settings[token]), o === undefined || o.unit === 'enum' ? '' : ` ${o.unit}`),
                    h('td', { class: 'settings-desc' }, o?.description ?? ''),
                  );
                }),
              ),
            ),
          ),
        ),
  );
}
