import { BYTE } from '@synthetos/protocol';
import { allowed } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { matrixSnapshot, type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_READY_BANNER } from './sessionDriver.ts';
import { EN_APPROVED, connected, realtime } from './sessionReducerFixtures.ts';

describe('ORPHANED_MOTION (PN §2.3 step 0; SAFETY H14)', () => {

  it('no answer to {sr:null} within 3 s: ORPHANED_MOTION, unclassified, and only ! is allowed', () => {
    const d = new Driver();
    d.open();
    d.written();
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'answer', seq: expect.any(Number), ms: 3000 });
    d.fire('answer');
    expect(d.state.overlays).toEqual(['ORPHANED_MOTION']);
    expect(d.state.writing).toBeNull();
    expect(d.intent({ intent: 'read', tokens: ['stat'] }).allowed).toBe(false);
    // OD-12: Disconnect writes nothing on the board and is allowed (asked of the matrix: d.intent would carry it out).
    expect(allowed(matrixSnapshot(d.state), 'disconnect').allowed).toBe(true);
    expect(d.intent({ intent: 'resetController' })).toMatchObject({ allowed: false });
    expect(d.intent({ intent: 'stopJob' })).toEqual({ allowed: true });
    expect(d.realtime()).toEqual([BYTE.FEEDHOLD]);
    expect(d.state.notices.adviseEstop).toBe(true);
    // The late answer is consumed, and nothing more is written.
    d.line(EN_ANSWERS.sr as string);
    expect(d.state.fault).toBeNull();
    expect(d.lines()).toEqual(['{sr:null}']);
  });


  it('silence in the middle of the probe is ORPHANED_MOTION as well', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'id');
    d.written();
    d.fire('answer');
    expect(d.state.overlays).toEqual(['ORPHANED_MOTION']);
    d.line(EN_ANSWERS.id as string);
    expect(d.state.writing).toBeNull();
    expect(d.state.queue).toEqual([]);
  });


  it('a boot banner while unclassified ends it (the reset ended the motion) and the probe restarts', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.fire('answer');
    d.line(EN_READY_BANNER);
    expect(d.state.overlays).toEqual(['UNKNOWN']);
    d.fire('settle');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(['UNKNOWN', 'READ_ONLY']);
  });


  it('an unsolicited report showing motion while identifying: ORPHANED_MOTION, the probe stops', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'fv');
    d.line('{"sr":{"vel":120.5,"posx":3}}');
    expect(d.state.overlays).toEqual(['ORPHANED_MOTION']);
    expect(d.state.live.vel).toBe(120.5);
    d.written();
    d.line(EN_ANSWERS.fv as string);
    expect(d.writing).toBeUndefined();
  });


  it('while READING, a report of a running class makes it ORPHANED_MOTION (classified)', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    d.line('{"sr":{"stat":5}}');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    d.answer({ ...EN_ANSWERS, stat: '{"r":{"stat":5},"f":[3,0,10]}' });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });
});

describe('ORPHANED_MOTION (PN §2.3 step 0; SAFETY H14)', () => {


  it('a report while connected (not connecting) only updates the live values', () => {
    const d = connected();
    d.line('{"sr":{"vel":50,"stat":5,"mpox":4,"posa":9,"posq":1,"feed":3}}');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    expect(d.state.live).toMatchObject({ vel: 50, stat: 5, machineClass: 'running', mpo: { x: 4 }, pos: { a: 9 } });
  });


  it('a report carries the commanded feed and the active tool as reported, for display only', () => {
    const d = connected();
    d.line('{"sr":{"feed":1500,"tool":3}}');
    expect(d.state.live).toMatchObject({ feed: 1500, tool: 3 });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    d.line('{"sr":{"tool":"x"}}');
    expect(d.state.live.tool).toBe(3);
  });


  it('a report carries the spindle and coolant readouts as reported, for display only; the {sr:null} answer records the status list', () => {
    const d = connected();
    expect(d.state.live.srList).toEqual(['line', 'posx', 'posy', 'posz', 'vel', 'unit', 'stat']);
    // The connect-time read seeded the readouts (spe 0 on the scripted board).
    expect(d.state.live.spe).toBe(0);
    const before = d.effects.length;
    d.line('{"sr":{"spe":1,"spc":1,"spd":0,"sps":18000,"cof":1,"com":0}}');
    expect(d.state.live).toMatchObject({ spe: 1, spc: 1, spd: 0, sps: 18000, cof: 1, com: 0 });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    d.line('{"sr":{"spe":"on"}}');
    expect(d.state.live.spe).toBe(1);
    // Nothing is written in answer to a readout: no setting write, no sr-list configuration.
    expect(d.effects.slice(before).filter((e) => e.kind === 'writeLine' || e.kind === 'writeRealtime')).toEqual([]);
  });


  it('the spindle and coolant readouts never reach a safety decision: Pause, Stop job, Spindle off and FAULT entry are the same whatever they say', () => {
    const run = (report: string): { effects: unknown[]; matrix: unknown; notices: unknown; overlays: unknown; } => {
      const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
      d.line(report);
      const before = d.effects.length;
      d.at = 42;
      d.intent({ intent: 'feedhold' });
      d.intent({ intent: 'stopJob' });
      d.intent({ intent: 'spindleOffNow' });
      // A reset banner while connected is a FAULT; at rest (vel 0, stat 1) no feedhold follows, whatever the spindle says.
      d.line(EN_READY_BANNER);
      return { effects: d.effects.slice(before), matrix: matrixSnapshot(d.state), notices: d.state.notices, overlays: d.state.overlays };
    };
    const none = run('{"sr":{"vel":0}}');
    const on = run('{"sr":{"spe":1,"spc":2,"spd":1,"sps":24000,"cof":1,"com":1}}');
    const off = run('{"sr":{"spe":0,"spc":0,"spd":0,"sps":0,"cof":0,"com":0}}');
    expect(on).toEqual(none);
    expect(off).toEqual(none);
    expect(realtime(none.effects as SessionEffect[])).toEqual([BYTE.FEEDHOLD, BYTE.FEEDHOLD, BYTE.FEEDHOLD]);
    expect(none.overlays).toContain('FAULT');
  });
});

