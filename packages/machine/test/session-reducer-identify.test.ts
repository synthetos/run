import { BYTE, PROBE_STEPS } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMINGS, MAX_PROBE_RESTARTS, type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_BOOT_BANNER, EN_READY_BANNER } from './sessionDriver.ts';
import { connected } from './sessionReducerFixtures.ts';

describe('splice guard and boot (PN §2.3 step 0 and 1; SAFETY H49)', () => {

  it('a G-code answer to the first line (no "sr" key) is a leftover partial line: ORPHANED_MOTION, the probe stops (bench 2, 2026-11-02)', () => {
    for (const reply of ['{"r":{},"f":[3,101,10]}', '{"r":{},"f":[1,102,17,7684]}', '{"r":{},"f":[3,0,10]}', '{"r":{},"f":[1,0,24,104]}']) {
      const d = new Driver();
      d.open();
      d.written();
      d.line(reply);
      expect(d.state.overlays, reply).toContain('ORPHANED_MOTION');
      expect(d.state.queue, reply).toEqual([]);
      expect(d.writing, reply).toBeUndefined();
      expect(d.lines(), reply).toEqual(['{sr:null}']);
      expect(d.state.classification, reply).toBeNull();
    }
  });


  it('an ok answer whose "sr" is not an object still counts as the status answer and continues', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":null},"f":[3,0,10]}');
    expect(d.state.overlays).not.toContain('ORPHANED_MOTION');
    expect(d.writing).toBe('fb');
  });


  it('a damaged identity probe after an empty status answer cannot establish rest', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":null},"f":[3,0,10]}');
    d.written();
    d.line('damaged{');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    expect(d.state.queue).toEqual([]);
  });


  it('an error answer that does carry "sr" repeats {sr:null} once, then continues either way', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
    expect(d.writing).toBe('sr');
    d.written();
    d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
    expect(d.writing).toBe('fb');
    expect(d.lines().slice(0, 3)).toEqual(['{sr:null}', '{sr:null}', '{"fb":null}']);
  });


  it('a successful repeat continues with the identity GETs', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  });


  it('an er report answering the first line (the spliced fragment) is only recorded', () => {
    const d = new Driver();
    d.open();
    d.written();
    // Before the first answer it is a previous program's output (H49 amendment 2026-11-03): discarded.
    d.line('{"er":{"fb":450.01,"st":13,"msg":"damaged"}}');
    expect(d.state.fault).toBeNull();
    expect(d.state.probe).toMatchObject({ backlog: 1 });
    d.line(EN_ANSWERS.sr as string);
    expect(d.writing).toBe('fb');
  });
});

describe('splice guard and boot (PN §2.3 step 0 and 1; SAFETY H49)', () => {


  it('an er report answering the repeated first line (after an error answer carrying sr) is only recorded (PN §2.3 step 0)', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
    expect(d.state.probe).toMatchObject({ spliceRetried: true, next: 0 });
    d.written();
    d.line('{"er":{"fb":450.01,"st":13,"msg":"damaged"}}');
    expect(d.state.fault).toBeNull();
    expect(d.state.probe).toMatchObject({ backlog: 0 });
    d.line(EN_ANSWERS.sr as string);
    expect(d.writing).toBe('fb');
  });


  it.each([false, true])('a damaged splice answer stops identification (write pending: %s)', (pendingWrite) => {
    for (const retried of [false, true]) {
      const d = new Driver();
      d.open();
      if (retried) {
        d.written();
        d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
      }
      if (!pendingWrite) d.written();
      d.line('{"r":{"sr":');
      if (retried) {
        // The answer to the repeated first line arrived damaged: uncertain at once.
        expect(d.state.overlays).toContain('ORPHANED_MOTION');
      } else {
        // Before the first answer a damaged line is a previous program's unread output (H49 amendment 2026-11-03);
        // the answer that then never comes is the timeout.
        expect(d.state.overlays).not.toContain('ORPHANED_MOTION');
        if (pendingWrite) d.written();
        d.fire('answer');
        expect(d.state.overlays).toContain('ORPHANED_MOTION');
      }
      expect(d.state.queue).toEqual([]);
      if (pendingWrite && retried) d.written();
      // Late clean data must not restart identification after an uncertain splice.
      d.line(EN_ANSWERS.sr as string);
      expect(d.writing).toBeUndefined();
      expect(d.lines()).toEqual(retried ? ['{sr:null}', '{sr:null}'] : ['{sr:null}']);
      expect(d.state.classification).toBeNull();
      expect(d.intent({ intent: 'feedhold' })).toEqual({ allowed: true });
      expect(d.realtime()).toContain(BYTE.FEEDHOLD);
    }
  });


  it('a torn line before the first answer is a previous program\'s backlog, not a damaged answer: the first reply that never comes is the timeout (ORPHANED_MOTION)', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":');
    expect(d.effects.filter((e) => e.kind === 'log')).toEqual([]);
    expect(d.state.overlays).not.toContain('ORPHANED_MOTION');
    expect(d.state.probe).toMatchObject({ next: 0, backlog: 1 });
    d.fire('answer');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });
});

