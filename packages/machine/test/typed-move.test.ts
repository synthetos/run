/**
 * H91 (owner 2026-11-09; docs/design/terminal-typed-moves.md): typed moves on the session, against the test-kit
 * edge-next model and on the pure reducer. Idle only, one line at a time, checked like a one-line job, sent through
 * the write gate's typed kind, confirmed by polled idle, and ended by Pause and Stop job the same way as a jog.
 */
import type { ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_1_RELEASE, PHASE_2_RELEASE, type Intent } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { TYPED_CHECK_TOKENS, TYPED_NO_FEED, TYPED_TEXT, TYPED_TOO_LONG, checkWrite, phase1WriteVerdict, type SessionEffect, type SessionIntent } from '../src/index.ts';
import { onTypedReadsIn } from '../src/session/typedMove.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

async function connected(options: { readonly motion?: boolean } = {}): Promise<Harness> {
  const h = harness('en', { device: { start: 'ready' }, session: { manifest: EN_APPROVED, release: options.motion === false ? PHASE_1_RELEASE : PHASE_2_RELEASE } });
  void h.session.connect(PORT);
  await h.run(3000);
  return h;
}

function writes(h: Harness): string[] {
  return (h.transports.at(-1)?.writes ?? []).map(shown);
}

/** The writes after `from` that are not GETs (lines and realtime bytes), LF shown as `\n`. */
function lines(h: Harness, from: number): string[] {
  return writes(h)
    .slice(from)
    .filter((w) => !w.startsWith('{"') && w !== '\\x05')
    .map((w) => w.replace(/\\n$/, ''));
}

/** Runs until the typed line has passed its check and is out (phase drain). */
async function untilSent(h: Harness): Promise<void> {
  for (let i = 0; i < 100 && h.session.snapshot.motion?.phase !== 'drain'; i++) await h.run(20);
  expect(h.session.snapshot.motion?.phase).toBe('drain');
}

function typed(h: Harness, line: string, travel?: string | null): ReturnType<Harness['session']['request']> {
  const r: SessionIntent = travel === undefined ? { intent: 'typedMove', line } : { intent: 'typedMove', line, travel };
  return h.session.request(r);
}

