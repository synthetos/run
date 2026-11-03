/** Explanations on demand. CSS hover/focus also works before hydration or without JavaScript. */
import { h, type ComponentChild } from 'preact';

export interface ContextHelpProps {
  readonly id: string;
  readonly label: string;
  readonly safety?: string;
  readonly below?: boolean;
  readonly end?: boolean;
  readonly children?: ComponentChild;
}

export function ContextHelp({ id, label, safety, below = false, end = false, children }: ContextHelpProps): ComponentChild {
  const show = (e: Event): void => { (e.currentTarget as HTMLElement).parentElement?.classList.remove('help-dismissed'); };
  return h('span', { class: `context-help${below ? ' help-below' : ''}${end ? ' help-end' : ''}` },
    h('button', {
      type: 'button', class: 'help-trigger', 'data-action': 'context-help', 'aria-label': label, 'aria-describedby': id,
      onFocus: show, onMouseEnter: show,
      onClick: (e: Event) => { show(e); (e.currentTarget as HTMLElement).focus(); },
      onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Escape') { (e.currentTarget as HTMLElement).parentElement?.classList.add('help-dismissed'); } },
    }, '?'),
    h('span', { class: 'help-copy', id, role: 'tooltip', ...(safety === undefined ? {} : { 'data-safety': safety }) }, children));
}