describe('splice guard and boot (PN §2.3 step 0 and 1; SAFETY H49)', () => {


  it('bench 2, 2026-11-03: pushed reports and a torn heartbeat fragment left unread by a previous program precede the first answer; all of it is discarded and the answer is taken as the answer', () => {
    const d = new Driver();
    d.open();
    d.written();
    // The Console transcript, line by line: two stale pushes, the tail of an hb frame torn by the tty buffer, then
    // the real answer to run's own {sr:null}, then a fresh push and a heartbeat.
    d.line('{"sr":{"posx":194.397}}');
    d.line('{"sr":{"posx":195.730}}');
    d.line('{"sr":{"posx":ld":0,·ull}}');
    expect(d.state.probe).toMatchObject({ next: 0, backlog: 3 });
    expect(d.state.live.pos?.x).toBeUndefined();
    d.line('{"r":{"sr":{"posx":161.350,"posy":8.650,"posz":-2.740,"line":0,"stat":3,"vel":0.00}},"f":[3,0,10]}');
    const logs = d.effects.filter((e) => e.kind === 'log').map((e) => (e as Extract<SessionEffect, { kind: 'log'; }>).text);
    expect(logs).toContain('probe: 3 lines of output left unread by a previous program arrived before the first answer: discarded');
    expect(d.state.overlays).not.toContain('ORPHANED_MOTION');
    expect(d.state.overlays).not.toContain('FAULT');
    expect(d.state.probe).toMatchObject({ next: 1, backlog: 0 });
    expect(d.state.live.pos?.x).toBe(161.35);
    d.line('{"sr":{"stat":3}}');
    d.line('{"hb":{"stat":3,"hold":0,"up":414,"qt":null}}');
    expect(d.state.live.stat).toBe(3);
    expect(d.state.overlays).not.toContain('FAULT');
  });


  it('a board that boots while it is probed: the probe restarts from {sr:null} once it is ready and quiet', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line(EN_BOOT_BANNER);
    expect(d.state.probe).toMatchObject({ settling: 'boot' });
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'settle', seq: expect.any(Number), ms: DEFAULT_TIMINGS.bannerWaitMs });
    d.line(EN_READY_BANNER);
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'settle', seq: expect.any(Number), ms: DEFAULT_TIMINGS.bannerSettleMs });
    // An answer to a line sent before the reset arrives while settling: discarded, never misattributed.
    d.line(EN_ANSWERS.sr as string);
    d.line('garbage{');
    expect(d.state.fault).toBeNull();
    d.fire('settle');
    expect(d.writing).toBe('sr');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    expect(d.lines().filter((l) => l === '{sr:null}')).toHaveLength(2);
  });


  it('a line whose write completes while the board resets expects no answer', () => {
    const d = new Driver();
    d.open();
    d.line(EN_READY_BANNER);
    d.written();
    expect(d.state.expected).toEqual([]);
    expect(d.state.timers.answer).toBeUndefined();
  });


  it(`a board that keeps resetting latches FAULT after ${MAX_PROBE_RESTARTS} restarts`, () => {
    const d = new Driver();
    d.open();
    for (let i = 0;i < MAX_PROBE_RESTARTS;i++) {
      d.line(EN_READY_BANNER);
      d.fire('settle');
    }
    d.line(EN_READY_BANNER);
    d.fire('settle');
    expect(d.state.fault).toMatchObject({ cause: 'resetLoop', kind: 'integrity' });
    expect(d.state.overlays).toContain('FAULT');
  });
});

