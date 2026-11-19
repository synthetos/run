/**
 * Tabs inside a Board tab (owner walk 2026-11-19: "we dont like scroll bars ... we need perhaps tabs"): a Board tab
 * whose content does not fit a 1280 × 800 window shows one part at a time instead of scrolling. Each tab keeps its
 * choice in a signal of its own, so a re-render or a visit to another tab does not reset it.
 */
import { h, type ComponentChild } from 'preact';
import { signal, type Signal } from '@preact/signals';
import { TabBar } from '../../ui.ts';

export interface SubTab {
  readonly id: string;
  readonly label: string;
  readonly badge?: string;
}

/** The chosen sub-tab of each Board tab; null means "the first one". */
export const subTabChoice: Readonly<Record<'axes' | 'motors' | 'inputs' | 'io' | 'firmware', Signal<string | null>>> = {
  axes: signal(null),
  motors: signal(null),
  inputs: signal(null),
  io: signal(null),
  firmware: signal(null),
};

/** The chosen sub-tab, or the first one when nothing (or something no longer listed) is chosen. */
export function chosen(choice: Signal<string | null>, tabs: readonly SubTab[]): string {
  const id = choice.value;
  return tabs.some((t) => t.id === id) ? (id as string) : (tabs[0]?.id ?? '');
}

/** The sub-tab bar and the chosen part. `name` labels the bar for assistive technology. */
export function SubTabs({ name, prefix, tabs, choice, render }: { readonly name: string; readonly prefix: string; readonly tabs: readonly SubTab[]; readonly choice: Signal<string | null>; readonly render: (id: string) => ComponentChild }): ComponentChild {
  const current = chosen(choice, tabs);
  return h(
    'div',
    { class: 'subtabs', 'data-subtabs': prefix },
    h(TabBar<string>, { label: name, prefix, attr: 'data-subtab', variant: 'underline', tabs, current, onSelect: (id) => { choice.value = id; } }),
    h('div', { role: 'tabpanel', id: `${prefix}-pane-${current}`, 'aria-labelledby': `${prefix}-tab-${current}`, class: 'subtab-pane', 'data-subtab-pane': current }, render(current)),
  );
}
