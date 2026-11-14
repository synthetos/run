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

it('keeps Install disabled until the initial probe permits a settings backup', () => {
  const hub = { releases: { ok: true, list: { boards: [{ hv: 8, releases: [{ file: 'release.hex', fb: 450.02, changelog: 'Release' }] }] } }, settings: [], step: { kind: 'idle' } } as unknown as NonNullable<UpdateState['hub']>;
  const { postFlash: _post, ...probing } = message({ boardId: 'board', phase: 'clear', differences: [], inputs: [], switchesChanged: false, baselineKeys: 1 });
  const blocked = html({ hub, message: { ...probing, snapshot: { ...probing.snapshot, base: 'IDENTIFYING' } } });
  expect(blocked).toContain('Wait until the board is identified, read and at rest.');
  expect(blocked).toMatch(/<button[^>]*disabled[^>]*>Install/);
  const ready = html({ hub, message: { ...probing, snapshot: { ...probing.snapshot, classification: { dialectId: 'tinyg-en' } as NonNullable<SnapshotMessage['snapshot']['classification']> } } });
  expect(ready).toMatch(/<button class="primary">Install/);
});

it('describes confirmation as settings restore, not workspace position verification', () => {
  const m = message({ boardId: 'board', phase: 'restoreRequired', differences: [], inputs: [], switchesChanged: false, baselineKeys: 1 });
  const out = html({ message: { ...m, snapshot: { ...m.snapshot, overlays: ['UNKNOWN'] } } });
  expect(out).toContain('Allow settings restore');
  expect(out).toContain('workspace needs its own position check');
  expect(out).not.toContain('position verified');
});