describe('ORPHANED_MOTION (PN §2.3 step 0; SAFETY H14)', () => {


  it('polled spindle and coolant answers (snapshot.values) never reach a safety decision either', () => {
    const run = (answers: Readonly<Record<string, number>> | null): { effects: unknown[]; matrix: unknown; notices: unknown; overlays: unknown; } => {
      const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
      if (answers !== null) {
        const tokens = Object.keys(answers);
        expect(d.intent({ intent: 'read', tokens }).allowed).toBe(true);
        for (const t of tokens) d.line(`{"r":{"${t}":${String(answers[t])}},"f":[3,0,10]}`);
        for (const t of tokens) expect(d.state.values[t]).toMatchObject({ value: answers[t], status: 0 });
      }
      const before = d.effects.length;
      d.at = 42;
      d.intent({ intent: 'feedhold' });
      d.intent({ intent: 'stopJob' });
      d.intent({ intent: 'spindleOffNow' });
      d.line(EN_READY_BANNER);
      // Timer sequence numbers count the earlier reads' timers; everything else must be identical.
      const effects = d.effects.slice(before).map((e) => ('seq' in e ? { ...e, seq: 0 } : e));
      return { effects, matrix: matrixSnapshot(d.state), notices: d.state.notices, overlays: d.state.overlays };
    };
    const none = run(null);
    const on = run({ spe: 1, spc: 2, sps: 24000, cof: 1, com: 1 });
    const off = run({ spe: 0, spc: 0, sps: 0, cof: 0, com: 0 });
    expect(on).toEqual(none);
    expect(off).toEqual(none);
    expect(none.overlays).toContain('FAULT');
  });


  it('a report while connecting that shows no motion changes no overlay', () => {
    const d = new Driver();
    d.open();
    d.line('{"sr":{"vel":0,"posx":1}}');
    d.line('{"sr":{"line":3}}');
    expect(d.state.overlays).toEqual([]);
  });


  it.each([
    ['stat 2 (alarm)', 'stat', '{"r":{"stat":2},"f":[3,0,10]}'],
    ['an unknown stat', 'stat', '{"r":{"stat":99},"f":[3,0,10]}'],
    ['hold 2', 'hold', '{"r":{"hold":2},"f":[3,0,10]}'],
    ['vel 10', 'vel', '{"r":{"vel":10},"f":[3,0,10]}'],
    ['a short qr', 'qr', '{"r":{"qr":30},"f":[3,0,10]}'],
    ['qr not answered', 'qr', '{"r":{},"f":[3,100,10]}'],
    ['stat not a number', 'stat', '{"r":{"stat":"x"},"f":[3,0,10]}'],
  ])('READING finds the board not resting (%s): ORPHANED_MOTION', (_label, token, reply) => {
    const d = connected({ ...EN_ANSWERS, [token]: reply });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });


  it('stat 3 with hold 6 (an edge-next program pause, M0) is not resting: ORPHANED_MOTION', () => {
    const d = connected({ ...EN_ANSWERS, stat: '{"r":{"stat":3},"f":[3,0,10]}', hold: '{"r":{"hold":6},"f":[3,0,10]}' });
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });


  it('stat 3 with hold 0, vel 0 and an empty planner (a finished cycle on edge-next) counts as resting (SAFETY H14 amended 2026-11-02)', () => {
    const d = connected({ ...EN_ANSWERS, stat: '{"r":{"stat":3},"f":[3,0,10]}' });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });


  it.each([
    ['vel 10', '{"r":{"vel":10},"f":[3,0,10]}', 'vel'],
    ['a short qr', '{"r":{"qr":30},"f":[3,0,10]}', 'qr'],
    ['hold not answered', '{"r":{},"f":[3,100,10]}', 'hold'],
  ])('stat 3 with %s is still ORPHANED_MOTION', (_label, reply, token) => {
    const d = connected({ ...EN_ANSWERS, stat: '{"r":{"stat":3},"f":[3,0,10]}', [token]: reply });
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });
});

describe('ORPHANED_MOTION (PN §2.3 step 0; SAFETY H14)', () => {


  it('stat 4 (program end) counts as resting', () => {
    const d = connected({ ...EN_ANSWERS, stat: '{"r":{"stat":4},"f":[3,0,10]}' });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });


  it('a damaged READING answer leaves its value unknown, so the board is not trusted as resting', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'qr');
    d.written();
    d.line('{"r":{"qr":');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });


  it('a damaged READING answer before the last one keeps READING going', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    d.written();
    d.line('{"r":{"stat":');
    expect(d.state.base).toBe('READING');
    d.answer(EN_ANSWERS);
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });
});
