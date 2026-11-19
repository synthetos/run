/**
 * The fields the board puts in each status report, in words (moved from the old Communications tab): a field that
 * is a setting reads by its name, any other by the settings file's `statusFields`, else the raw token.
 */
import { h, type ComponentChild } from 'preact';
import { connected, type LiveView } from '../model.ts';
import { defsFor } from './defs.ts';
import { settingMeta } from './meta.ts';

/** A status-report field in words: its setting's name, else the file's statusFields word, else the raw token. */
export function fieldWords(k: string, view: LiveView | null): string {
  const meta = settingMeta(k, view?.readout.dialectId ?? null);
  return meta.def?.label ?? defsFor(view)?.statusFields?.[k] ?? k;
}

/** One chip per field, or null before the board answered its first status request. */
export function StatusFields({ view }: { readonly view: LiveView | null }): ComponentChild {
  const srList = view !== null && connected(view) ? view.message?.snapshot.live.srList : undefined;
  if (srList === undefined) return null;
  return h('ul', { class: 'key-chips status-fields', 'data-status-fields': '', 'aria-label': 'Fields in each status report' }, srList.map((k) => h('li', { key: k }, fieldWords(k, view), h('code', { class: 'raw-key' }, k))));
}
