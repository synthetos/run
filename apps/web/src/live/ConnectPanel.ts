/**
 * The Connect panel (ROADMAP P1-05): the Connect button, C1 (SAFETY §6), the
 * LIVE entry refusals, and the advisory banner while connected (H27).
 * A pure function of its props; live/liveEntry.ts holds the state. C1 text
 * comes from @synthetos/safety only (T-S32).
 */
import { h, type ComponentChild } from 'preact';
import { BOX } from '@synthetos/safety';
import type { AdvisoryCheck } from './advisoryGate.ts';
import { ACCOUNT_TITLE, AccountNotice } from './accountNotice.ts';
import { c1Checklist } from './c1.ts';
import type { EntryRefusal, EntryState } from './liveEntry.ts';

export interface ConnectPanelProps {
  readonly state: EntryState;
  /** The advisory poll's block while connected, or null. */
  readonly advisoryBlocked: AdvisoryCheck | null;
  readonly onConnect: () => void;
  readonly onConfirm: (ticked: readonly boolean[]) => void;
  readonly onCancel: () => void;
  readonly onDisconnect: () => void;
  /** A1-07: the sign-in link when this host offers sign-in (accounts decides who is admitted), else null. */
  readonly signInHref?: string | null;
}

export function advisoryText(check: Exclude<AdvisoryCheck, { ok: true }>): string {
  switch (check.reason) {
    case 'revoked':
      return `This version of the app was withdrawn by a safety advisory (${check.revocation.reason}). Reload the page to get the current version.`;
    case 'unverifiable':
      return `The safety advisory could not be verified (${check.rejection}), so this page will not connect a machine.`;
    case 'offline-no-cache':
      return 'The safety advisory could not be fetched and this browser has no verified copy, so this page will not connect a machine. Check the network and try again.';
    case 'offline-cache-too-old':
      return 'The safety advisory could not be fetched and the verified copy in this browser is more than 7 days old, so this page will not connect a machine. Check the network and try again.';
  }
}

export function refusalText(refusal: EntryRefusal): string {
  switch (refusal.kind) {
    case 'signed-out':
      return 'Sign in to connect. Connecting a machine needs a signed-in session. Pause, Stop and the other stop controls never need one.';
    case 'advisory':
      return advisoryText(refusal.check);
    case 'c1-incomplete':
      return 'Tick every box to connect.';
    case 'no-port':
    case 'open-failed':
      return refusal.message;
  }
}

/** The refusal dialog's title: the account notice names itself; every other refusal is "Not connected". */
export function refusedTitle(entry: EntryState | null): string {
  return entry?.step === 'refused' && entry.refusal.kind === 'signed-out' && !entry.refusal.signIn ? ACCOUNT_TITLE : 'Not connected';
}

function readTicks(form: HTMLFormElement): boolean[] {
  return [...form.querySelectorAll('input[type="checkbox"]')].map((el) => (el as HTMLInputElement).checked);
}

export function ConnectPanel(props: ConnectPanelProps): ComponentChild {
  const { state } = props;
  const connect = h('button', { type: 'button', class: 'button', 'data-action': 'connect', onClick: props.onConnect }, 'Connect');
  switch (state.step) {
    case 'idle':
      return h('div', { class: 'live-entry', 'data-entry': 'idle' }, connect);
    case 'checking':
      return h('div', { class: 'live-entry', 'data-entry': 'checking', role: 'status' }, h('p', null, 'Checking sign-in and the safety advisory…'));
    case 'opening':
      return h('div', { class: 'live-entry', 'data-entry': 'opening', role: 'status' }, h('p', null, 'Choose the port, then wait while the board is identified…'));
    case 'refused': {
      // Where no one can sign in yet (production): say so and what works meanwhile, with a Close (B1).
      const comingSoon = state.refusal.kind === 'signed-out' && !state.refusal.signIn;
      return h(
        'div',
        { class: 'live-entry', 'data-entry': 'refused', 'data-refusal': state.refusal.kind, ...(comingSoon ? { 'data-accounts': 'coming-soon' } : {}) },
        comingSoon
          ? h(AccountNotice, { signInHref: props.signInHref ?? null })
          : h('p', { role: 'alert' }, refusalText(state.refusal)),
        !comingSoon && state.refusal.kind === 'signed-out' && (props.signInHref ?? null) !== null
          ? h('p', null, h('a', { class: 'button', href: props.signInHref ?? '/auth/login', 'data-action': 'sign-in' }, 'Sign in'))
          : null,
        h('button', { type: 'button', class: 'button', 'data-action': 'dismiss', onClick: props.onCancel }, comingSoon ? 'Close' : 'OK'),
      );
    }
    case 'c1': {
      const list = c1Checklist(state.form);
      return h(
        'form',
        {
          class: 'live-entry c1',
          'data-entry': 'c1',
          // OD-30: after the first acceptance no checklist is shown; this form is then only the click the chooser needs.
          ...(state.form === 'full' ? { 'data-safety': 'C1' } : {}),
          'data-c1-form': state.form,
          onSubmit: (event: Event) => {
            event.preventDefault();
            props.onConfirm(readTicks(event.currentTarget as HTMLFormElement));
          },
        },
        list.intro === undefined ? null : h('p', null, list.intro),
        ...list.boxes.map((box, i) =>
          h('label', { class: 'c1-box', key: String(i) }, h('input', { type: 'checkbox', name: `c1-${i}`, required: true, 'aria-label': `${BOX} ${box}` }), ` ${box}`),
        ),
        h(
          'div',
          { class: 'c1-actions' },
          h('button', { type: 'submit', class: 'button', 'data-action': 'confirm' }, state.form === 'full' ? 'Confirm and choose port' : 'Choose port'),
          h('button', { type: 'button', class: 'button', 'data-action': 'cancel', onClick: props.onCancel }, 'Cancel'),
        ),
      );
    }
    case 'live':
      return h(
        'div',
        { class: 'live-entry', 'data-entry': 'live' },
        props.advisoryBlocked !== null && !props.advisoryBlocked.ok
          ? h(
              'p',
              { class: 'overlay-banner overlay-banner-warn', role: 'alert', 'data-advisory': props.advisoryBlocked.reason },
              `${advisoryText(props.advisoryBlocked)} New jobs, Start and jogging are refused. A running job, Pause and Stop are not affected.`,
            )
          : null,
        h('button', { type: 'button', class: 'button', 'data-action': 'disconnect', onClick: props.onDisconnect }, 'Disconnect'),
      );
  }
}
