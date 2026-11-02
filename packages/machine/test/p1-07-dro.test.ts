/**
 * ROADMAP P1-07: polled machine position, the DRO view, the live marker and
 * the drift report.
 *
 * - The marker and the machine DRO move only on polled `{"mpo":null}`
 *   reads, never on a status report that carries `mpo*` (SAFETY §4.2).
 * - The poller sends at most one `mpo` GET at a time, every 500 ms, only on
 *   a classified, connected link, and only through `session.read`.
 * - The lag badge is amber at 1 s and red at 2 s or STALE.
 * - A drift report raises NEEDS_REVIEW for its own link only.
 */
import { describe, expect, it } from 'vitest';
import type { TinyGEdgeNextModel } from '@synthetos/testkit';
import { LAG_AMBER_MS, LAG_RED_MS, MPO_POLL_ANSWER_MS, MPO_POLL_MS, PositionPoller, droView, lagOf, positionPollable, snapshotOf, type PollTarget, type SessionSnapshot } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT } from './simTransport.ts';

const decoder = new TextDecoder();

function lines(h: Harness): string[] {
  return h.endpoint.transcript
    .entries()
    .filter((e) => e.kind === 'host-write')
    .map((e) => decoder.decode(e.data));
}

async function connectedEn(): Promise<Harness> {
  const h = harness('en', { device: { start: 'ready' } });
  void h.session.connect(PORT);
  await h.run(3000);
  expect(h.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
  expect(h.session.snapshot.classification?.dialectId).toBe('tinyg-en');
  return h;
}

describe('PositionPoller on the simulated edge-next board', () => {
  it('polls {"mpo":null} every 500 ms, and the polled position follows the board', async () => {
    const h = await connectedEn();
    const poller = new PositionPoller(h.session, h.clock);
    poller.start();
    poller.start(); // idempotent
    const before = lines(h).length;
    await h.run(MPO_POLL_MS * 4 + 10);
    const polls = lines(h).slice(before).filter((l) => l === '{"mpo":null}\n');
    expect(polls.length).toBe(4);
    expect(poller.polls).toBe(4);
    expect(h.session.snapshot.values['mpo']?.value).toEqual({ x: 0, y: 0, z: 0, a: 0, b: 0, c: 0 });

    // Another program moved the machine: the polled position follows on the next poll.
    (h.device as TinyGEdgeNextModel).setMachinePosition({ x: 12.5, y: -3 });
    await h.run(MPO_POLL_MS + 10);
    expect(h.session.snapshot.values['mpo']?.value).toMatchObject({ x: 12.5, y: -3 });

    // Only GETs and the watchdog's ENQ reached the board.
    for (const l of lines(h)) expect(/^\{"?[a-z0-9]+"?:null\}\n$/.test(l) || l === '\u0005', JSON.stringify(l)).toBe(true);

    poller.stop();
    const stopped = lines(h).length;
    await h.run(MPO_POLL_MS * 4);
    expect(lines(h).slice(stopped).filter((l) => l === '{"mpo":null}\n')).toEqual([]);
  });

  it('does not poll before a board is classified, or after disconnect', async () => {
    const h = harness('en', { device: { start: 'ready' } });
    const poller = new PositionPoller(h.session, h.clock);
    poller.start();
    await h.run(MPO_POLL_MS * 3);
    expect(lines(h)).toEqual([]);
    void h.session.connect(PORT);
    await h.run(3000);
    expect(poller.polls).toBeGreaterThan(0);
    await h.session.disconnect();
    const n = poller.polls;
    await h.run(MPO_POLL_MS * 4);
    expect(poller.polls).toBe(n);
  });
});

/** A scripted target: the snapshot and the decision are set by the test. */
function target(snapshot: SessionSnapshot, allowed = true): PollTarget & { reads: string[][]; snap: SessionSnapshot; allowed: boolean } {
  const t = {
    reads: [] as string[][],
    snap: snapshot,
    allowed,
    get snapshot(): SessionSnapshot {
      return t.snap;
    },
    read(tokens: readonly string[]) {
      t.reads.push([...tokens]);
      return t.allowed ? { allowed: true as const } : { allowed: false as const, reason: 'no', remedy: 'no', citation: 'test' };
    },
  };
  return t;
}

function connectedDriver(): Driver {
  const d = new Driver();
  d.open();
  d.answer(EN_ANSWERS);
  expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  return d;
}

class FakeClock {
  t = 0;
  now(): number {
    return this.t;
  }
  #timers = new Map<number, { at: number; fn: () => void }>();
  #id = 1;
  setTimeout(fn: () => void, ms: number): number {
    const id = this.#id++;
    this.#timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const next = [...this.#timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (next === undefined || next[1].at > end) break;
      this.#timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}

describe('PositionPoller: one poll owed at a time', () => {
  it('skips ticks while a poll is unanswered, and gives it up after answerMs', () => {
    const d = connectedDriver();
    const t = target(snapshotOf(d.state));
    const clock = new FakeClock();
    const p = new PositionPoller(t, clock);
    p.start();
    clock.advance(MPO_POLL_MS);
    expect(t.reads).toEqual([['mpo']]);
    // Unanswered: the next ticks are skipped (flow budget).
    clock.advance(MPO_POLL_MS * 2);
    expect(t.reads).toHaveLength(1);
    // Answered: the next tick polls again.
    t.snap = { ...t.snap, values: { mpo: { value: { x: 1 }, status: 0, at: clock.t } } };
    clock.advance(MPO_POLL_MS);
    expect(t.reads).toHaveLength(2);
    // Unanswered for answerMs: given up, polled again.
    clock.advance(MPO_POLL_ANSWER_MS - MPO_POLL_MS);
    expect(t.reads).toHaveLength(2);
    clock.advance(MPO_POLL_MS);
    expect(t.reads).toHaveLength(3);
  });

  it('a new link does not wait for the old link\'s poll', () => {
    const d = connectedDriver();
    const t = target(snapshotOf(d.state));
    const clock = new FakeClock();
    const p = new PositionPoller(t, clock);
    p.start();
    clock.advance(MPO_POLL_MS);
    t.snap = { ...t.snap, epoch: t.snap.epoch + 1 };
    clock.advance(MPO_POLL_MS);
    expect(t.reads).toHaveLength(2);
  });

  it('a denied read is not counted and does not block the next tick', () => {
    const d = connectedDriver();
    const t = target(snapshotOf(d.state), false);
    const clock = new FakeClock();
    const p = new PositionPoller(t, clock);
    p.start();
    clock.advance(MPO_POLL_MS * 2);
    expect(t.reads).toHaveLength(2);
    expect(p.polls).toBe(0);
    t.allowed = true;
    clock.advance(MPO_POLL_MS);
    expect(p.polls).toBe(1);
    p.stop();
    p.stop();
    clock.advance(MPO_POLL_MS * 4);
    expect(t.reads).toHaveLength(3);
  });

  it('polls only on a classified, connected link that is not LOST or in FAULT', () => {
    const s = snapshotOf(connectedDriver().state);
    expect(positionPollable(s)).toBe(true);
    expect(positionPollable({ ...s, base: 'READING' })).toBe(false);
    expect(positionPollable({ ...s, classification: null })).toBe(false);
    expect(positionPollable({ ...s, classification: { ...(s.classification as NonNullable<SessionSnapshot['classification']>), dialectId: null } })).toBe(false);
    expect(positionPollable({ ...s, overlays: ['LOST'] })).toBe(false);
    expect(positionPollable({ ...s, overlays: ['FAULT'] })).toBe(false);
    expect(positionPollable({ ...s, overlays: ['READ_ONLY', 'NEEDS_REVIEW'] })).toBe(true);
  });
});

describe('droView: the marker moves only on polled reads', () => {
  it('a status report with mpo* changes neither the machine DRO nor the marker', () => {
    const d = connectedDriver();
    d.at = 1000;
    d.line('{"sr":{"mpox":9,"mpoy":9,"mpoz":9,"posx":4}}');
    const s = snapshotOf(d.state);
    expect(s.live.mpo).toMatchObject({ x: 9 });
    const v = droView(s, 1000);
    expect(v.axes.find((a) => a.axis === 'x')).toEqual({ axis: 'x', machine: null, work: 4, homed: null });
    expect(v.machineSource).toEqual({ label: 'polled mpo', at: null, ageMs: null, lag: 'none' });
    expect(v.marker).toBeNull();
  });

  it('a polled mpo with read offsets places the marker in work coordinates, with source and age', () => {
    const base = snapshotOf(connectedDriver().state);
    const s: SessionSnapshot = {
      ...base,
      values: {
        mpo: { value: { x: 110, y: 52, z: -5, a: 0 }, status: 0, at: 1000 },
        ofs: { value: { x: 100, y: 50, z: -10, a: 0 }, status: 0, at: 900 },
        coor: { value: 1, status: 0, at: 900 },
        g54: { value: { x: 100, y: 50, z: -10 }, status: 0, at: 900 },
        hom: { value: { x: 1, y: 0, z: 1, e: 0 }, status: 0, at: 900 },
      },
    };
    const v = droView(s, 1300);
    expect(v.marker).toEqual({ x: 10, y: 2, z: 5, ageMs: 300, lag: 'fresh' });
    expect(v.machineSource).toEqual({ label: 'polled mpo', at: 1000, ageMs: 300, lag: 'fresh' });
    expect(v.workSource).toEqual({ label: 'status report' });
    expect(v.wcs).toEqual({ code: 'G54', offsets: { x: 100, y: 50, z: -10 }, total: { x: 100, y: 50, z: -10, a: 0 } });
    expect(v.axes.slice(0, 3).map((a) => [a.axis, a.machine, a.homed])).toEqual([
      ['x', 110, true],
      ['y', 52, false],
      ['z', -5, true],
    ]);
    expect(v.units).toBe('mm');
    // Older polls age the badge; STALE turns it red at once.
    expect(droView(s, 1000 + LAG_AMBER_MS).machineSource.lag).toBe('amber');
    expect(droView(s, 1000 + LAG_RED_MS).machineSource.lag).toBe('red');
    expect(droView({ ...s, overlays: ['STALE'] }, 1100).marker?.lag).toBe('red');
    // A clock behind the receive time never shows a negative age.
    expect(droView(s, 900).machineSource.ageMs).toBe(0);
  });

  it('shows no marker without read offsets, a full x/y/z, or a good answer', () => {
    const base = snapshotOf(connectedDriver().state);
    const mpo = { value: { x: 1, y: 2, z: 3 }, status: 0, at: 10 };
    expect(droView({ ...base, values: { mpo } }, 20).marker).toBeNull();
    expect(droView({ ...base, values: { mpo, ofs: { value: { x: 0, y: 0 }, status: 0, at: 1 } } }, 20).marker).toBeNull();
    expect(droView({ ...base, values: { mpo: { ...mpo, value: { x: 1, y: 2 } }, ofs: { value: { x: 0, y: 0, z: 0 }, status: 0, at: 1 } } }, 20).marker).toBeNull();
    expect(droView({ ...base, values: { mpo: { ...mpo, status: -1 }, ofs: { value: { x: 0, y: 0, z: 0 }, status: 0, at: 1 } } }, 20).marker).toBeNull();
    expect(droView({ ...base, values: { mpo: { ...mpo, value: [1, 2, 3] }, ofs: { value: { x: 0, y: 0, z: 0 }, status: 0, at: 1 } } }, 20).marker).toBeNull();
    expect(droView({ ...base, values: { mpo: { ...mpo, value: { x: Number.NaN, y: 2, z: 3 } }, ofs: { value: { x: 0, y: 0, z: 0 }, status: 0, at: 1 } } }, 20).marker).toBeNull();
  });

  it('WCS: G53, an unknown coor, an errored read, inches', () => {
    const base = snapshotOf(connectedDriver().state);
    const { unit: _unit, ...live } = base.live;
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
  });
});