describe('H91: a typed move runs like a button move', () => {
  it('G0 X10: check reads first, then the exact line, then polled idle; done; modes are not put back', async () => {
    const h = await connected();
    const from = writes(h).length;
    expect(typed(h, 'g0 x10')).toEqual({ allowed: true });
    expect(h.session.snapshot.base).toBe('JOGGING');
    expect(h.session.snapshot.motion).toMatchObject({ op: 'typed', phase: 'check' });
    await h.run(3000);
    expect(lines(h, from)).toEqual(['G0 X10']);
    // The mode reads went out before the check reads, and both before the line.
    const w = writes(h).slice(from);
    expect(w.indexOf('{"unit":null}\\n')).toBeLessThan(w.indexOf('{"mpo":null}\\n'));
    expect(w.indexOf('{"home":null}\\n')).toBeLessThan(w.indexOf('G0 X10\\n'));
    expect(h.device.snapshot().position[0]).toBeCloseTo(10, 3);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.motion).toBeNull();
    expect(h.session.snapshot.notices.typed).toMatchObject({ kind: 'done', line: 'G0 X10', text: TYPED_TEXT.done });
  });

  it('a typed G91 stays G91: nothing restores it, and the board modes say Relative', async () => {
    const h = await connected();
    const from = writes(h).length;
    typed(h, 'G91 G1 X2 F600');
    await h.run(3000);
    expect(lines(h, from)).toEqual(['G91 G1 X2 F600']);
    expect(h.session.snapshot.boardModes).toMatchObject({ dist: 1, text: 'Relative, mm' });
    // The next one runs in G91 and uses the feed in effect (F600 was set by the line before).
    const next = writes(h).length;
    typed(h, 'G1 X2');
    await h.run(3000);
    expect(lines(h, next)).toEqual(['G1 X2']);
    expect(h.device.snapshot().position[0]).toBeCloseTo(4, 3);
  });

  it('one line in flight: a second request while one runs is denied', async () => {
    const h = await connected();
    expect(typed(h, 'G0 X30').allowed).toBe(true);
    expect(typed(h, 'G0 X1')).toMatchObject({ allowed: false, reason: 'Another move is still running.' });
    expect(h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 })).toMatchObject({ allowed: false, reason: 'Another move is still running.' });
    await h.run(6000);
    expect(h.session.snapshot.notices.typed?.kind).toBe('done');
    // The next typed move clears the last result while it runs.
    typed(h, 'G0 X31');
    expect(h.session.snapshot.notices.typed).toBeUndefined();
  });

  it('a line the grammar refuses is denied at once, and nothing is sent', async () => {
    const h = await connected();
    const from = writes(h).length;
    for (const bad of ['M3 S1000', 'G0', 'G1 X1 M8', 'G0 X1 G1 X2', 'T1 M6', 'G28.3 X0', '!', 'G4 P1 X2', 'G2 X10 F300']) {
      expect(typed(h, bad).allowed, bad).toBe(false);
    }
    await h.run(500);
    expect(lines(h, from)).toEqual([]);
    expect(h.session.snapshot.motion).toBeNull();
  });

  it('a feed move with no F and none in effect is refused after the check, before anything moves', async () => {
    const h = await connected();
    // The model board starts with a feed of 0: nothing in effect.
    const from = writes(h).length;
    expect(typed(h, 'G1 X5').allowed).toBe(true);
    await h.run(3000);
    expect(lines(h, from)).toEqual([]);
    expect(h.session.snapshot.notices.typed).toMatchObject({ kind: 'refused', line: 'G1 X5', text: TYPED_NO_FEED });
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });

  it('a move longer than one queued move is refused (SAFETY §4.3 ceiling)', async () => {
    const h = await connected();
    const from = writes(h).length;
    typed(h, 'G1 X100 F60');
    await h.run(3000);
    expect(lines(h, from)).toEqual([]);
    expect(h.session.snapshot.notices.typed).toMatchObject({ kind: 'refused', text: TYPED_TOO_LONG });
  });

  it('past travel on an axis not homed here: confirm with the finding; Move anyway with that exact finding sends it', async () => {
    const h = await connected();
    // The model board's X travel is 0..150 mm; one queued move is at most about 33 mm there (vm 800, k 0.5, 5 s).
    for (const x of [30, 60, 90, 120, 140]) {
      typed(h, `G0 X${x}`);
      await h.run(6000);
    }
    expect(h.device.snapshot().position[0]).toBeCloseTo(140, 3);
    const from = writes(h).length;
    typed(h, 'G0 X160');
    await h.run(3000);
    expect(lines(h, from)).toEqual([]);
    const notice = h.session.snapshot.notices.typed;
    expect(notice).toMatchObject({ kind: 'confirm', line: 'G0 X160', travel: { kind: 'outside', past: { axis: 'X', reach: 160, limit: 150 } } });
    expect(notice?.text).toBe("Run can't check this move against the travel: X would reach machine 160 mm, beyond its travel limit of 150 mm, and the X position was not set by a homing cycle in this connection.");
    // A confirmation for another finding does not count.
    typed(h, 'G0 X160', 'line 1: Y would reach machine 999 mm');
    await h.run(3000);
    expect(h.session.snapshot.notices.typed?.kind).toBe('confirm');
    expect(lines(h, from)).toEqual([]);
    typed(h, 'G0 X160', notice?.travel?.text ?? null);
    await h.run(6000);
    expect(lines(h, from)).toEqual(['G0 X160']);
    expect(h.session.snapshot.notices.typed?.kind).toBe('done');
  });

  it('a dwell runs and is done', async () => {
    const h = await connected();
    const from = writes(h).length;
    typed(h, 'G4 P0.2');
    await h.run(3000);
    expect(lines(h, from)).toEqual(['G4 P0.2']);
    expect(h.session.snapshot.notices.typed?.kind).toBe('done');
  });
});

describe('H91: Pause and Stop job during a typed move use the jog path', () => {
  it('Stop job mid-move: ! then %, the closing lines, "stopped"', async () => {
    const h = await connected();
    const from = writes(h).length;
    typed(h, 'G1 X20 F600');
    await untilSent(h);
    await h.run(600);
    expect(h.session.stopJob().allowed).toBe(true);
    await h.run(3000);
    const w = lines(h, from);
    expect(w[0]).toBe('G1 X20 F600');
    expect(w.slice(w.indexOf('!'))).toEqual(['!', '%', 'M5', 'M9', 'G90']);
    expect(h.device.snapshot().position[0] as number).toBeLessThan(20);
    expect(h.session.snapshot.notices.typed).toMatchObject({ kind: 'stopped', text: TYPED_TEXT.stopped });
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });

  it('Pause mid-move holds; Resume finishes it: done', async () => {
    const h = await connected();
    typed(h, 'G1 X20 F600');
    await untilSent(h);
    await h.run(600);
    expect(h.session.feedhold().allowed).toBe(true);
    await h.run(1000);
    expect(h.session.snapshot.base).toBe('HELD');
    expect(typed(h, 'G0 X1').allowed).toBe(false);
    expect(h.session.request({ intent: 'resume' }).allowed).toBe(true);
    await h.run(4000);
    expect(h.device.snapshot().position[0]).toBeCloseTo(20, 3);
    expect(h.session.snapshot.notices.typed?.kind).toBe('done');
  });

  it('Pause while the check reads are out: the line never goes out', async () => {
    const h = await connected();
    const from = writes(h).length;
    typed(h, 'G0 X10');
    h.session.feedhold();
    await h.run(3000);
    expect(lines(h, from).filter((l) => l.startsWith('G0'))).toEqual([]);
    expect(h.session.snapshot.notices.typed).toMatchObject({ kind: 'stopped', text: TYPED_TEXT.notSent });
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });
});

