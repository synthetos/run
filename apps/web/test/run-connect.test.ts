import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { createWorkspaceModel, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import { ConnectNotice } from '../src/workspace/views/RunView.ts';
import { snap, view } from './runMotionHarness.ts';

function model(v: LiveView, motion = true) {
  const m = createWorkspaceModel();
  m.live.value = v;
  m.actions.value = { ...({} as LiveActions), ...(motion ? { motion: () => Promise.resolve(null) } : {}) } as LiveActions;
  return m;
}
describe('amendment 2026-11-02: homing, offsets and the ways out of UNKNOWN (T-S104–T-S106, control allowlist)', () => {


  it('the Connect card says what Run changed in the board\'s status reporting (W35, W36), and why it did not finish', () => {
    const reports = { phase: 'done', heartbeatMs: null, changes: [{ setting: 'sr' }, { setting: 'sv', from: 0, to: 1 }], detail: 'the board refused {si:250} (status 100)' };
    const html = renderToString(h(ConnectNotice, { model: model(view(snap({ reports }))), onView: () => undefined }));
    expect(html).toContain('data-safety="W35"');
    expect(html).toContain('status reports to include position, spindle, coolant and tool');
    expect(html).toContain('data-safety="W36"');
    expect(html).toContain('sv from 0 to 1');
    expect(html).toContain('Status reports: the board refused {si:250} (status 100).');
    expect(html).toContain('data-reports="no-heartbeat"');
    const quiet = renderToString(h(ConnectNotice, { model: model(view(snap({ reports: { phase: 'done', heartbeatMs: 1000, changes: [], detail: null } }))), onView: () => undefined }));
    expect(quiet).not.toContain('data-reports');
  });
});