import { h, type ComponentChild } from 'preact';
import { accountState, signInHref } from '../../../live/account.ts';
import { ConnectPanel, refusedTitle } from '../../../live/ConnectPanel.ts';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import { DialogWrap } from '../../dialogs/DialogWrap.ts';
import { connected, type LiveActions, type LiveView, type WorkspaceModel } from '../../model.ts';
import { reportsNotice } from '../../reportsNotice.ts';
import { belowStrip } from '../../ui.ts';


// ---------------------------------------------------------------- connect

/** The Connect card: the existing LIVE entry flow (live/ConnectPanel.ts), restyled. C1 opens as a dialog. */
export function ConnectNotice({ model, onView, compact = false }: { readonly model: WorkspaceModel | null; readonly onView?: (view: string) => void; readonly compact?: boolean }): ComponentChild {
  const { isConnected, step, view, actions, panel } = connectionState({ model });
  const heading = isConnected
    ? 'Connected'
    : step === 'refused'
      ? 'Not connected'
      : 'Connect your TinyG';
  const copy = isConnected
    ? view?.message?.motion === true
      ? 'Controls follow the machine’s current state.'
      : connectionCopy({ view })
    : 'Connect by USB to read your board and check its setup.';
  if (compact) {
    // In the machine strip (owner, 2026-11-03): the Connect flow beside the state, nothing said twice.
    return compactConnect({ step, view, actions, panel });
  }
  return h(
    'div',
    { class: `scenario-notice connect-notice${isConnected ? ' is-connected' : ''}`, 'data-region': 'connect' },
    h('div', { class: 'notice-text' }, h('strong', null, heading), h(ContextHelp, { id: 'connect-help', label: 'About connecting', below: true, end: true }, copy), reportsNotice(view)),
    connectActions({ step, panel, isConnected, actions, onView }),
    step === 'c1'
      ? h(
        DialogWrap,
        { class: 'dialog-wrap', role: 'presentation', onDismiss: () => actions?.cancel() },
        h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'c1-title' }, h('div', { class: 'dialog-head' }, h('h2', { id: 'c1-title' }, 'Before you connect')), panel),
      )
      : null,
  );
}

function connectionState({ model }: { readonly model: WorkspaceModel | null }) {
  const view = model?.live.value ?? null;
  const actions = model?.actions.value ?? null;
  const step = view?.entry.step ?? 'idle';
  const isConnected = view !== null && connected(view);
  const account = accountState.value;
  const panel = h(ConnectPanel, {
    state: view?.entry ?? { step: 'idle' },
    advisoryBlocked: view?.advisoryBlocked ?? null,
    onConnect: () => actions?.connect(),
    onConfirm: (ticked) => actions?.confirm(ticked),
    onCancel: () => actions?.cancel(),
    onDisconnect: () => actions?.disconnect(),
    signInHref: account.signIn ? signInHref(typeof location === 'undefined' ? '/' : location.pathname) : null,
  });
  return { isConnected, step, view, actions, panel };
}

function connectionCopy({ view }: { readonly view: LiveView | null }) {
  return view?.message?.settingsWrites === true
    ? 'Review and apply settings in Board.'
    : 'Read-only connection.';
}

function connectActions({ step, panel, isConnected, actions, onView }: { readonly step: string; readonly panel: ComponentChild; readonly isConnected: boolean; readonly actions: LiveActions | null; readonly onView: ((view: string) => void) | undefined }): ComponentChild {
  return h(
    'div',
    { class: 'notice-actions' },
    step === 'c1' ? null : panel,
    // The port is open or opening but LIVE entry has not finished (or ended elsewhere): Disconnect still applies.
    isConnected && step !== 'live' && step !== 'c1' ? h('button', { type: 'button', class: 'button', 'data-action': 'disconnect', onClick: () => actions?.disconnect() }, 'Disconnect') : null,
    isConnected && onView !== undefined ? h('button', { type: 'button', class: 'small', onClick: () => onView('board') }, 'Open the board') : null
  );
}

function compactConnect({ step, view, actions, panel }: { readonly step: string; readonly view: LiveView | null; readonly actions: LiveActions | null; readonly panel: ComponentChild }): ComponentChild {
  return h(
    'div',
    { class: 'connect-notice compact', 'data-region': 'connect' },
    step === 'c1' || step === 'refused' ? (step === 'refused' ? h(ConnectPanel, { state: { step: 'idle' }, advisoryBlocked: view?.advisoryBlocked ?? null, onConnect: () => actions?.connect(), onConfirm: () => undefined, onCancel: () => undefined, onDisconnect: () => undefined }) : null) : panel,
    // A refusal is a modal below the strip (OD-16), not text squeezed into it.
    step === 'refused'
      ? h('div', { class: 'dialog-wrap confirm-modal', role: 'presentation', ref: belowStrip }, h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'refused-title' }, h('div', { class: 'dialog-head' }, h('h2', { id: 'refused-title' }, refusedTitle(view?.entry ?? null))), panel))
      : null,
    step === 'c1'
      ? stripDialog({ actions, panel })
      : null
  );
}

function stripDialog({ actions, panel }: { readonly actions: LiveActions | null; readonly panel: ComponentChild }): ComponentChild {
  return h(
    DialogWrap,
    {
      onDismiss: () => actions?.cancel(),
      class: 'dialog-wrap strip-dialog',
      role: 'presentation',
      // In the strip the dialog would be cut to the strip's height: it covers the page below the strip instead,
      // never the stop controls (SAFETY §4.1 UI rules).
      setup: (el: HTMLElement | null) => {
        const bottom = el?.closest('.statebar')?.getBoundingClientRect().bottom;
        if (el !== null && bottom !== undefined) el.style.setProperty('--strip-bottom', `${Math.round(bottom)}px`);
      },
    },
    h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'c1-title' }, h('div', { class: 'dialog-head' }, h('h2', { id: 'c1-title' }, 'Before you connect')), panel)
  );
}
