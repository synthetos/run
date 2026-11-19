import { boardText } from '@synthetos/safety';
import type { SettingValue } from '@synthetos/schema';
import { h, type ComponentChild } from 'preact';
import { openReport } from '../../../report/state.ts';
import {
  dialectOf,
  plainValue,
  settingsOf
} from '../../boardFacts.ts';
import { Icon } from '../../icons.ts';
import { connected, type LiveView } from '../../model.ts';
import { UNKNOWN } from '../../status.ts';
import { fact, NOT_CONNECTED_TEXT } from './shared.ts';

const REASON_TEXT: Readonly<Record<string, string>> = {
  'en-approved': 'An approved TinyG edge-next build.',
  'en-not-approved': 'A TinyG edge-next build that is not on the approved list yet.',
  'tg440-approved': 'An approved TinyG 440 build.',
  'tg440-not-approved': 'A TinyG 440 build that is not on the approved list.',
  'stock-449': 'Stock TinyG 449 firmware.',
  'g2core-read-only': 'g2core firmware, supported read-only.',
  'g2core-unknown-build': 'A g2core build Run does not know.',
  conflict: 'The board’s answers did not agree with each other.',
  probeFailed: 'The board did not answer the identification questions.',
  flowControl: 'The board’s flow control setting (ex) could not be read, or has a value Run doesn’t know.',
};

/** The probe facts in plain words, with the raw key as secondary text. */
export function BoardFacts({ view }: { readonly view: LiveView | null }): ComponentChild {
  const { c, s, on, id } = boardIdentityState({ view });
  const dialect = dialectLabel({ c });
  const readOnly = s?.overlays.includes('READ_ONLY') === true;
  const settings = settingsOf(view);
  const units = view?.message?.dro.units ?? null;
  const wcs = view?.message?.dro.wcs.code ?? null;
  return h(
    'section',
    { class: 'insp', 'data-region': 'board-facts', 'aria-labelledby': 'board-facts-title' },
    boardFactsHeader({ on, c, readOnly }),
    on
      ? boardFactsList({ id, dialect, units, settings, view, wcs, c })
      : h('p', { class: 'fine' }, NOT_CONNECTED_TEXT),
    on && readOnly && c?.detail !== undefined && c.detail !== ''
      ? h('p', { class: 'fine', 'data-board-fact': 'read-only' }, h('small', { class: 'raw-key block' }, boardText(c.detail)))
      : null,
    h(
      'div',
      { class: 'board-report' },
      h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'report-board', onClick: () => openReport({ origin: 'board', kind: 'firmware' }) }, Icon('flag', 14), 'Report a firmware problem'),
    ),
  );
}

type BoardIdentity = NonNullable<LiveView['message']>['snapshot']['identity'];
function boardFactsHeader({ on, c, readOnly }: { readonly on: boolean; readonly c: ClassificationInfo | null; readonly readOnly: boolean }): ComponentChild {
  return h(
    'header',
    null,
    h(
      'h2',
      { id: 'board-facts-title', class: 'board-facts-title' },
      on && c?.dialectId === 'tinyg-en' ? h('img', { class: 'edge-next-icon', src: '/brand/edge-next/tinyg-edge-next-2026-icon.png', alt: 'TinyG edge-next', width: 28, height: 28, 'data-board-logo': 'edge-next' }) : null,
      'This board'
    ),
    h('span', { class: `tag${readOnly ? ' mock' : ''}` }, on ? (readOnly ? 'Read only' : 'Connected') : 'Not connected')
  );
}

function boardIdentityState({ view }: { readonly view: LiveView | null }) {
  const s = view?.message?.snapshot ?? null;
  const on = view !== null && connected(view);
  const id = s?.identity ?? null;
  const c = s?.classification ?? null;
  return { c, s, on, id };
}

function dialectLabel({ c }: { readonly c: ClassificationInfo | null }) {
  return c?.dialectId === 'tinyg-en' ? 'TinyG edge-next' : c?.dialectId === 'tinyg-440' ? 'TinyG 440' : c?.dialectId === null || c === null ? 'Not identified' : c.dialectId;
}

function boardFactsList({ id, dialect, units, settings, view, wcs, c }: { readonly id: Identity | null; readonly dialect: string; readonly units: string | null; readonly settings: Readonly<Record<string, SettingValue>>; readonly view: LiveView | null; readonly wcs: string | null; readonly c: ClassificationInfo | null }): ComponentChild {
  return h(
    'dl',
    { class: 'facts board-facts' },
    ...boardIdentityFacts(id),
    fact('Firmware dialect', dialect, 'dialect', 'dialect'),
    fact('Units now', units === 'mm' ? 'millimetres (G21)' : units === 'in' ? 'inches (G20)' : 'Not read', 'unit', 'unit'),
    fact('Units at power-up', plainValue('gun', settings['gun'], dialectOf(view)) ?? 'Not read', 'gun', 'gun'),
    fact('Coordinate system', wcs ?? 'Not read', 'coor', 'coor'),
    fact('Approval', c === null ? UNKNOWN : (REASON_TEXT[c.reason] ?? c.reason), c?.reason ?? 'classification', 'approval')
  );
}

function boardIdentityFacts(id: BoardIdentity | null): ComponentChild[] {
  return [
    fact('Board id', boardText(id?.id) || 'Not reported', 'id', 'id'),
    fact('Firmware build', typeof id?.fb === 'number' ? id.fb.toFixed(2) : UNKNOWN, 'fb', 'fb'),
    fact('Firmware version', typeof id?.fv === 'number' ? String(id.fv) : UNKNOWN, 'fv', 'fv'),
    fact('Hardware platform', id?.hp === undefined ? UNKNOWN : boardText(String(id.hp)), 'hp', 'hp'),
    fact('Hardware version', id?.hv === undefined ? UNKNOWN : boardText(String(id.hv)), 'hv', 'hv'),
    id?.fbs === undefined ? null : fact('Build identity', boardText(id.fbs), 'fbs', 'fbs')
  ];
}

type Snapshot = NonNullable<LiveView['message']>['snapshot'];
type ClassificationInfo = NonNullable<Snapshot['classification']>;
type Identity = NonNullable<Snapshot['identity']>;
