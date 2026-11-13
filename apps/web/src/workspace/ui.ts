import { DialogWrap } from './dialogs/DialogWrap.ts';
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
  return h('div', { role: 'tabpanel', tabindex: 0, id: `${props.prefix}-pane-${props.id}`, 'aria-labelledby': `${props.prefix}-tab-${props.id}`, hidden: props.current !== props.id, class: props.class ?? 'tpane' }, props.children);
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

/** Focuses an element once, when it mounts (a stable callback ref, so later renders never steal the focus back). */
export function focusOnMount(el: HTMLElement | null): void {
  if (el === null || el.dataset['focused'] === '1') return;
  el.dataset['focused'] = '1';
  el.focus();
}

/** An inline confirmation (never a modal over the stop controls, SAFETY §4.1 UI rules). Cancel has the focus; Enter does not confirm. */
export function ConfirmCard(props: {
  readonly text: string;
  readonly confirm: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly safety: string;
  readonly children?: ComponentChild;
}): ComponentChild {
  // A modal centred over the page below the machine strip (owner, 2026-11-04, OD-16): readable wherever it is asked
  // from, and never over W1, the strip or Pause and Stop job (SAFETY §4.1 UI rules).
  return h(
    DialogWrap,
    { class: 'dialog-wrap confirm-modal', role: 'presentation', setup: belowStrip, onDismiss: props.onCancel },
    h(
      'div',
      { class: 'dialog motion-confirm', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': props.confirm, 'data-safety': props.safety },
      h('p', null, props.text),
      props.children ?? null,
      h(
        'div',
        { class: 'motion-confirm-actions' },
        h('button', { type: 'button', class: 'small', 'data-action': 'motion-cancel', ref: focusOnMount, onClick: props.onCancel }, 'Cancel'),
        h('button', { type: 'button', class: 'small primary', 'data-action': 'motion-confirm', onClick: props.onConfirm }, props.confirm),
      ),
    ),
  );
}

/** Starts a fixed overlay at the machine strip's bottom edge, so W1, the strip and the stop controls stay uncovered. */
export function belowStrip(el: HTMLElement | null): void {
  const bottom = el?.ownerDocument.querySelector('[data-region="machine-strip"]')?.getBoundingClientRect().bottom;
  if (el !== null && bottom !== undefined) el.style.setProperty('--strip-bottom', `${Math.round(bottom)}px`);
}

/**
 * A square icon button whose name is its tooltip (owner, 2026-11-05: icons with hover tips instead of long text
 * buttons). The label is the accessible name and the tip; a disabled button's tip adds why it is off.
 */
export function IconButton(props: {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly why?: string | null;
  readonly primary?: boolean;
  readonly attrs?: Readonly<Record<string, string>>;
  /** Short words shown beside the icon where there is room (owner, 2026-11-09: an icon alone is a guess). */
  readonly text?: string;
}): ComponentChild {
  const off = props.disabled === true || props.onClick === undefined;
  const tip = off && props.why !== undefined && props.why !== null ? `${props.label}. ${props.why}` : props.label;
  return h(
    'button',
    { type: 'button', class: `icon-btn${props.text === undefined ? '' : ' with-text'}${props.primary === true ? ' primary' : ''}`, 'aria-label': props.label, 'data-tip': tip, ...(props.attrs ?? {}), ...(off ? { disabled: true } : { onClick: props.onClick }) },
    Icon(props.icon, 18),
    props.text === undefined ? null : h('span', { 'aria-hidden': 'true' }, props.text),
  );
}
