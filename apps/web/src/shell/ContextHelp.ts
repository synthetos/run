/** Explanations on demand. CSS hover/focus also works before hydration or without JavaScript. */
import { h, type ComponentChild } from 'preact';
import { helpPosition } from './helpPosition.ts';

export interface ContextHelpProps {
  readonly id: string;
  readonly label: string;
  readonly safety?: string;
  readonly below?: boolean;
  readonly end?: boolean;
  /** Words to show in place of the round "?" (a status word whose help is on demand, owner 2026-11-09). */
  readonly trigger?: string;
  readonly children?: ComponentChild;
}

export function ContextHelp({ id, label, safety, below = false, end = false, trigger, children }: ContextHelpProps): ComponentChild {
  const hide = (root: HTMLElement): void => {
    const copy = root.querySelector<HTMLElement>('.help-copy');
    if (copy?.matches(':popover-open')) copy.hidePopover();
  };
  const show = (e: Event): void => {
    const button = e.currentTarget as HTMLElement;
    const root = button.parentElement;
    root?.classList.remove('help-dismissed');
    const copy = root?.querySelector<HTMLElement>('.help-copy');
    if (copy === null || copy === undefined || typeof copy.showPopover !== 'function') return;
    // Added only after hydration: the original hover/focus CSS remains a no-JS fallback.
    copy.setAttribute('popover', 'auto');
    if (!copy.matches(':popover-open')) copy.showPopover();
    position(button, copy);
  };
  const position = (button: HTMLElement, copy: HTMLElement): void => {
    const small = window.innerWidth <= 600;
    const box = copy.getBoundingClientRect();
    const pos = helpPosition(button.getBoundingClientRect(), box.width, box.height, { width: window.innerWidth, height: window.innerHeight }, below, end);
    copy.style.left = `${small ? 16 : pos.left}px`;
    copy.style.top = `${small ? Math.max(8, window.innerHeight - box.height - 16) : pos.top}px`;
  };
  let detach: (() => void) | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;
  const attach = (root: HTMLSpanElement | null): void => {
    detach?.();
    if (closing !== undefined) clearTimeout(closing);
    if (root === null) return;
    const reposition = (): void => {
      const button = root.querySelector<HTMLElement>('.help-trigger');
      const copy = root.querySelector<HTMLElement>('.help-copy');
      if (button !== null && copy?.matches(':popover-open')) position(button, copy);
    };
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    detach = () => { window.removeEventListener('resize', reposition); document.removeEventListener('scroll', reposition, true); };
  };
  return h('span', { ref: attach, class: `context-help${below ? ' help-below' : ''}${end ? ' help-end' : ''}`, onMouseLeave: (e: MouseEvent) => { const root = e.currentTarget as HTMLElement; if (closing !== undefined) clearTimeout(closing); closing = setTimeout(() => { if (!root.matches(':hover') && !root.contains(document.activeElement)) hide(root); }, 120); }, onFocusOut: (e: FocusEvent) => { const root = e.currentTarget as HTMLElement; if (!root.contains(e.relatedTarget as Node | null)) hide(root); } },
    h('button', {
      type: 'button', class: trigger === undefined ? 'help-trigger' : 'help-trigger help-words', 'data-action': 'context-help', 'aria-label': label, 'aria-describedby': id,
      onFocus: show, onMouseEnter: show,
      onClick: (e: Event) => { show(e); (e.currentTarget as HTMLElement).focus(); },
      onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Escape') { const root = (e.currentTarget as HTMLElement).parentElement; if (root !== null) { root.classList.add('help-dismissed'); hide(root); } } },
    }, trigger ?? '?'),
    h('span', { class: 'help-copy', id, role: 'tooltip', ...(safety === undefined ? {} : { 'data-safety': safety }) }, children));
}
