/** Connect refusal content; the enclosing view supplies the dialog. */
import { h, type ComponentChild } from 'preact';
import { AccountNotice } from './accountNotice.ts';
import type { EntryRefusal } from './liveEntry.ts';

interface Props {
  readonly refusal: EntryRefusal;
  readonly message: string;
  readonly signInHref: string | null;
  readonly onCancel: () => void;
}

export function ConnectRefusal(props: Props): ComponentChild {
  const comingSoon = props.refusal.kind === 'signed-out' && !props.refusal.signIn;
  return h('div', {
    class: 'live-entry', 'data-entry': 'refused', 'data-refusal': props.refusal.kind,
    ...(comingSoon ? { 'data-accounts': 'coming-soon' } : {}),
  },
  comingSoon ? h(AccountNotice, { signInHref: props.signInHref }) : h('p', { role: 'alert' }, props.message),
  !comingSoon && props.refusal.kind === 'signed-out' && props.signInHref !== null
    ? h('p', null, h('a', { class: 'button', href: props.signInHref, 'data-action': 'sign-in' }, 'Sign in')) : null,
  h('button', { type: 'button', class: 'button', 'data-action': 'dismiss', onClick: props.onCancel }, comingSoon ? 'Close' : 'OK'));
}