describe('splice guard and boot (PN §2.3 step 0 and 1; SAFETY H49)', () => {


  it('a settle timer outside the probe does nothing', () => {
    const d = new Driver();
    d.open();
    d.line(EN_READY_BANNER);
    const seq = d.state.timers.settle as number;
    d.answer(EN_ANSWERS);
    // Fabricate a stale settle with the right sequence number after the probe completed.
    d.state = { ...d.state, timers: { settle: seq } };
    d.feed({ type: 'timer', id: 'settle', seq, at: 0 });
    expect(d.state.base).toBe('IDENTIFYING');
  });
});

describe('the probe result is recorded in the session log (ROADMAP P1-03)', () => {

  const logs = (d: Driver): string[] => d.effects.filter((e) => e.kind === 'log').map((e) => (e as Extract<SessionEffect, { kind: 'log'; }>).text);


  it('one line with the identity, the capability answers, the footers and the verdict', () => {
    const d = connected(EN_ANSWERS);
    const [line, ...rest] = logs(d);
    expect(rest).toEqual(['connect: full state read; status reports are not configured on this board in this release']);
    expect(line).toMatch(/^probe: \{/);
    const json = JSON.parse((line as string).slice('probe: '.length, line!.indexOf(' → '))) as Record<string, unknown>;
    expect(json).toMatchObject({ banner: 'none', footerRev: 3, fb: 450.01, fv: 0.97, hp: 1, hv: 8, id: 'EN-1', spph: 'stubbed', conflicts: [] });
    expect(json['tokens']).toEqual({ spep: 'value', prbp: 'value', fstk: 'value', os: 'value' });
    expect(json['footers']).toHaveLength(PROBE_STEPS.length - 1);
    expect(line).toContain('→ tinyg-en read-only (en-not-approved): ');
  });


  it('a damaged or missing probe answer is recorded too', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'hp');
    d.written();
    d.line('{"r":{"hp":1},"f":[3,0');
    expect(logs(d)).toEqual(['probe: the answer to hp arrived damaged → unclassified, read-only']);

    const m = new Driver();
    m.open();
    m.answer(EN_ANSWERS, (t) => t === 'spph');
    const probe = m.state.probe;
    if (probe === null) throw new Error('no probe');
    m.state = { ...m.state, probe: { ...probe, answers: probe.answers.filter(([k]) => k !== 'fb') } };
    m.answer(EN_ANSWERS);
    expect(logs(m)).toEqual(['probe: could not be read (missing-answer at fb) → unclassified, read-only']);
  });
});

describe('probe failures', () => {

  it('a damaged probe answer leaves the board unclassified and READ_ONLY', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'hp');
    d.written();
    d.line('{"r":{"hp":1},"f":[3,0');
    expect(d.state).toMatchObject({ base: 'CONNECTED_UNKNOWN', ready: true, classification: { dialectId: null, reason: 'probeFailed' } });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });


  it('a footer revision that changes during the probe is a FAULT (the board was reset or reconfigured)', () => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, fv: '{"r":{"fv":0.97},"f":[2,0,10]}' }, (t) => t === 'hp');
    expect(d.state.fault).toMatchObject({ cause: 'footerRevisionChanged' });
  });


  it('an answer the probe cannot read (conflicting identity) is unclassified', () => {
    const d = connected({ ...EN_ANSWERS, id: '{"r":{"id":7},"f":[3,0,10]}' });
    expect(d.state.classification).toMatchObject({ dialectId: null, reason: 'conflict' });
  });


  it('a probe that ends with a missing answer is reported as a probe failure', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'spph');
    // Remove a recorded answer to reach buildProbeResult's missing-answer outcome.
    const probe = d.state.probe;
    if (probe === null) throw new Error('no probe');
    d.state = { ...d.state, probe: { ...probe, answers: probe.answers.filter(([k]) => k !== 'fb') } };
    d.answer(EN_ANSWERS);
    expect(d.state.classification).toMatchObject({ reason: 'probeFailed', detail: 'the probe could not be read (missing-answer at fb)' });
  });
});
