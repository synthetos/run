import { describe, expect, it } from 'vitest';
import type { MotionCommand } from '../src/machine-worker/rpc.ts';
import { type LiveView } from '../src/workspace/model.ts';
import { axesText, goToZeroPath, JogController, jogKey, machineZ, motionUi, RENEW_MS, workOffsets } from '../src/workspace/motion.ts';
import { snap, view } from './runMotionHarness.ts';


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
      [view(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly' } })), 'Read only: firmware 450.01 is not approved.'],
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