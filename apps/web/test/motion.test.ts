/**
 * Phase 2 motion in the page (SAFETY §4.5b, H50–H53; T-S89, T-S91, T-S92): when the motion controls are
 * enabled and why not, the press-and-hold jog controller, the Go to zero path shown in C25, and the control
 * allowlist with a LIVE motion session (motion controls enabled only with the flag on, the preconditions met
 * and not in a job; Pause and Stop job enabled whenever LIVE).
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { STOP_TEXT, w34 } from '@synthetos/safety';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import { JogController, RENEW_MS, axesText, goToZeroPath, jogKey, machineZ, motionUi, workOffsets } from '../src/workspace/motion.ts';
import { JogSection, SpindleSection, ZeroSection, resetSpindleConfirm } from '../src/workspace/views/RunView.ts';
import { MachineStrip, outcomeText, STOP_JOB_PHASE2 } from '../src/workspace/MachineStrip.ts';
import { stripStatus } from '../src/workspace/status.ts';
import type { MotionCommand } from '../src/machine-worker/rpc.ts';

type Snapshot = NonNullable<LiveView['message']>['snapshot'];

function snap(extra: Record<string, unknown> = {}): Snapshot {
  return {
    base: 'IDLE_UNHOMED',
    overlays: [],
    primaryOverlay: null,
    epoch: 1,
    port: null,
    probe: null,
    identity: { fb: 450.01, fv: 0.97, hp: 1, hv: 8, id: 'SIM-EN-0001' },
    classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved', detail: '', upgradeOffer: false },
    footerRev: 3,
    live: { machineClass: 'programStop', stat: 3, hold: 0, vel: 0, home: 0, pos: {}, mpo: {} },
    values: {},
    fault: null,
    ackVerifying: false,
    blocked: null,
    notices: { adviseEstop: false },
    xoff: false,
    lastAckAt: null,
    stale: null,
    sent: { lines: 0, realtime: 0 },
    motion: null,
    ...extra,
  } as unknown as Snapshot;
}

function view(s: Snapshot | null, flag = true, axes: { axis: string; machine: number | null; work: number | null }[] = []): LiveView {
  if (s === null) return INITIAL_LIVE_VIEW;
  return {
    ...INITIAL_LIVE_VIEW,
    message: {
      v: 3,
      kind: 'snapshot',
      snapshot: s,
      dro: { axes: axes.map((a) => ({ ...a, homed: null })), machineSource: { label: 'polled mpo', at: null, ageMs: null, lag: 'none' }, workSource: { label: 'status report' }, units: 'mm', wcs: { code: null, offsets: null, total: null }, marker: null },
      lag: { amberMs: 1000, redMs: 2000 },
      motion: flag,
    } as unknown as LiveView['message'],
  };
}

describe('T-S92: motionUi decides when the motion controls are enabled', () => {
  it('enabled on an approved idle board with the flag on; homing state shown', () => {
    const ui = motionUi(view(snap()));
    expect(ui).toMatchObject({ enabled: true, reason: null, flag: true, homed: false, busy: false, held: false });
    expect(motionUi(view(snap({ live: { home: 1, pos: {}, mpo: {} }, base: 'IDLE_HOMED' }))).homed).toBe(true);
  });

  it('disabled, with a plain reason, in every other case', () => {
    const cases: [LiveView | null, string][] = [
      [null, 'Connect a machine'],
      [view(snap({ base: 'NOT_CONNECTED' })), 'Connect a machine'],
      [view(snap(), false), 'not enabled in this build'],
      [view(snap({ overlays: ['LOST'] })), 'connection is lost'],
      [view(snap({ overlays: ['FAULT'] })), 'fault is latched'],
      [view(snap({ overlays: ['ORPHANED_MOTION'] })), 'did not send'],
      [view(snap({ base: 'IDENTIFYING', classification: null })), 'Identifying'],
      [view(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly' } })), 'not approved'],
      [view(snap({ overlays: ['STALE'] })), 'No status'],
      [view(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'] })), 'confirm below'],
      [view(snap({ overlays: ['NEEDS_REVIEW'] })), 'Review them first'],
      [view(snap({ base: 'BLOCKED' })), 'not the selected board'],
      [view(snap({ base: 'RUNNING' })), 'job is in progress'],
      [view(snap({ base: 'ALARM' })), 'Clear the alarm'],
      [view(snap({ base: 'HELD', motion: { op: 'jog', phase: 'held', hold: false, held: true, stopping: false } })), 'Resume'],
      [view(snap({ base: 'STOPPING_JOB' })), 'Stopping'],
      [view(snap({ base: 'JOGGING', motion: { op: 'jog', phase: 'feed', hold: true, held: false, stopping: false } })), 'A move is running'],
      [view(snap({ base: 'CONNECTED_UNKNOWN' })), 'only available while the machine is idle'.replace('only', 'Only')],
    ];
    for (const [v, reason] of cases) {
      const ui = motionUi(v);
      expect(ui.enabled, reason).toBe(false);
      expect(ui.reason, reason).toContain(reason);
    }
    expect(motionUi(view(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'] }))).unknown).toBe(true);
    expect(motionUi(view(snap({ base: 'ALARM' }))).alarm).toBe(true);
    expect(motionUi(view(snap({ base: 'JOGGING', motion: { op: 'jog', phase: 'feed', hold: true, held: false, stopping: false } })))).toMatchObject({ busy: true, holdJog: true });
  });

  it('offsets, machine Z, the Go to zero path (Z first, never lower) and axis names', () => {
    const v = view(snap(), true, [
      { axis: 'x', machine: 12, work: 2 },
      { axis: 'y', machine: null, work: 0 },
      { axis: 'z', machine: -3, work: 1 },
    ]);
    expect(workOffsets(v)).toEqual({ x: 10, z: -4 });
    expect(workOffsets(null)).toEqual({});
    expect(machineZ(v)).toBe(-3);
    expect(machineZ(null)).toBeNull();
    expect(goToZeroPath(['x', 'y', 'z'], -1, -3)).toBe('Z up to machine -1 mm, then X and Y to work 0, then Z down to work 0');
    expect(goToZeroPath(['x'], -10, -3)).toBe('Z stays at machine -3 mm, then X to work 0');
    expect(goToZeroPath(['z'], 0, -3)).toBe('Z down to work 0');
    expect(goToZeroPath(['y'], 5, null)).toBe('Z up to machine 5 mm, then Y to work 0');
    expect(axesText(['x', 'y', 'z'])).toBe('X, Y and Z');
    expect(axesText([])).toBe('');
    const read = view(snap());
    (read.message as { dro: { wcs: { offsets: unknown } } }).dro.wcs.offsets = { x: 1.5 };
    expect(workOffsets(read)).toEqual({ x: 1.5 });
  });
});

describe('T-S89: the jog controller (press, hold, release)', () => {
  function rig() {
    const sent: MotionCommand[] = [];
    const intervals = new Map<number, () => void>();
    let next = 1;
    const c = new JogController((m) => sent.push(m), {
      setInterval: (fn, ms) => {
        expect(ms).toBe(RENEW_MS);
        intervals.set(next, fn);
        return next++;
      },
      clearInterval: (id) => intervals.delete(id as number),
    });
    return { c, sent, intervals };
  }

  it('a step press sends one jog of the chosen size and nothing on release', () => {
    const { c, sent, intervals } = rig();
    c.press({ x: 1 }, { stepMm: 10, feed: 900 });
    c.release();
    expect(sent).toEqual([{ op: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 900 }]);
    expect(intervals.size).toBe(0);
    expect(c.holding).toBe(false);
  });

  it('a hold press starts a hold jog and renews it until released; a second press meanwhile is ignored', () => {
    const { c, sent, intervals } = rig();
    c.press({ z: -1 }, { stepMm: null, feed: 300 });
    expect(c.holding).toBe(true);
    for (const fn of intervals.values()) {
      fn();
      fn();
    }
    c.press({ x: 1 }, { stepMm: null, feed: 300 });
    c.release();
    c.release();
    expect(sent).toEqual([{ op: 'jog', axes: { z: -1 }, distanceMm: null, feed: 300 }, { op: 'jogRenew' }, { op: 'jogRenew' }, { op: 'jogRelease' }]);
    expect(intervals.size).toBe(0);
  });

  it('jog keys: arrows for X and Y, Page Up and Page Down for Z, nothing else', () => {
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].map(jogKey)).toEqual([{ x: -1 }, { x: 1 }, { y: 1 }, { y: -1 }, { z: 1 }, { z: -1 }]);
    expect(jogKey('Enter')).toBeNull();
    expect(jogKey(' ')).toBeNull();
  });
});

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
    expect(html).toContain(w34().slice(w34().indexOf(' — ') + 3, w34().indexOf(' — ') + 30));
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
