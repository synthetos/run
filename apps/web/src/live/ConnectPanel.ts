/**
 * The Connect panel (ROADMAP P1-05): the Connect button, C1 (SAFETY §6), the
 * LIVE entry refusals, and the advisory banner while connected (H27).
 * Reads the displayed account grant; live/liveEntry.ts holds entry state. C1 text
 * comes from @synthetos/safety only (T-S32).
 */
import { accountIdentity } from './account.ts';
import { h, type ComponentChild } from 'preact';
import type { AdvisoryCheck } from './advisoryGate.ts';
import { ACCOUNT_TITLE } from './accountNotice.ts';
import { ConnectRefusal } from './ConnectRefusal.ts';
import { ConnectChecklist } from './ConnectChecklist.ts';
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

export function ConnectPanel(props: ConnectPanelProps): ComponentChild {
  const { state } = props;
  if (state.step !== 'live' && accountIdentity.value?.canConnect === false) {
    return h('p', { class: 'fine', 'data-connect': 'role-required' }, 'Connecting is open to testers for now.');
  }
  const connect = h('button', { type: 'button', class: 'button', 'data-action': 'connect', onClick: props.onConnect }, 'Connect');
  switch (state.step) {
    case 'idle':
      return h('div', { class: 'live-entry', 'data-entry': 'idle' }, connect);
    case 'checking':
      return h('div', { class: 'live-entry', 'data-entry': 'checking', role: 'status' }, h('p', null, 'Checking sign-in and the safety advisory…'));
    case 'opening':
      return h('div', { class: 'live-entry', 'data-entry': 'opening', role: 'status' }, h('p', null, 'Choose the port, then wait while the board is identified…'));
    case 'refused':
      return h(ConnectRefusal, { refusal: state.refusal, message: refusalText(state.refusal), signInHref: props.signInHref ?? null, onCancel: props.onCancel });
    case 'c1':
      return h(ConnectChecklist, { form: state.form, onConfirm: props.onConfirm, onCancel: props.onCancel });
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
