/**
 * ROADMAP P1-04: the read-only receive watchdog (SAFETY §4.2), STALE, LOST
 * and UNKNOWN.
 *
 * - T-S11 (idle subset): an idle board that answers the watchdog's proof-of-
 *   life requests never goes STALE; 2 s of unexpected silence after a
 *   request does.
 * - ENQ on edge-next after a rev-2/3 footer, at most one outstanding; a
 *   `stat` GET where ENQ is not available (440.21, or an ENQ still owed).
 * - T-S8 (read-only subset): the link dropping is LOST, nothing is written
 *   afterwards, and the next connect is UNKNOWN.
 */
import { BYTE, classifyLine } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMINGS, LIVENESS_TOKEN } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_READY_BANNER, TG_ANSWERS, tg } from './sessionDriver.ts';
import { harness } from './sessionHarness.ts';
import { PORT } from './simTransport.ts';

const { livenessIdleMs, staleAfterMs } = DEFAULT_TIMINGS;
const ACK = '{"ack":true}';

function connected(answers: Readonly<Record<string, string>>): Driver {
  const d = new Driver();
  d.open();
  d.answer(answers);
  expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  return d;
}

function enqCount(d: Driver): number {
  return d.realtime().filter((b) => b === BYTE.ENQ).length;
}

describe('T-S11 (idle subset): the watchdog on edge-next uses ENQ', () => {
  it('asks for proof of life after livenessIdleMs of silence, and an answered ENQ is never STALE', () => {
    const d = connected(EN_ANSWERS);
    expect(d.effects).toContainEqual(expect.objectContaining({ kind: 'armTimer', id: 'watchdog', ms: livenessIdleMs }));
    for (let i = 0; i < 100; i++) {
      d.at += livenessIdleMs;
      d.fire('watchdog');
      expect(d.last).toContainEqual({ kind: 'writeRealtime', epoch: d.state.epoch, name: 'enq', byte: BYTE.ENQ });
      expect(d.state.liveness).toEqual({ since: d.at, via: 'enq' });
      expect(d.last).toContainEqual(expect.objectContaining({ kind: 'armTimer', id: 'watchdog', ms: staleAfterMs }));
      d.at += 30;
      d.line(ACK);
      expect(d.state.liveness).toBeNull();
      expect(d.state.enqOutstanding).toBe(false);
      expect(d.last).toContainEqual(expect.objectContaining({ kind: 'armTimer', id: 'watchdog', ms: livenessIdleMs }));
    }
    expect(d.state.overlays).not.toContain('STALE');
    expect(enqCount(d)).toBe(100);
    // An idle EN board with ENQ gets no extra GETs from the watchdog.
    expect(d.lines().filter((l) => l === `{"${LIVENESS_TOKEN}":null}`)).toHaveLength(1); // the READING read only
  });

  it('a board that talks on its own keeps the watchdog quiet (receive timestamps are the liveness)', () => {
    const d = connected(EN_ANSWERS);
    const before = d.realtime().length;
    for (let i = 0; i < 50; i++) {
      d.at += livenessIdleMs / 2;
      d.line('{"sr":{"posx":1.5,"stat":1}}');
    }
    expect(d.realtime().length).toBe(before);
    expect(d.state.timers.watchdog).toBeDefined();
  });

  it('no byte within 2 s of the ENQ is STALE; the ENQ stays outstanding, so the next request is a stat GET', () => {
    const d = connected(EN_ANSWERS);
    const lastRx = d.at;
    d.at += livenessIdleMs;
    d.fire('watchdog');
    expect(d.state.enqOutstanding).toBe(true);
    d.at += staleAfterMs - 1;
    expect(d.state.overlays).not.toContain('STALE');
    d.at += 1;
    d.fire('watchdog');
    expect(d.state.overlays).toContain('STALE');
    expect(d.state.stale).toEqual({ at: d.at, silentForMs: d.at - lastRx });
    // At most one ENQ outstanding (SAFETY §4.2): the watchdog falls back to a GET.
    expect(enqCount(d)).toBe(1);
    expect(d.writing).toBe(LIVENESS_TOKEN);
    expect(d.state.liveness).toMatchObject({ via: 'get' });
    // STALE never blocks the stop-class intents (SAFETY §4.1 normative rule).
    expect(d.intent({ intent: 'feedhold' })).toEqual({ allowed: true });
    // Any line received clears it.
    d.written();
    d.at += 100;
    d.line(EN_ANSWERS['stat'] as string);
    expect(d.state.overlays).not.toContain('STALE');
    expect(d.state.stale).toBeNull();
    expect(d.state.live.lastRxAt).toBe(d.at);
  });

  it('STALE persists while the board stays silent, and the watchdog keeps asking without piling up reads', () => {
    const d = connected(EN_ANSWERS);
    for (let i = 0; i < 10; i++) {
      d.at += 1000;
      d.fire('watchdog');
      if (d.writing !== undefined) d.written();
    }
    expect(d.state.overlays).toContain('STALE');
    expect(d.state.queue.length).toBeLessThanOrEqual(1);
    expect(enqCount(d)).toBe(1);
  });

  it('a reset banner clears the owed ENQ (it was answered before the banner or lost with the RX ring)', () => {
    const d = connected(EN_ANSWERS);
    d.at += livenessIdleMs;
    d.fire('watchdog');
    expect(d.state.enqOutstanding).toBe(true);
    d.line(EN_READY_BANNER);
    expect(d.state.enqOutstanding).toBe(false);
    expect(d.state.overlays).toEqual(expect.arrayContaining(['FAULT', 'UNKNOWN']));
  });
});

