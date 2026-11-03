/**
 * Simple | Advanced, site-wide (OD-13, owner 2026-11-03): one switch in the top bar; every view answers to it.
 * Presentation only, kept per browser: Pause, Stop job, Spindle off, W1 and every confirmation are the same at both.
 */
import { h, type ComponentChild } from 'preact';
import { uiLevel, type UiLevel } from './jobWorkflow.ts';

export function LevelSwitch(): ComponentChild {
  const level = uiLevel.value.value;
  const option = (id: UiLevel, label: string): ComponentChild =>
    h('button', { type: 'button', key: id, class: level === id ? 'selected' : undefined, 'aria-pressed': level === id ? 'true' : 'false', 'data-action': `ui-level-${id}`, title: id === 'simple' ? 'The essentials on every page' : 'Everything: tabs, raw settings, the console', onClick: () => uiLevel.set(id) }, label);
  return h('span', { class: 'seg level-switch', role: 'group', 'aria-label': 'Interface level', 'data-ui-level': level }, option('simple', 'Simple'), option('advanced', 'Advanced'));
}
