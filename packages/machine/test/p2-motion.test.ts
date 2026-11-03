/**
 * Phase 2 bench motion against the test-kit edge-next model (owner 2026-11-02; SAFETY §4.4, §4.5b,
 * H50–H56): T-S89 (jog state machine), T-S90 (stop sequence, Pause and Resume), T-S91 (go to zero),
 * T-S92 (preconditions). The session, the link and the model share one virtual clock.
 */
import type { ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_1_RELEASE, PHASE_2_RELEASE, STOP_TEXT } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { MOTION_LIMITS, type SessionIntent } from '../src/index.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

async function connected(options: { readonly manifest?: ApprovedBuilds; readonly motion?: boolean } = {}): Promise<Harness> {
  const h = harness('en', {
    device: { start: 'ready' },
    session: { manifest: options.manifest ?? EN_APPROVED, release: options.motion === false ? PHASE_1_RELEASE : PHASE_2_RELEASE },
  });
  void h.session.connect(PORT);
  await h.run(3000);
  return h;
}

function writes(h: Harness): string[] {
  return (h.transports.at(-1)?.writes ?? []).map(shown);
}

/** The writes after `from`, without the polled GETs and the position poll. */
function motionWrites(h: Harness, from: number): string[] {
  return writes(h)
    .slice(from)
    .filter((w) => (!w.startsWith('{"') || w.startsWith('{"clear"')) && w !== '\\x05');
}

function req(h: Harness, r: SessionIntent) {
  return h.session.request(r);
}

const JOG_X = (distanceMm: number | null, feed = 600): SessionIntent => ({ intent: 'jog', axes: { x: 1 }, distanceMm, feed });

describe('approved builds (P1-03) on the session', () => {
  it('useApprovedBuilds is taken only while not connected', async () => {
    const h = await connected({ manifest: { environment: 'staging', builds: [] } });
    expect(h.session.useApprovedBuilds(EN_APPROVED, 'later')).toBe(false);
    await h.session.disconnect();
    expect(h.session.useApprovedBuilds(EN_APPROVED, 'now')).toBe(true);
    expect(h.session.useApprovedBuilds(EN_APPROVED)).toBe(true);
    void h.session.connect(PORT);
    await h.run(3000);
    expect(h.session.snapshot.classification?.mode).toBe('full');
  });
});

describe('T-S92: preconditions', () => {
  it('an approved board in a Phase 2 session is idle (unhomed) and may jog; Phase 1 never may', async () => {
    const h = await connected();
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.overlays).toEqual([]);
    const p1 = await connected({ motion: false });
    expect(p1.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    const d = req(p1, JOG_X(1));
    expect(d).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
  });

  it('a board that is not approved is READ_ONLY and refuses every motion intent', async () => {
    const h = await connected({ manifest: { environment: 'staging', builds: [] } });
    expect(h.session.snapshot.overlays).toEqual(['READ_ONLY']);
    for (const r of [JOG_X(1), { intent: 'setWorkZero', axes: ['x'] }, { intent: 'spindleOn', output: 'spindle', direction: 'cw', rpm: 1000 }] as SessionIntent[]) {
      expect(req(h, r).allowed).toBe(false);
    }
  });

  it('refuses a second jog while one runs, bad axes, feeds and steps', async () => {
    const h = await connected();
    expect(req(h, { intent: 'jog', axes: {}, distanceMm: 1, feed: 600 }).allowed).toBe(false);
    expect(req(h, JOG_X(1, 0)).allowed).toBe(false);
    expect(req(h, JOG_X(1, MOTION_LIMITS.maxFeed + 1)).allowed).toBe(false);
    expect(req(h, JOG_X(500)).allowed).toBe(false);
    expect(req(h, JOG_X(10)).allowed).toBe(true);
    expect(req(h, JOG_X(1))).toMatchObject({ allowed: false, reason: 'Another move is still running.' });
  });
});

