/**
 * ROADMAP P1-07, push-driven (amendment 2026-11-02): the DRO view, the live
 * marker and the drift report.
 *
 * - Machine and work position come from the connect-time read and then from
 *   pushed status reports (`live.mpo`, `live.pos`); nothing polls.
 * - Their age is the time since the board last said anything; the badge is
 *   amber at 80 % and red at 100 % of the silence window, or at STALE.
 * - A drift report raises NEEDS_REVIEW for its own link only.
 */
import { describe, expect, it } from 'vitest';
import { LAG_AMBER_MS, LAG_RED_MS, droView, lagOf, lagThresholds, snapshotOf, type SessionSnapshot } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT } from './simTransport.ts';

async function connectedEn(): Promise<Harness> {
  const h = harness('en', { device: { start: 'ready' } });
  void h.session.connect(PORT);
  await h.run(3000);
  expect(h.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
  expect(h.session.snapshot.classification?.dialectId).toBe('tinyg-en');
  return h;
}


function connectedDriver(): Driver {
  const d = new Driver();
  d.open();
  d.answer(EN_ANSWERS);
  expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  return d;
}

describe('droView: position from the connect-time read and pushed reports', () => {
  it('a pushed status report with mpo* moves the machine DRO, aged from the last line received', () => {
    const d = connectedDriver();
    d.at = 1000;
    d.line('{"sr":{"mpox":9,"mpoy":9,"mpoz":9,"posx":4}}');
    const s = snapshotOf(d.state);
    const v = droView(s, 1200);
    expect(v.axes.find((a) => a.axis === 'x')).toMatchObject({ axis: 'x', machine: 9, work: 4 });
    expect(v.machineSource).toEqual({ label: 'status report', at: 1000, ageMs: 200, lag: 'fresh' });
    // Nothing known yet: no source, no age.
    const empty = droView({ ...s, live: { ...s.live, mpo: {} } }, 1200);
    expect(empty.machineSource).toEqual({ label: 'status report', at: null, ageMs: null, lag: 'none' });
    expect(empty.marker).toBeNull();
  });

  it('mpo with read offsets places the marker in work coordinates, with source and age', () => {
    const base = snapshotOf(connectedDriver().state);
    const { coor: _coor, ...live } = base.live;
    const s: SessionSnapshot = {
      ...base,
      live: { ...live, mpo: { x: 110, y: 52, z: -5, a: 0 }, lastRxAt: 1000 },
      values: {
        ofs: { value: { x: 100, y: 50, z: -10, a: 0 }, status: 0, at: 900 },
        coor: { value: 1, status: 0, at: 900 },
        g54: { value: { x: 100, y: 50, z: -10 }, status: 0, at: 900 },
        hom: { value: { x: 1, y: 0, z: 1, e: 0 }, status: 0, at: 900 },
      },
    };
    const v = droView(s, 1300);
    expect(v.marker).toEqual({ x: 10, y: 2, z: 5, ageMs: 300, lag: 'fresh' });
    expect(v.machineSource).toEqual({ label: 'status report', at: 1000, ageMs: 300, lag: 'fresh' });
    expect(v.workSource).toEqual({ label: 'status report' });
    expect(v.wcs).toEqual({ code: 'G54', offsets: { x: 100, y: 50, z: -10 }, total: { x: 100, y: 50, z: -10, a: 0 } });
    expect(v.axes.slice(0, 3).map((a) => [a.axis, a.machine, a.homed])).toEqual([
      ['x', 110, true],
      ['y', 52, false],
      ['z', -5, true],
    ]);
    expect(v.units).toBe('mm');
    // Silence ages the badge against the snapshot's window; STALE turns it red at once.
    const { amberMs, redMs } = lagThresholds(s);
    expect(droView(s, 1000 + amberMs).machineSource.lag).toBe('amber');
    expect(droView(s, 1000 + redMs).machineSource.lag).toBe('red');
    const hb: SessionSnapshot = { ...s, link: { heartbeatMs: 1000, silenceMs: LAG_RED_MS } };
    expect(droView(hb, 1000 + LAG_AMBER_MS).machineSource.lag).toBe('amber');
    expect(droView({ ...s, overlays: ['STALE'] }, 1100).marker?.lag).toBe('red');
    // A clock behind the receive time never shows a negative age.
    expect(droView(s, 900).machineSource.ageMs).toBe(0);
  });

  it('shows no marker without read offsets or a full x/y/z', () => {
    const base = snapshotOf(connectedDriver().state);
    const live = { ...base.live, mpo: { x: 1, y: 2, z: 3 }, lastRxAt: 10 };
    const zero = { value: { x: 0, y: 0, z: 0 }, status: 0, at: 1 };
    expect(droView({ ...base, live, values: {} }, 20).marker).toBeNull();
    expect(droView({ ...base, live, values: { ofs: { value: { x: 0, y: 0 }, status: 0, at: 1 } } }, 20).marker).toBeNull();
    expect(droView({ ...base, live: { ...live, mpo: { x: 1, y: 2 } }, values: { ofs: zero } }, 20).marker).toBeNull();
    expect(droView({ ...base, live, values: { ofs: { ...zero, status: -1 } } }, 20).marker).toBeNull();
    expect(droView({ ...base, live, values: { ofs: zero } }, 20).marker).toMatchObject({ x: 1, y: 2, z: 3 });
  });

  it('WCS: G53, an unknown coor, an errored read, inches', () => {
    const base = snapshotOf(connectedDriver().state);
    const { unit: _unit, coor: _c, ...live } = base.live;
    const at = (coor: unknown, status = 0): SessionSnapshot => ({ ...base, live, values: { coor: { value: coor as number, status, at: 1 } } });
    expect(droView(at(0), 0).wcs).toEqual({ code: 'G53', offsets: null, total: null });
    expect(droView(at(6), 0).wcs.code).toBe('G59');
    expect(droView(at(7), 0).wcs.code).toBeNull();
    expect(droView(at(1.5), 0).wcs.code).toBeNull();
    expect(droView(at(-1), 0).wcs.code).toBeNull();
    expect(droView(at('1'), 0).wcs.code).toBeNull();
    expect(droView(at(1, 100), 0).wcs.code).toBeNull();
    expect(droView(at(1), 0).wcs.offsets).toBeNull();
    expect(droView(at(1), 0).units).toBeNull();
    expect(droView({ ...base, live: { ...base.live, unit: 0 } }, 0).units).toBe('in');
    expect(droView({ ...base, live, values: { unit: { value: 1, status: 0, at: 1 } } }, 0).units).toBe('mm');
    // A reported coor (pushed, or the connect-time read) wins over a request value.
    expect(droView({ ...base, live: { ...live, coor: 2 }, values: { coor: { value: 1, status: 0, at: 1 } } }, 0).wcs.code).toBe('G55');
  });

  it('lagOf', () => {
    expect(lagOf(null, true)).toBe('none');
    expect(lagOf(0, false)).toBe('fresh');
    expect(lagOf(LAG_AMBER_MS - 1, false)).toBe('fresh');
    expect(lagOf(LAG_AMBER_MS, false)).toBe('amber');
    expect(lagOf(LAG_RED_MS, false)).toBe('red');
    expect(lagOf(0, true)).toBe('red');
  });
});

describe('reportDrift: NEEDS_REVIEW', () => {
  it('raises NEEDS_REVIEW for the current link and ignores an earlier one', async () => {
    const h = await connectedEn();
    const epoch = h.session.snapshot.epoch;
    h.session.reportDrift(epoch - 1);
    expect(h.session.snapshot.overlays).not.toContain('NEEDS_REVIEW');
    h.session.reportDrift(epoch);
    expect(h.session.snapshot.overlays).toContain('NEEDS_REVIEW');
    // Kept as the reference (C23): resolved for the current link only, nothing written (OD-13 §5).
    const writes = (h.transports.at(-1) as { writes: unknown[] }).writes.length;
    h.session.resolveDrift(epoch - 1);
    expect(h.session.snapshot.overlays).toContain('NEEDS_REVIEW');
    h.session.resolveDrift(epoch);
    expect(h.session.snapshot.overlays).not.toContain('NEEDS_REVIEW');
    expect((h.transports.at(-1) as { writes: unknown[] }).writes.length).toBe(writes);
  });
});
