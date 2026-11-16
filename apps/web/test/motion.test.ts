/**
 * Phase 2 motion in the page (SAFETY §4.5b, H50–H53; T-S89, T-S91, T-S92): when the motion controls are
 * enabled and why not, the press-and-hold jog controller, the Go to zero path shown in C25, and the control
 * allowlist with a LIVE motion session (motion controls enabled only with the flag on, the preconditions met
 * and not in a job; Pause and Stop job enabled whenever LIVE).
 */
import { describe, expect, it } from 'vitest';

import { h } from 'preact';

import { renderToString } from 'preact-render-to-string';


import { createWorkspaceModel, type LiveActions, type LiveView } from '../src/workspace/model.ts';

import { activeSystem, axesText, goToZeroPath, homingView, JogController, jogKey, machineZ, motionUi, offsetsView, RENEW_MS, workOffsets } from '../src/workspace/motion.ts';

import { HomeSection, unknownApplies } from '../src/workspace/homing.ts';

import { UnknownModal } from '../src/workspace/unknownModal.ts';

import { ConnectNotice, ZeroSection } from '../src/workspace/views/RunView.ts';


import { stripStatus } from '../src/workspace/status.ts';

import type { MotionCommand } from '../src/machine-worker/rpc.ts';
import { snap, view, type Snapshot } from './runMotionHarness.ts';


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
      [view(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly' } })), 'isn’t on Run’s approved list (450.01, no build id)'],
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
describe('amendment 2026-11-02: homing, offsets and the ways out of UNKNOWN (T-S104–T-S106, control allowlist)',()=>{

  const HOMING = { xam: 1, xsn: 0, xsx: 1, xsv: 500, xtn: 0, xtm: 100, xlb: 2, yam: 1, ysn: 1, ysx: 0, ysv: 500, yam2: 0, zam: 1, zsn: 0, zsx: 0, zsv: 0, aam: 0, asn: 0, asx: 0, asv: 0 };

  function withSettings(s: Snapshot, settings: Record<string, number>, flag = true): LiveView {
    const v = view(s, flag);
    return { ...v, readout: { dialectId: 'tinyg-en', phase: { kind: 'recorded', hash: 'x' }, settings } } as LiveView;
  }

  function model(v: LiveView, motion = true) {
    const m = createWorkspaceModel();
    m.live.value = v;
    m.actions.value = { ...({} as LiveActions), ...(motion ? { motion: () => Promise.resolve(null) } : {}) } as LiveActions;
    return m;
  }

  const machineButtons = (html: string, cls: string): { disabled: boolean; text: string }[] =>
    [...html.matchAll(new RegExp(`<button\\b([^>]*data-machine-control="${cls}"[^>]*)>([^<]*)`, 'g'))].map((m) => ({ disabled: /\sdisabled(=|\s|\/|>|$)/.test(m[1] as string), text: m[2] as string }));
it('homingView: configured axes from the settings, why not otherwise, and when Home may be sent', () => {
    const hv = homingView(withSettings(snap(), HOMING), HOMING);
    expect(hv).toMatchObject({ enabled: true, reason: null, configured: ['x', 'y'], read: true, homing: false, searchMm: 102 });
    expect(hv.axes.z.reason).toBe('no switch is set for homing');
    expect(homingView(withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'] }), HOMING), HOMING).enabled).toBe(true);
    const cases: [LiveView | null, string][] = [
      [null, 'Connect a machine'],
      [withSettings(snap(), HOMING, false), 'not enabled in this build'],
      [withSettings(snap({ base: 'HOMING' }), HOMING), 'Homing.'],
      [withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly' } }), HOMING), 'isn’t on Run’s approved list'],
      [withSettings(snap({ overlays: ['STALE'] }), HOMING), 'No status'],
      [withSettings(snap({ base: 'ALARM' }), HOMING), 'alarm'],
      [withSettings(snap({ motion: { op: 'change', phase: 'drain', hold: false, held: false, stopping: false } }), HOMING), 'A move is running'],
    ];
    for (const [v, text] of cases) expect(homingView(v, HOMING).reason, text).toContain(text);
    expect(homingView(withSettings(snap(), {}), {}).read).toBe(false);
  });
it('offsetsView: the active system, its saved offset, the temporary offset and the total, as read', () => {
    const v = view(snap({ live: { coor: 2, pos: {}, mpo: {} }, values: { g55: { value: { x: 10, y: 5, z: -1 }, status: 0, at: 1 }, g92: { value: { x: 0, y: 2, z: 0 }, status: 0, at: 1 }, ofs: { value: { x: 10, y: 7, z: -1 }, status: 0, at: 1 } } }));
    expect(offsetsView(v)).toEqual({ system: 'G55', saved: { x: 10, y: 5, z: -1 }, temporary: { x: 0, y: 2, z: 0 }, temporaryInForce: true, total: { x: 10, y: 7, z: -1 } });
    expect(activeSystem(view(snap({ live: { coor: 0, pos: {}, mpo: {} } })))).toBeNull();
    expect(offsetsView(view(snap({ values: { g92: { value: [1], status: 0, at: 1 } } })))).toMatchObject({ system: null, saved: null, temporary: null, temporaryInForce: false });
  });
it('the Home tab: Home per configured axis and Home all; Set machine zero here (G28.3) offered whenever the machine is at rest (OD-13 §4)', () => {
    const live = renderToString(h(HomeSection, { model: model(withSettings(snap(), HOMING)) }));
    const buttons = machineButtons(live, 'home');
    expect(buttons.filter((b) => !b.disabled).map((b) => b.text)).toEqual(['Home', 'Home', 'Home all', 'Set machine zero here…']);
    // The switch column says min, max or none; the reason sits on the cell's title, not in the table (OD-13).
    expect(live).toContain('data-home-config="z" title="no switch is set for homing">none<');
    expect(live).not.toContain('Keep a hand');
    const none = renderToString(h(HomeSection, { model: model(withSettings(snap(), { xam: 1, xsn: 0, xsx: 0, xsv: 0, yam: 1, ysn: 0, ysx: 0, ysv: 0, zam: 1, zsn: 0, zsx: 0, zsv: 0, aam: 0, asn: 0, asx: 0, asv: 0 })) }));
    expect(machineButtons(none, 'home').filter((b) => !b.disabled).map((b) => b.text)).toEqual(['Set machine zero here…']);
    // Prerendered and without the flag: every control disabled.
    for (const html of [renderToString(h(HomeSection, { model: null })), renderToString(h(HomeSection, { model: model(withSettings(snap(), HOMING, false)) }))]) {
      expect(machineButtons(html, 'home').every((b) => b.disabled)).toBe(true);
    }
  });
it('the Offsets tab: G54–G59, Set work zero saved in the active system, the temporary offset apart, all disabled without motion', () => {
    const v = view(snap({ live: { coor: 1, pos: {}, mpo: {} }, values: { g54: { value: { x: 1, y: 2, z: 3 }, status: 0, at: 1 }, g92: { value: { x: 0, y: 0, z: 0 }, status: 0, at: 1 } } }));
    const html = renderToString(h(ZeroSection, { model: model(v) }));
    expect(html).toContain('Work zero');
    expect(html).toContain('G10 L20, saved on the controller');
    expect(html).toContain('Temporary offset');
    const offset = machineButtons(html, 'offset');
    expect(offset.map((b) => b.text)).toEqual(['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'X = 0', 'Y = 0', 'Z = 0', 'All = 0', 'Clear']);
    // The active system is selected (not offered again); Clear is offered only while a temporary offset is in force.
    expect(offset.filter((b) => b.disabled).map((b) => b.text)).toEqual(['G54', 'Clear']);
    expect(machineButtons(renderToString(h(ZeroSection, { model: null })), 'offset').every((b) => b.disabled)).toBe(true);
    expect(machineButtons(renderToString(h(ZeroSection, { model: model(v) })), 'zero').length).toBeGreaterThan(0);
  });
it('the UNKNOWN question on connect offers its exits; the strip says Homing and "No reports from the board"', () => {
    const unknown = withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'], primaryOverlay: 'UNKNOWN' }), HOMING);
    expect(unknownApplies(unknown)).toBe(true);
    const html = renderToString(h(UnknownModal, { model: model(unknown) }));
    expect(html).toContain('data-action="unknown-verify"');
    expect(html).toContain('data-action="unknown-home"');
    // Set machine zero here is offered whenever the machine is at rest, switches or not (OD-13 §4).
    expect(html).toContain('data-action="unknown-position"');
    const noSwitches = withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'], primaryOverlay: 'UNKNOWN' }), { xam: 1, xsn: 0, xsx: 0, xsv: 0 });
    expect(renderToString(h(UnknownModal, { model: model(noSwitches) }))).toContain('data-action="unknown-position"');
    // Without motion the verify exit is still there: UNKNOWN never traps.
    const p1 = renderToString(h(UnknownModal, { model: model(withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'], primaryOverlay: 'UNKNOWN' }), HOMING, false)) }));
    expect(p1).toContain('data-action="unknown-verify"');
    expect(p1).not.toContain('data-action="unknown-home"');
    expect(p1).not.toContain('data-action="unknown-position"');
    expect(renderToString(h(UnknownModal, { model: model(withSettings(snap(), HOMING)) }))).toBe('');
    expect(stripStatus(view(snap({ base: 'HOMING' })), null).title).toBe('Homing');
    expect(stripStatus(view(snap({ overlays: ['STALE'] })), null).title).toBe('No reports from the board');
  });
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