describe('H91: preconditions', () => {
  it('denied without a motion release', async () => {
    const p1 = await connected({ motion: false });
    expect(typed(p1, 'G0 X1')).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
  });
});

// --- The pure reducer with scripted answers: the silent board, an alarm, a refused line ---------------------------

const OK = '{"r":{},"f":[3,0,10]}';
const num = (token: string, v: number): string => `{"r":{"${token}":${v}},"f":[3,0,10]}`;
const group = (token: string, v: Record<string, number>): string => `{"r":{"${token}":${JSON.stringify(v)}},"f":[3,0,10]}`;
const AXIS = { am: 1, fr: 800, vm: 800, tn: 0, tm: 150, jm: 50, jh: 100 };
const ZEROS = { x: 0, y: 0, z: 0, a: 0, b: 0, c: 0 };
const CHECK: Record<string, string> = {
  ...Object.fromEntries(['x', 'y', 'z'].map((a) => [a, group(a, AXIS)])),
  ...Object.fromEntries(['a', 'b', 'c'].map((a) => [a, group(a, { am: 0 })])),
  ...Object.fromEntries(['g54', 'g55', 'g56', 'g57', 'g58', 'g59', 'g92', 'g28', 'g30', 'ofs'].map((g) => [g, group(g, ZEROS)])),
  mpo: group('mpo', ZEROS),
  plan: num('plan', 0),
  admo: num('admo', 1),
  gpl: num('gpl', 0),
  gun: num('gun', 1),
  gco: num('gco', 1),
  gdi: num('gdi', 0),
  feed: num('feed', 0),
};
const BASE: Record<string, string> = { ...EN_ANSWERS, ...CHECK, gc: OK, home: num('home', 0), unit: num('unit', 1), dist: num('dist', 0) };

function driver(): Driver {
  const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
  d.open();
  d.answer(BASE);
  expect(d.state.base).toBe('IDLE_UNHOMED');
  return d;
}

function written(d: Driver, from: number): string[] {
  return d.effects
    .slice(from)
    .filter((e): e is Extract<SessionEffect, { kind: 'writeLine' }> => e.kind === 'writeLine' && e.motion !== undefined)
    .map((e) => e.line);
}

