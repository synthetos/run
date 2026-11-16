import { STOP_TEXT, w34 } from '@synthetos/safety';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { MachineStrip, outcomeText, STOP_JOB_PHASE2 } from '../src/workspace/MachineStrip.ts';
import { createWorkspaceModel, type LiveActions } from '../src/workspace/model.ts';
import { stripStatus } from '../src/workspace/status.ts';
import { JogSection, PositionPanel, resetSpindleConfirm, SpindleSection, ZeroSection } from '../src/workspace/views/RunView.ts';
import { snap, view, type Snapshot } from './runMotionHarness.ts';


describe('T-S92: control allowlist with a LIVE motion session', () => {
  function model(s: Snapshot | null, flag = true, motion = true) {
    const m = createWorkspaceModel();
    m.live.value = view(s, flag);
    m.actions.value = { ...({} as LiveActions), ...(motion ? { motion: () => Promise.resolve(null) } : {}) } as LiveActions;
    return m;
  }
  const machineButtons = (html: string, cls: string): { disabled: boolean }[] =>
    [...html.matchAll(new RegExp(`<(?:button|input)\\b[^>]*data-machine-control="${cls}"[^>]*>`, 'g'))].map((m) => ({ disabled: /\sdisabled(=|\s|\/|>|$)/.test(m[0]) }));
  const render = (m: ReturnType<typeof model>) => renderToString(h('div', null, h(JogSection, { model: m, onGoToZero: () => undefined }), h(ZeroSection, { model: m }), h(SpindleSection, { model: m })));

  it('enabled with the flag on, an approved idle board, no overlay and no job', () => {
    resetSpindleConfirm();
    const html = render(model(snap()));
    for (const cls of ['jog', 'zero', 'spindle', 'coolant']) {
      const list = machineButtons(html, cls);
      expect(list.length, cls).toBeGreaterThan(0);
      expect(list.every((b) => !b.disabled), cls).toBe(true);
    }
    // W34 is the Position readout's Not-homed tag help, not a box in the jog panel (OD-13, H51 as amended).
    expect(html).not.toContain(w34().slice(w34().indexOf(' — ') + 3, w34().indexOf(' — ') + 30));
    const position = renderToString(h(PositionPanel, { model: model(snap()) }));
    expect(position).toContain('data-position="homing"');
    expect(position).toContain(w34().slice(w34().indexOf(' — ') + 3, w34().indexOf(' — ') + 30));
  });

  it('disabled with the flag off, a read-only board, an overlay, an alarm or a job; spindle off stays enabled while connected with the flag', () => {
    const blocked = [
      model(snap(), false),
      model(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly' } })),
      model(snap({ overlays: ['STALE'] })),
      model(snap({ overlays: ['ORPHANED_MOTION'] })),
      model(snap({ base: 'ALARM' })),
      model(snap({ base: 'RUNNING' })),
      model(snap({ base: 'STOPPING_JOB' })),
      model(snap(), true, false),
    ];
    for (const m of blocked) {
      const html = render(m);
      for (const cls of ['jog', 'zero']) expect(machineButtons(html, cls).every((b) => b.disabled), cls).toBe(true);
      const spindle = machineButtons(html, 'spindle');
      expect(spindle.slice(1).every((b) => b.disabled)).toBe(true);
    }
    // Spindle off is stop-class: offered whenever a motion session is connected, never gated.
    expect(machineButtons(render(model(snap({ base: 'ALARM' }))), 'spindle')[0]?.disabled).toBe(false);
    expect(machineButtons(render(model(snap(), false)), 'spindle')[0]?.disabled).toBe(true);
  });

  it('a running hold jog keeps the jog buttons live so the release arrives', () => {
    const html = render(model(snap({ base: 'JOGGING', motion: { op: 'jog', phase: 'feed', hold: true, held: false, stopping: false } })));
    const pad = machineButtons(html, 'jog');
    expect(pad.slice(0, 10).filter((b) => !b.disabled).length).toBe(10);
  });

  it('the machine strip: Pause and Stop job enabled whenever LIVE; Resume only for this session\'s hold; plain stop words', () => {
    const live = { available: true, prominent: true, band: 'held' as const, outcome: null };
    const status = stripStatus(view(snap()), null);
    const held = renderToString(h(MachineStrip, { status, stop: live, previousSession: false, onPause: () => undefined, onStopJob: () => undefined, onResume: () => undefined, motion: true }));
    expect(held).toContain('data-machine-control="resume"');
    expect(held).toContain(STOP_JOB_PHASE2);
    expect(held).not.toMatch(/requested/i);
    const noResume = renderToString(h(MachineStrip, { status, stop: live, previousSession: false, onPause: () => undefined, onStopJob: () => undefined }));
    expect(noResume).not.toContain('data-machine-control="resume"');
    expect(outcomeText({ ...live, band: null, outcome: { kind: 'delivered', action: 'stopJob', machines: [{ machine: 'synthetos-machine:SIM', delivered: true }] } } as never, true)?.text).toBe('Stop job delivered to SIM.');
    const stopped = stripStatus(view(snap({ notices: { adviseEstop: false, motion: { kind: 'stopped', text: STOP_TEXT.stopped, at: 1 } } })), null);
    expect(stopped.text).toBe(STOP_TEXT.stopped);
    expect(stripStatus(view(snap({ base: 'STOPPING_JOB' })), null).title).toBe('Stopping');
  });
});