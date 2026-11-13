import { h, type ComponentChildren, type ComponentChild } from 'preact';
import { useDialogDismiss } from './useDialogDismiss.ts';

/** Existing Cancel/Not now paths only; never invent an exit for a machine-state blocker. */
export function DialogWrap({ onDismiss, children, setup, ...props }: {
  readonly onDismiss: () => void;
  readonly children?: ComponentChildren;
  readonly setup?: (el: HTMLDivElement | null) => void;
  readonly class: string;
  readonly role?: string;
  readonly 'data-dialog'?: string;
}): ComponentChild {
  const { ref } = useDialogDismiss(onDismiss);
  return h('div', { ...props, ref: (el: HTMLDivElement | null) => { ref.current = el; setup?.(el); } }, children);
}