describe('H91 on the reducer', () => {
  it('reads every check token the board can read, the last with the follow-up', () => {
    const d = driver();
    d.intent({ intent: 'typedMove', line: 'G0 X1' });
    const seeds = d.state.queue.filter((q) => q.purpose === 'seed');
    expect(seeds.map((q) => q.token)).toEqual([...TYPED_CHECK_TOKENS]);
    expect(seeds.at(-1)?.then).toBe('typedCheck');
    const pending = [...(d.state.writing === null ? [] : [d.state.writing]), ...d.state.queue];
    expect(pending.filter((q) => q.purpose === 'modes').map((q) => q.token)).toEqual(['unit', 'dist']);
  });

  it('a board that does not answer the check reads in time: nothing is sent', () => {
    const d = driver();
    const from = d.effects.length;
    d.intent({ intent: 'typedMove', line: 'G0 X1' });
    d.at += 5001;
    d.fire('motion');
    expect(d.state.motion).toBeNull();
    expect(d.state.base).toBe('IDLE_UNHOMED');
    expect(d.state.notices.typed).toMatchObject({ kind: 'refused', line: 'G0 X1', text: TYPED_TEXT.noAnswer });
    // The reads still answered later do not start anything.
    d.answer(BASE);
    expect(written(d, from)).toEqual([]);
    expect(d.state.motion).toBeNull();
  });

  it('a follow-up from an older move does not check a newer one before its own reads are in', () => {
    const d = driver();
    d.intent({ intent: 'typedMove', line: 'G0 X1' });
    d.at += 5001;
    d.fire('motion');
    // The first move's reads are still queued; the second move's come after them.
    d.at += 10;
    d.intent({ intent: 'typedMove', line: 'G0 X2' });
    const from = d.effects.length;
    d.answer(BASE, (t) => t === 'gc');
    expect(written(d, from)).toEqual(['G0 X2']);
  });

  it('a follow-up that finds another motion, or a check read missing, starts nothing', () => {
    const d = driver();
    d.intent({ intent: 'typedMove', line: 'G0 X1' });
    d.at += 5001;
    d.fire('motion');
    // A jog now runs while the old reads are answered: their follow-up leaves the jog alone.
    expect(d.intent({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 }).allowed).toBe(true);
    d.answer(BASE, (t) => t === 'gc');
    expect(d.state.motion?.op).toBe('jog');
    // A typed move whose check finds a read missing waits (the deadline still ends it).
    const fresh = driver();
    fresh.at += 10;
    fresh.intent({ intent: 'typedMove', line: 'G0 X1' });
    const t = { s: fresh.state, config: fresh.config, set: (patch: Partial<Driver['state']>) => (t.s = { ...t.s, ...patch }), emit: () => {}, arm: () => {}, cancel: () => {} };
    const { feed: _feed, ...values } = t.s.values;
    t.s = { ...t.s, values };
    onTypedReadsIn(t, fresh.at);
    expect(t.s.motion?.phase).toBe('check');
  });

  it('an alarm during a typed move ends it with words', () => {
    const d = driver();
    d.intent({ intent: 'typedMove', line: 'G0 X1' });
    d.answer(BASE, (t) => t === 'gc');
    expect(d.state.motion?.phase).toBe('drain');
    d.answer({ ...BASE, stat: num('stat', 2) }, () => d.state.base === 'ALARM');
    expect(d.state.base).toBe('ALARM');
    expect(d.state.notices.typed).toMatchObject({ kind: 'stopped', text: TYPED_TEXT.alarm });
    expect(d.intent({ intent: 'typedMove', line: 'G0 X1' }).allowed).toBe(false);
  });

  it('an alarm while the check reads are out: "not sent"', () => {
    const d = driver();
    d.intent({ intent: 'typedMove', line: 'G0 X1' });
    d.answer({ ...BASE, stat: num('stat', 2) }, (t) => t === 'x');
    d.line('{"sr":{"stat":2}}');
    expect(d.state.base).toBe('ALARM');
    expect(d.state.notices.typed).toMatchObject({ kind: 'stopped', text: TYPED_TEXT.notSent });
  });

  it('the board refuses the line: the move ends with the status in words', () => {
    const d = driver();
    d.intent({ intent: 'typedMove', line: 'G0 X1' });
    d.answer({ ...BASE, gc: '{"r":{},"f":[3,22,10]}' });
    expect(d.state.motion).toBeNull();
    expect(d.state.notices.typed).toMatchObject({ kind: 'refused', line: 'G0 X1', text: 'The controller refused G0 X1 (status 22).' });
  });

  it('the write gate admits the typed line only while it is being sent, and only from typedMove', () => {
    const d = driver();
    d.intent({ intent: 'typedMove', line: 'G90 G0 X0' });
    d.answer(BASE, (t) => t === 'gc');
    const w = d.state.writing;
    expect(w?.line).toBe('G90 G0 X0');
    const emitted = d.state;
    const bytes = new TextEncoder().encode('G90 G0 X0\n');
    // A typed line with a grammar shape (toZero) is still the typed kind.
    expect(checkWriteOf(d, bytes, 'typedMove', emitted)).toBeUndefined();
    expect(checkWriteOf(d, bytes, 'jog', emitted)).toMatchObject({ kind: 'refused' });
    expect(checkWriteOf(d, new TextEncoder().encode('G0 X9\n'), 'typedMove', emitted)).toMatchObject({ kind: 'refused' });
    // The typed kind keeps to the motion cap and needs the LF.
    const ctx = { readable: () => false, enqAllowed: false, motion: true, typedLine: () => true };
    expect(phase1WriteVerdict(new TextEncoder().encode(`G0 X${'1'.repeat(70)}\n`), ctx)).toMatchObject({ ok: false });
    expect(phase1WriteVerdict(new TextEncoder().encode('G0 X9'), ctx)).toMatchObject({ ok: false });
    expect(phase1WriteVerdict(new TextEncoder().encode('G0 X9\n'), ctx)).toEqual({ ok: true, kind: 'motion', lineKind: 'typed' });
    expect(phase1WriteVerdict(new TextEncoder().encode('G0 X9\n'), { ...ctx, motion: false })).toMatchObject({ ok: false });
    // After Stop job the line is held back, never a FAULT.
    d.intent({ intent: 'stopJob' });
    expect(checkWriteOf(d, bytes, 'typedMove', emitted)).toMatchObject({ kind: 'denied' });
  });
});

function checkWriteOf(d: Driver, bytes: Uint8Array, issuedBy: Intent, emitted: Driver['state']): ReturnType<typeof checkWrite> {
  return checkWrite(d.state, emitted, PHASE_2_RELEASE, bytes, 'motion', issuedBy);
}