describe('T-S89: jog state machine', () => {
  it('a small step is one piece, then the modes are restored after polled idle', async () => {
    const h = await connected();
    const from = writes(h).length;
    expect(req(h, { intent: 'jog', axes: { x: 1, y: -1 }, distanceMm: 0.1, feed: 600 }).allowed).toBe(true);
    expect(h.session.snapshot.base).toBe('JOGGING');
    await h.run(2000);
    expect(motionWrites(h, from)).toEqual(['G21 G91 G1 X0.1 Y-0.1 F600\\n', 'G90\\n']);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.motion).toBeNull();
    expect(h.device.snapshot().position[0]).toBeCloseTo(0.1, 3);
  });

  it('a long step is fed in pieces, never more than the lookahead queued', async () => {
    const h = await connected();
    const from = writes(h).length;
    req(h, JOG_X(10, 1200)); // 20 mm/s: 3 mm pieces
    let maxQueued = 0;
    for (let i = 0; i < 100; i++) {
      await h.run(20);
      const qr = h.session.snapshot.live.qr;
      if (qr !== undefined) maxQueued = Math.max(maxQueued, 32 - qr);
    }
    await h.run(3000);
    const pieces = motionWrites(h, from).filter((w) => w.startsWith('G21'));
    expect(pieces).toEqual(['G21 G91 G1 X3 F1200\\n', 'G21 G91 G1 X3 F1200\\n', 'G21 G91 G1 X3 F1200\\n', 'G21 G91 G1 X1 F1200\\n']);
    expect(maxQueued).toBeLessThanOrEqual(MOTION_LIMITS.lookahead);
    expect(h.device.snapshot().position[0]).toBeCloseTo(10, 3);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });

  it('a hold jog runs while renewed and stops on release: ! then % once held, never left held', async () => {
    const h = await connected();
    const from = writes(h).length;
    req(h, JOG_X(null, 600));
    for (let i = 0; i < 10; i++) {
      await h.run(150);
      expect(req(h, { intent: 'jog', renew: true }).allowed).toBe(true);
    }
    expect(h.session.snapshot.motion).toMatchObject({ op: 'jog', hold: true });
    expect(req(h, { intent: 'feedhold', release: true }).allowed).toBe(true);
    await h.run(3000);
    const w = motionWrites(h, from);
    const bang = w.indexOf('!');
    expect(bang).toBeGreaterThan(0);
    expect(w.slice(bang)).toEqual(['!', '%', 'G90\\n']);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.live.hold).toBe(0);
    expect(h.device.snapshot().hold).toBe(0);
    // Bounded: 1.5 s of renewals at 10 mm/s is at most 15 mm plus the lookahead.
    expect((h.device.snapshot().position[0] as number)).toBeLessThan(15 + MOTION_LIMITS.lookahead * 1.5 + 1);
  });

  it('a hold jog the page stops renewing ends on its own (lost key-up, frozen page)', async () => {
    const h = await connected();
    req(h, JOG_X(null, 600));
    await h.run(3000);
    expect(h.session.snapshot.motion).toBeNull();
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.notices.motion?.kind).toBe('failed');
    const x = (h.device.snapshot().position[0] as number);
    expect(x).toBeLessThan(10 * ((MOTION_LIMITS.keepAliveMs + MOTION_LIMITS.lookahead * MOTION_LIMITS.pieceMs) / 1000 + 0.5));
    expect(writes(h)).toContain('%');
  });

  it('a lost link ends the feeder: nothing more is written', async () => {
    const h = await connected();
    req(h, JOG_X(null, 600));
    await h.run(200);
    h.endpoint.disconnect();
    await h.run(100);
    const n = writes(h).length;
    await h.run(2000);
    expect(writes(h).length).toBe(n);
    expect(h.session.snapshot.overlays).toContain('LOST');
    expect(h.session.snapshot.motion).toBeNull();
  });
});

