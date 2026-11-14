import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { expect, it } from 'vitest';
import { UpdateFlow } from '../src/update/UpdateFlow.ts';
import { initialUpdateState, type UpdateController, type UpdateState } from '../src/update/controller.ts';
import type { SnapshotMessage } from '../src/machine-worker/rpc.ts';
import { initialState, snapshotOf } from '@synthetos/machine';
function html(patch: Partial<UpdateState> = {}, supported = true) {
  const controller = { state: signal({ ...initialUpdateState(), ...patch }) } as UpdateController;
  return renderToString(h(UpdateFlow, { controller, supported, failure: null }));
}
const message = (postFlash: Exclude<SnapshotMessage['postFlash'], undefined>): SnapshotMessage => ({ v: 3, kind: 'snapshot', snapshot: snapshotOf({ ...initialState(), base: 'CONNECTED_UNKNOWN', identity: { id: 'board', hv: 8, fb: 450.02 } }), dro: {} as SnapshotMessage['dro'], lag: { amberMs: 100, redMs: 200 }, motion: false, postFlash });
it('has no Connect in an unsupported browser and no workspace controls or navigation', () => {
  expect(html({}, false)).toContain('Use Chrome or Edge');
  expect(html({}, false)).not.toContain('data-action="update-connect"');
  expect(html()).toContain('data-action="update-connect"');
  expect(html()).not.toContain('href="/"');
  for (const text of ['Jog', 'Home', 'Console', 'Sign in', 'Custom firmware']) expect(html()).not.toContain(text);
});
it('requires mains confirmation before showing switch controls, and shows links only after clear', () => {
  const post = { boardId: 'board', phase: 'switchCheck' as const, differences: [], inputs: [], switchesChanged: true, baselineKeys: 1 };
  expect(html({ message: message(post) })).toContain('data-action="mains-confirm"');
  expect(html({ message: message(post) })).not.toContain('data-action="switch-test-done"');
  expect(html({ message: message(post), mainsConfirmed: true })).toContain('data-action="switch-test-done"');
  expect(html({ message: message(post), mainsConfirmed: true })).not.toContain('href="/"');
  expect(html({ message: message({ ...post, phase: 'clear' }) })).toContain('Done. Your TinyG runs 450.02.');
  expect(html({ message: message({ ...post, phase: 'clear' }) })).toContain('href="/"');
});
it('offers the saved backup before continuing, never an account destination', () => {
  const out = html({ backup: { file: null } });
  expect(out).toContain('data-action="backup-continue"');
  expect(out).toContain('raw EEPROM');
  expect(out).not.toContain('account');
});
