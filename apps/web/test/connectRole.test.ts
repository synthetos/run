import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { accountIdentity } from '../src/live/account.ts';
import { ConnectPanel } from '../src/live/ConnectPanel.ts';
import type { EntryState } from '../src/live/liveEntry.ts';
import { all, byAttr, root, text } from './tree.ts';

const panel = (state: EntryState) => root(h(ConnectPanel, {
  state, advisoryBlocked: null, onConnect() {}, onConfirm() {}, onCancel() {}, onDisconnect() {},
}));
afterEach(() => { accountIdentity.value = null; });

describe('Connect account display', () => {
  it('members see the short explanation with no Connect or chooser control', () => {
    accountIdentity.value = { subject: 'usr_member', display: '@member', canConnect: false };
    for (const state of [{ step: 'idle' }, { step: 'c1', form: 'full', boxes: 0 }] as const) {
      const view = panel(state);
      expect(text(view)).toBe('Connecting is open to testers for now.');
      expect(all(view, e => e.tag === 'button')).toEqual([]);
    }
  });
  it('Connect is offered with the capability and signed-out behavior is retained', () => {
    for (const identity of [null, { subject: 'usr_tester', display: '@tester', canConnect: true }]) {
      accountIdentity.value = identity;
      expect(all(panel({ step: 'idle' }), byAttr('data-action', 'connect'))).toHaveLength(1);
    }
  });
  it('losing the displayed grant while live leaves Disconnect available', () => {
    accountIdentity.value = { subject: 'usr_member', display: '@member', canConnect: false };
    expect(all(panel({ step: 'live' }), byAttr('data-action', 'disconnect'))).toHaveLength(1);
  });
});