describe('T-S90: stop sequence, Pause and Resume', () => {
  it('Stop job during a jog: !, polled hold, %, M5, M9, G90, then "Stopped"', async () => {
    const h = await connected();
    req(h, { intent: 'spindleOn', output: 'spindle', direction: 'cw', rpm: 12000 });
    await h.run(200);
    expect(h.device.snapshot().spindle).toBe('cw');
    const from = writes(h).length;
    req(h, JOG_X(50, 1200));
    await h.run(300);
    expect(h.session.stopJob().allowed).toBe(true);
    expect(h.session.snapshot.base).toBe('STOPPING_JOB');
    await h.run(3000);
    const w = motionWrites(h, from);
    expect(w.slice(w.indexOf('!'))).toEqual(['!', '%', 'M5\\n', 'M9\\n', 'G90\\n']);
    expect(h.session.snapshot.notices.motion).toMatchObject({ kind: 'stopped', text: STOP_TEXT.stopped });
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.device.snapshot().spindle).toBe('off');
    expect(h.device.snapshot().hold).toBe(0);
    expect((h.device.snapshot().position[0] as number)).toBeLessThan(50);
  });

  it('Stop job while idle sends no % (nothing held or queued) and still turns the outputs off', async () => {
    const h = await connected();
    const from = writes(h).length;
    h.session.stopJob();
    await h.run(2000);
    expect(motionWrites(h, from)).toEqual(['!', 'M5\\n', 'M9\\n', 'G90\\n']);
    expect(h.session.snapshot.notices.motion?.text).toBe(STOP_TEXT.stopped);
  });

  it('Pause holds this session\'s jog (HELD, "Paused"), Resume writes ~ and the jog finishes', async () => {
    const h = await connected();
    req(h, JOG_X(6, 600));
    await h.run(250);
    expect(h.session.feedhold().allowed).toBe(true);
    await h.run(1500);
    expect(h.session.snapshot.base).toBe('HELD');
    expect(h.session.snapshot.notices.motion).toMatchObject({ kind: 'paused', text: STOP_TEXT.paused });
    expect(h.session.snapshot.motion?.held).toBe(true);
    const from = writes(h).length;
    expect(req(h, { intent: 'resume' }).allowed).toBe(true);
    await h.run(3000);
    expect(motionWrites(h, from)).toEqual(['~', 'G90\\n']);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.notices.motion?.text).toBe(STOP_TEXT.resumed);
  });

  it('Resume is refused unless this session holds its own motion', async () => {
    const h = await connected();
    expect(req(h, { intent: 'resume' }).allowed).toBe(false);
    h.session.feedhold();
    await h.run(500);
    expect(req(h, { intent: 'resume' }).allowed).toBe(false);
    expect(writes(h)).not.toContain('~');
  });

  it('Spindle off while idle is M5 then M9; spindle or coolant alone sends one line', async () => {
    const h = await connected();
    let from = writes(h).length;
    h.session.spindleOffNow();
    await h.run(300);
    expect(motionWrites(h, from)).toEqual(['M5\\n', 'M9\\n']);
    from = writes(h).length;
    req(h, { intent: 'spindleOffNow', outputs: 'coolant' });
    await h.run(300);
    expect(motionWrites(h, from)).toEqual(['M9\\n']);
  });
});

describe('T-S91: go to zero, set zero', () => {
  it('raises Z first in machine coordinates (never lower), then X and Y, then Z, each after idle', async () => {
    const h = await connected();
    // Machine position is known from the connect-time read and then from pushed reports (no poller).
    expect(h.session.snapshot.live.mpo.z).toBe(0);
    req(h, { intent: 'jog', axes: { x: 1, y: 1 }, distanceMm: 5, feed: 3000 });
    await h.run(3000);
    req(h, { intent: 'setWorkZero', axes: ['x', 'y', 'z'] });
    await h.run(300);
    req(h, { intent: 'jog', axes: { x: 1, z: -1 }, distanceMm: 2, feed: 3000 });
    await h.run(3000);
    expect(h.session.snapshot.live.pos.x).toBeCloseTo(2, 3);
    const from = writes(h).length;
    expect(req(h, { intent: 'goToZero', axes: ['x', 'y', 'z'], safeZ: -5 }).allowed).toBe(true);
    await h.run(5000);
    // safeZ -5 is below the current machine Z (-2): Z is not lowered, it stays at -2 first.
    expect(motionWrites(h, from)).toEqual(['G53 G0 Z-2\\n', 'G90 G0 X0 Y0\\n', 'G90 G0 Z0\\n']);
    expect(h.session.snapshot.live.pos).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });

  it('set zero is G10 L20 P1 and moves the work position to 0', async () => {
    const h = await connected();
    req(h, JOG_X(3, 3000));
    await h.run(2000);
    const from = writes(h).length;
    req(h, { intent: 'setWorkZero', axes: ['x'] });
    await h.run(500);
    expect(motionWrites(h, from)).toEqual(['G10 L20 P1 X0\\n']);
    expect(h.device.settings.num('g54x')).toBeCloseTo(3, 3);
  });
});