describe('T-S11 (idle subset): the watchdog without ENQ uses a stat GET', () => {
  it('440.21 (rev-1 footers): never ENQ; a stat GET, STALE when it goes unanswered', () => {
    const d = connected(TG_ANSWERS);
    d.at += livenessIdleMs;
    d.fire('watchdog');
    expect(d.writing).toBe(LIVENESS_TOKEN);
    d.written();
    d.at += 20;
    d.line(TG_ANSWERS['stat'] as string);
    expect(d.state.overlays).not.toContain('STALE');
    expect(d.state.live.stat).toBe(1);
    // An error answer is still an answer (proof of life); its value is not kept.
    d.at += livenessIdleMs;
    d.fire('watchdog');
    d.written();
    d.line(tg('{}', 100));
    expect(d.state.overlays).not.toContain('STALE');
    expect(d.state.live.stat).toBe(1);
    d.at += livenessIdleMs;
    d.fire('watchdog');
    d.written();
    d.at += staleAfterMs;
    d.fire('watchdog');
    expect(d.state.overlays).toContain('STALE');
    expect(enqCount(d)).toBe(0);
  });

  it('a read already owed is the proof of life to wait for: no extra GET is queued', () => {
    const d = connected(TG_ANSWERS);
    expect(d.intent({ intent: 'read', tokens: ['qr'] })).toEqual({ allowed: true });
    expect(d.writing).toBe('qr');
    d.at += livenessIdleMs;
    d.fire('watchdog');
    expect(d.state.queue).toEqual([]);
    expect(d.state.liveness).toMatchObject({ via: 'get' });
  });
});

describe('the watchdog runs only on a classified, connected link', () => {
  it('BLOCKED (another board): no watchdog, nothing written', () => {
    const d = new Driver();
    d.open('SOMEONE-ELSE');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('BLOCKED');
    expect(d.state.timers.watchdog).toBeUndefined();
  });

  it('not while identifying (the probe has its own silence rules)', () => {
    const d = new Driver();
    d.open();
    expect(d.state.timers.watchdog).toBeUndefined();
  });
});

describe('T-S8 (read-only subset): LOST, nothing written afterwards, UNKNOWN on the next connect', () => {
  it('the watchdog stops at LOST; a late watchdog event writes nothing', () => {
    const d = connected(EN_ANSWERS);
    const seq = d.state.timers.watchdog as number;
    d.feed({ type: 'linkLost', epoch: d.state.epoch, at: d.at });
    expect(d.state.overlays[0]).toBe('LOST');
    expect(d.last).toContainEqual({ kind: 'cancelTimer', id: 'watchdog' });
    expect(d.state.timers.watchdog).toBeUndefined();
    const writes = d.lines().length + d.realtime().length;
    d.feed({ type: 'timer', id: 'watchdog', seq, at: d.at + 5000 });
    d.feed({ type: 'inbound', epoch: d.state.epoch, at: d.at, event: classifyLine(ACK) });
    expect(d.intent({ intent: 'read', tokens: ['posx'] }).allowed).toBe(false);
    expect(d.lines().length + d.realtime().length).toBe(writes);
    expect(d.intent({ intent: 'acknowledgeLost' })).toEqual({ allowed: true });
    d.open();
    expect(d.state.overlays).toContain('UNKNOWN');
    expect(d.lines().at(-1)).toBe('{"sr":null}');
  });

  it('against both firmware models: the link drops at random points, nothing is written after LOST, and the reconnect is UNKNOWN', async () => {
    for (const model of ['en', '440'] as const) {
      for (const atByte of [40, 400, 900, 1600]) {
        const h = harness(model, { faults: { faults: [{ kind: 'disconnect', direction: 'toHost', atByte }] } });
        void h.session.connect(PORT);
        await h.run(8000);
        const first = h.transports[0];
        expect(first, `${model}@${atByte}`).toBeDefined();
        if (!h.session.snapshot.overlays.includes('LOST')) continue; // the session finished before the cut
        const written = first?.writes.length;
        await h.run(10_000);
        expect(first?.writes.length, `${model}@${atByte}: written after LOST`).toBe(written);
        expect(h.session.acknowledgeLost()).toEqual({ allowed: true });
      }
    }
  });
});

describe('T-S11 (idle subset) against the firmware models', () => {
  it('edge-next: an idle board answering ENQ stays fresh for a minute; 2 s of silence after an ENQ is STALE; recovery clears it', async () => {
    const silentFrom = 20_000;
    const h = harness('en', { faults: { faults: [{ kind: 'latency', direction: 'toHost', fromMs: silentFrom, toMs: silentFrom + 6000, extraMs: 8000 }] } });
    void h.session.connect(PORT);
    await h.run(silentFrom - 1);
    expect(h.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    expect(h.session.snapshot.overlays).not.toContain('STALE');
    const rt = h.session.snapshot.sent.realtime;
    expect(rt).toBeGreaterThan(5);
    await h.run(livenessIdleMs + staleAfterMs + 1500);
    expect(h.session.snapshot.overlays).toContain('STALE');
    expect(h.session.snapshot.stale?.silentForMs).toBeGreaterThanOrEqual(staleAfterMs);
    await h.run(10_000);
    expect(h.session.snapshot.overlays).not.toContain('STALE');
  });

  it('440.21: an idle board answering stat GETs stays fresh; ENQ is never written', async () => {
    const h = harness('440');
    void h.session.connect(PORT);
    await h.run(60_000);
    expect(h.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    expect(h.session.snapshot.overlays).not.toContain('STALE');
    const writes = (h.transports[0]?.writes ?? []).map((w) => new TextDecoder().decode(w));
    expect(writes.filter((w) => w === `{"${LIVENESS_TOKEN}":null}\n`).length).toBeGreaterThan(20);
    expect(writes.some((w) => w.includes('\u0005'))).toBe(false);
  });
});
