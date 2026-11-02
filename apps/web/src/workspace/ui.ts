/**
 * Small shared pieces of the workspace views: tab bars (so long panels split
 * into sections instead of scrolling), the plain-words value with its raw key,
 * and the check list rows. Pure; no machine access.
 */
import { h, type ComponentChild } from 'preact';
import { Icon, type IconName } from './icons.ts';

export interface TabDef<T extends string> {
  readonly id: T;
  readonly label: string;
  /** A small count or flag after the label. */
  readonly badge?: string;
}

/**
 * A tab bar. Every pane stays rendered (hidden when not current), so nothing is torn down and the
 * prerendered page carries every control. `attr` names the data attribute that identifies each tab.
 */
export function TabBar<T extends string>(props: {
  readonly label: string;
  readonly tabs: readonly TabDef<T>[];
  readonly current: T;
  readonly onSelect: (id: T) => void;
  readonly attr?: string;
  readonly prefix: string;
  readonly variant?: 'tabs' | 'underline';
}): ComponentChild {
  const attr = props.attr ?? 'data-tab';
  return h(
    'div',
    { class: props.variant === 'underline' ? 'utabs' : 'tabs', role: 'tablist', 'aria-label': props.label },
    props.tabs.map((t) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          key: t.id,
          id: `${props.prefix}-tab-${t.id}`,
          'aria-controls': `${props.prefix}-pane-${t.id}`,
          'aria-selected': props.current === t.id ? 'true' : 'false',
          [attr]: t.id,
          onClick: () => props.onSelect(t.id),
        },
        t.label,
        t.badge === undefined ? null : h('span', { class: 'tab-badge' }, t.badge),
      ),
    ),
  );
}

/** One tab pane, hidden unless current. */
export function TabPane(props: { readonly prefix: string; readonly id: string; readonly current: string; readonly class?: string; readonly children?: ComponentChild }): ComponentChild {
  return h('div', { role: 'tabpanel', id: `${props.prefix}-pane-${props.id}`, 'aria-labelledby': `${props.prefix}-tab-${props.id}`, hidden: props.current !== props.id, class: props.class ?? 'tpane' }, props.children);
}

export type CheckTone = 'ok' | 'warn' | 'danger' | 'info' | 'todo';

const TONE_ICON: Readonly<Record<CheckTone, IconName>> = { ok: 'check', warn: 'warning', danger: 'hazard', info: 'info', todo: 'info' };

/** A compact check row: icon, short label, value. */
export function CheckRow(props: { readonly tone: CheckTone; readonly label: string; readonly value?: string; readonly icon?: IconName; readonly attr?: string }): ComponentChild {
  return h(
    'li',
    { class: `check-row tone-${props.tone}`, ...(props.attr === undefined ? {} : { 'data-check': props.attr }) },
    h('span', { class: 'check-icon' }, Icon(props.icon ?? TONE_ICON[props.tone], 15)),
    h('span', { class: 'check-label' }, props.label),
    props.value === undefined ? null : h('strong', { class: 'check-value' }, props.value),
  );
}

/** A value in plain words with its raw key as secondary text. */
export function Keyed(props: { readonly value: string; readonly raw: string; readonly title?: string }): ComponentChild {
  return h('span', { class: 'keyed', ...(props.title === undefined ? {} : { title: props.title }) }, h('span', null, props.value), h('code', { class: 'raw-key' }, props.raw));
}
