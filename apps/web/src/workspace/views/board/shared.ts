import type { SettingValue } from '@synthetos/schema';
import { h, type ComponentChild } from 'preact';
import { connected, type LiveView } from '../../model.ts';

export type Settings = Readonly<Record<string, SettingValue>>;

export const NOT_CONNECTED_TEXT = 'Connect a board from the Job page. Its settings appear here.';

export function fact(label: string, value: string, raw: string, attr?: string): ComponentChild {
  return h('div', { key: raw }, h('dt', null, label, h('small', { class: 'raw-key' }, raw)), h('dd', attr === undefined ? null : { 'data-board-fact': attr }, value));
}

export function Empty({ view }: { readonly view: LiveView | null }): ComponentChild {
  return h('p', { class: 'board-empty' }, view !== null && connected(view) ? 'Waiting for board settings.' : NOT_CONNECTED_TEXT);
}
