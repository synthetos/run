/**
 * Shared dialect contract (ROADMAP P0-08; RUN_PLAN §5.1 rule 5).
 *
 * Every rule here runs against EVERY dialect with data, including the
 * read-only `g2core-edge`, so a TinyG-only assumption in a shared interface
 * fails CI. The rules cover framing, classification, flow-engine selection
 * and stop-sequence data.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyLine, parseFooter } from '../src/classify.ts';
import { deepFreeze, statusTable } from '../src/dialects/shared.ts';
import { BYTE, DIALECTS, READ_ONLY_STOP_JOB, mapStat, selectFlowEngine, stopJobFor } from '../src/index.ts';
import type { Dialect } from '../src/index.ts';

const each = (fn: (d: Dialect) => void) => {
  for (const d of DIALECTS) fn(d);
};

describe('contract: identity and tables', () => {
  it('covers both families, and ids are unique', () => {
    expect(new Set(DIALECTS.map((d) => d.id)).size).toBe(DIALECTS.length);
    expect(new Set(DIALECTS.map((d) => d.family))).toEqual(new Set(['tinyg', 'g2core']));
  });

  it('stat 0..10 mean the same on every build (PN §8), except the soft/hard alarm at 2', () =>
    each((d) => {
      expect(d.stat.length, d.id).toBeGreaterThanOrEqual(12);
      expect(mapStat(d, 0)).toBe('initializing');
      expect(mapStat(d, 1)).toBe('idle');
      expect(['alarm', 'softAlarm']).toContain(mapStat(d, 2));
      expect(mapStat(d, 4)).toBe('end');
      expect(mapStat(d, 5)).toBe('running');
      expect(mapStat(d, 6)).toBe('held');
      expect(mapStat(d, 9)).toBe('homing');
    }));

  it('exactly one stat value means shutdown, and only builds with a panic state map one', () =>
    each((d) => {
      expect(d.stat.filter((s) => s.machineClass === 'shutdown').length, d.id).toBe(1);
      expect(d.stat.filter((s) => s.machineClass === 'panic').length, d.id).toBeLessThanOrEqual(1);
    }));

  it('every status table classifies a limit hit and an alarm rejection, at different codes', () =>
    each((d) => {
      const codes = (c: string) => [...d.status].filter(([, e]) => e.statusClass === c).map(([k]) => k);
      expect(codes('limitHit').length, d.id).toBe(1);
      expect(codes('rejectedAlarm').length, d.id).toBe(1);
      expect(codes('limitHit')[0]).not.toBe(codes('rejectedAlarm')[0]);
      expect(d.status.has(0), d.id).toBe(false); // 0 is ok by rule, never a table entry
    }));

  it('every footer revision a dialect declares is one the line classifier parses', () =>
    each((d) => {
      for (const rev of d.caps.footerRevs) {
        const raw = rev === 1 && d.family === 'g2core' ? [1, 0, 12] : rev === 1 ? [1, 0, 12, 0] : [rev, 0, 11];
        expect(parseFooter(raw)?.rev, `${d.id} rev ${rev}`).toBe(rev);
      }
    }));

  it("the classifier recognises each dialect's banner shape as a Banner", () =>
    each((d) => {
      const line =
        d.bannerShape === 'bare-sr'
          ? '{"sr":{"fv":0.97,"fb":450.01,"msg":"SYSTEM READY"}}'
          : '{"r":{"fv":0.99,"fb":101.06,"hp":"ArduinoDue","msg":"SYSTEM READY"},"f":[1,0,12]}';
      expect(classifyLine(line), d.id).toMatchObject({ kind: 'Banner', shape: d.bannerShape });
    }));
});

describe('contract: realtime bytes', () => {
  it('among the dialects run may stream (mode manifest), only tinyg-en has ^D or ENQ (SAFETY §8 item 29)', () =>
    each((d) => {
      if (d.mode !== 'manifest' || d.id === 'tinyg-en') return;
      expect(d.realtime.kill, d.id).toBeUndefined();
      expect(d.realtime.enq, d.id).toBeUndefined();
    }));

  it('kill and enq exist exactly when the caps say so', () =>
    each((d) => {
      expect(d.realtime.kill !== undefined, d.id).toBe(d.caps.jobKill);
      expect(d.realtime.enq !== undefined, d.id).toBe(d.caps.enq);
    }));

  it('feedhold, resume and reset are the standard bytes everywhere; flush when present is %', () =>
    each((d) => {
      expect(d.realtime.feedhold.byte).toBe(0x21);
      expect(d.realtime.resume.byte).toBe(0x7e);
      expect(d.realtime.reset.byte).toBe(0x18);
      if (d.realtime.flush !== undefined) {
        expect(d.realtime.flush.byte).toBe(0x25);
        expect(d.realtime.flushHonoured, d.id).toBeDefined();
      }
    }));

  it('no realtime byte run may write is also on the never-send list, and XON/XOFF are never sent', () =>
    each((d) => {
      const { feedhold, resume, flush, reset, kill, enq } = d.realtime;
      for (const rb of [feedhold, resume, flush, reset, kill, enq]) {
        if (rb !== undefined) expect(d.flow.neverSend, `${d.id} 0x${rb.byte.toString(16)}`).not.toContain(rb.byte);
      }
      expect(d.flow.neverSend).toEqual(expect.arrayContaining([BYTE.XON, BYTE.XOFF]));
    }));
});

describe('contract: flow-engine selection', () => {
  it('every dialect bounds queued motion by the ceiling and opens with flowControl none', () =>
    each((d) => {
      expect(d.flow.queuedMotionCeiling).toBe(true);
      expect(d.flow.flowControl).toBe('none');
    }));

  it('a byte window never exceeds the receive buffer, and a job line always fits', () =>
    each((d) => {
      const e = d.flow.engine;
      expect(d.limits.maxLineBytes, d.id).toBeLessThanOrEqual(d.limits.maxJsonLineBytes);
      if (e.kind === 'byteWindow') expect(e.inFlightMax, d.id).toBeLessThan(d.limits.rxBytes);
      if (e.kind === 'byteWindow' && e.linesInFlightMax !== undefined) {
        expect(e.linesInFlightMax, d.id).toBeLessThan(d.limits.lineHeaders ?? 0);
      }
    }));

  it('the planner headroom leaves room for queued blocks', () =>
    each((d) => expect(d.limits.plannerHeadroom, d.id).toBeLessThan(d.limits.plannerBlocks)));

  it('fast-check: no READ_ONLY or unclassified session ever gets an engine or more than `!` to stop', () => {
    fc.assert(
      fc.property(fc.constantFrom<Dialect | null>(null, ...DIALECTS), fc.constantFrom('full' as const, 'readOnly' as const), (d, mode) => {
        const engine = selectFlowEngine(d, mode);
        const stop = stopJobFor(d, mode);
        const permitted = d !== null && mode === 'full' && d.mode === 'manifest';
        expect(engine !== null).toBe(permitted);
        expect(stop === READ_ONLY_STOP_JOB).toBe(!permitted);
      }),
    );
  });
});

describe('contract: stop sequences', () => {
  it('every Stop job first waits for the in-flight write and stops feeding', () =>
    each((d) => {
      expect(d.stopJob.steps.slice(0, 2).map((s) => s.kind), d.id).toEqual(['awaitInFlightWrite', 'stopFeeding']);
      expect(d.stopJob.onTimeout).toBe('faultW12');
      expect(d.stopJob.steps.at(-1)?.kind).toBe('done');
    }));

  it('no stop sequence ever writes ^X, and every byte it writes is one the dialect allows', () =>
    each((d) => {
      const allowed = new Set(
        [d.realtime.feedhold, d.realtime.flush, d.realtime.kill].flatMap((rb) => (rb === undefined ? [] : [rb.byte])),
      );
      for (const s of d.stopJob.steps) {
        if (s.kind !== 'writeRealtime') continue;
        expect(s.byte, d.id).not.toBe(BYTE.RESET);
        expect(allowed.has(s.byte), `${d.id} 0x${s.byte.toString(16)}`).toBe(true);
        expect(d.flow.neverSend).not.toContain(s.byte);
      }
    }));

  it('^D appears in a stop sequence only on a dialect with jobKill, and then is awaited as alarm 207', () =>
    each((d) => {
      const writesKill = d.stopJob.steps.some((s) => s.kind === 'writeRealtime' && s.byte === BYTE.KILL);
      if (writesKill) {
        expect(d.caps.jobKill, d.id).toBe(true);
        expect(d.stopJob.steps.some((s) => s.kind === 'awaitAlarm' && s.status === 207)).toBe(true);
      }
    }));

  it('a read-only dialect stops with `!` and E-stop advice only: no lines, no clear, no flush', () =>
    each((d) => {
      if (d.mode !== 'readOnly') return;
      for (const s of d.stopJob.steps) {
        expect(['writeLine', 'clearAlarm', 'confirm', 'verifyDrained'], d.id).not.toContain(s.kind);
        if (s.kind === 'writeRealtime') expect(s.byte).toBe(BYTE.FEEDHOLD);
      }
      expect(d.stopJob.steps.some((s) => s.kind === 'adviseEstop')).toBe(true);
    }));

  it('a drain check needs a bench-verified plannerBlocks, so every dialect flags it until B-QR-1', () =>
    each((d) => {
      if (!d.stopJob.steps.some((s) => s.kind === 'verifyDrained' && s.plannerEmpty)) return;
      expect(d.unverified.some((u) => u.field === 'limits.plannerBlocks' && u.bench === 'B-QR-1'), d.id).toBe(true);
    }));

  it('every unverified fact names a bench task', () =>
    each((d) => {
      for (const u of d.unverified) expect(u.bench, `${d.id} ${u.field}`).toMatch(/^B-[A-Z0-9]+(-[A-Z0-9]+)*$/);
    }));
});

describe('contract: G-code data', () => {
  it('barriers are M0, M60 and M1 everywhere, and every rule has a unique id and a reason', () =>
    each((d) => {
      expect(d.gcode.barrierCodes).toEqual(['M0', 'M60', 'M1']);
      const ids = d.gcode.blocked.map((r) => r.id);
      expect(new Set(ids).size, d.id).toBe(ids.length);
      for (const r of d.gcode.blocked) expect(r.reason.length, `${d.id} ${r.id}`).toBeGreaterThan(20);
      expect(d.gcode.lWords).toContain(2);
    }));

  it('a dialect whose program end clears an alarm holds back M2/M30 (H35)', () =>
    each((d) => {
      if (d.caps.m2ClearsAlarm) expect(d.gcode.holdbackEndCodes, d.id).toEqual(['M2', 'M30']);
    }));
});

describe('shared helpers', () => {
  it('statusTable refuses a duplicate code (a data bug caught at load)', () => {
    expect(() =>
      statusTable([
        [203, 'A', 'limitHit'],
        [203, 'B', 'rejectedAlarm'],
      ]),
    ).toThrow(/duplicate status code 203/);
  });

  it('deepFreeze leaves primitives alone and freezes nested data', () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBeNull();
    const o = deepFreeze({ a: [{ b: 1 }] });
    expect(Object.isFrozen(o.a[0])).toBe(true);
  });
});
