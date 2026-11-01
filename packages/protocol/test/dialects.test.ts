/**
 * Dialect data (ROADMAP P0-08): the per-dialect facts the safety cases rest
 * on, and the lookups that interpret them.
 */
import { describe, expect, it } from 'vitest';
import {
  BYTE,
  DIALECTS,
  checkFooterForDialect,
  classifyLine,
  checksum440,
  G2CORE_EDGE,
  READ_ONLY_STOP_JOB,
  TINYG_440,
  TINYG_449_STOCK,
  TINYG_EN,
  dialectById,
  holdName,
  mapStat,
  resolveBufferFull,
  selectFlowEngine,
  statusClass,
  stopJobFor,
} from '../src/index.ts';
import type { Dialect, StopSequence } from '../src/index.ts';

function writtenBytes(seq: StopSequence): number[] {
  return seq.steps.flatMap((s) => (s.kind === 'writeRealtime' ? [s.byte] : []));
}

describe('T-S4: three TinyG tables', () => {
  it('EN: stat 12 → shutdown, 13 → panic; status 203 → limit, 207 → job kill', () => {
    expect(mapStat(TINYG_EN, 12)).toBe('shutdown');
    expect(mapStat(TINYG_EN, 13)).toBe('panic');
    expect(statusClass(TINYG_EN, 203)).toBe('limitHit');
    expect(statusClass(TINYG_EN, 207)).toBe('jobKilled');
    // and the neighbours that must NOT be confused with them
    expect(mapStat(TINYG_EN, 11)).toBe('interlock');
    expect(statusClass(TINYG_EN, 204)).toBe('rejectedAlarm');
  });

  it('TG: stat 11 → shutdown; status 204 → limit (203 is "alarmed", the reverse of EN)', () => {
    expect(mapStat(TINYG_440, 11)).toBe('shutdown');
    expect(statusClass(TINYG_440, 204)).toBe('limitHit');
    expect(statusClass(TINYG_440, 203)).toBe('rejectedAlarm');
    // 12 and 13 do not exist on 440.21, and 207 is not a job kill there
    expect(mapStat(TINYG_440, 12)).toBe('unknown');
    expect(mapStat(TINYG_440, 13)).toBe('unknown');
    expect(statusClass(TINYG_440, 207)).toBe('error');
  });

  it('stat 3 → programStop on every dialect (never idle, SAFETY H21)', () => {
    for (const d of DIALECTS) expect(mapStat(d, 3), d.id).toBe('programStop');
  });

  it('stat 2 is a soft alarm on 440.21 (moves keep running) and a hard alarm elsewhere', () => {
    expect(mapStat(TINYG_440, 2)).toBe('softAlarm');
    for (const d of [TINYG_EN, TINYG_449_STOCK, G2CORE_EDGE]) expect(mapStat(d, 2), d.id).toBe('alarm');
  });

  it('stock 449 has its own table: 203 limit, and 13 is not a trusted "damaged line"', () => {
    expect(statusClass(TINYG_449_STOCK, 203)).toBe('limitHit');
    // EN 13 is ambiguous (E162 damaged line vs E102 overflowed reply): never acted on alone.
    expect(statusClass(TINYG_EN, 13)).toBe('bufferFull');
    expect(statusClass(TINYG_449_STOCK, 13)).toBe('error');
    expect(statusClass(TINYG_440, 13)).toBe('error');
  });

  it('EN 13 is a damaged line only with an er 13 or ALARM 13; otherwise the line ran and its reply was lost', () => {
    // E162: the first damaged line raises ALARM 13 and prints er 13 (EN controller.c:253-266).
    expect(resolveBufferFull({ exception13: true, alarmStatus: null })).toBe('damagedLine');
    // A later damaged line while ALARM 13 stands: no new er (cm_alarm returns early), still damaged.
    expect(resolveBufferFull({ exception13: false, alarmStatus: 13 })).toBe('damagedLine');
    // E102: `{"r":{},"f":[3,13,n]}` after the command ran, no er, no alarm: never resend.
    expect(resolveBufferFull({ exception13: false, alarmStatus: null })).toBe('responseLost');
    // An alarm of another cause is no evidence that this line was damaged.
    expect(resolveBufferFull({ exception13: false, alarmStatus: 203 })).toBe('responseLost');
  });

  it('the duplicated BMAX code (220) leaves 230 undefined on TinyG, but not on g2core', () => {
    for (const d of [TINYG_EN, TINYG_440, TINYG_449_STOCK]) expect(statusClass(d, 230), d.id).toBe('error');
    expect(statusClass(G2CORE_EDGE, 230)).toBe('softLimit');
  });

  it('status 0 is ok; anything unclassified is error', () => {
    for (const d of DIALECTS) {
      expect(statusClass(d, 0)).toBe('ok');
      expect(statusClass(d, 1)).toBe('error');
      expect(statusClass(d, 255)).toBe('error');
      expect(statusClass(d, 2.5)).toBe('error');
    }
  });

  it('a stat the dialect does not define is unknown, never idle', () => {
    for (const d of DIALECTS) {
      for (const v of [-1, 1.5, Number.NaN, d.stat.length, 99]) expect(mapStat(d, v), `${d.id} ${v}`).toBe('unknown');
    }
  });
});

describe('T-S24a/b precursors: realtime bytes', () => {
  it('TG and stock 449 have no kill and no enq byte, and never send them', () => {
    for (const d of [TINYG_440, TINYG_449_STOCK]) {
      expect(d.realtime.kill, d.id).toBeUndefined();
      expect(d.realtime.enq, d.id).toBeUndefined();
      expect(d.caps.jobKill || d.caps.enq, d.id).toBe(false);
      expect(d.flow.neverSend, d.id).toEqual(expect.arrayContaining([BYTE.KILL, BYTE.ENQ]));
    }
  });

  it('only edge-next may write ^D or ENQ among the TinyG dialects', () => {
    expect(TINYG_EN.realtime.kill?.byte).toBe(0x04);
    expect(TINYG_EN.realtime.enq?.byte).toBe(0x05);
    expect(TINYG_EN.flow.neverSend).not.toContain(BYTE.KILL);
  });

  it('EN honours % and ~ only at a line boundary; TG traps them anywhere; g2 only at a line start', () => {
    expect(TINYG_EN.realtime.flush?.scope).toBe('lineBoundary');
    expect(TINYG_EN.realtime.resume.scope).toBe('lineBoundary');
    expect(TINYG_440.realtime.flush?.scope).toBe('anywhere');
    expect(G2CORE_EDGE.realtime.feedhold.scope).toBe('lineStart');
    expect(TINYG_440.realtime.flushHonoured).toBe('latched');
    expect(TINYG_EN.realtime.flushHonoured).toBe('holdOrAlarmFlush');
  });

  it('records the reset hazards: TG defers ^X to the main loop (E128); g2 loses the port', () => {
    expect(TINYG_440.realtime.resetDeferredByMainLoop).toBe(true);
    expect(TINYG_EN.realtime.resetDeferredByMainLoop).toBe(false);
    expect(G2CORE_EDGE.realtime.resetLosesPort).toBe(true);
  });
});

describe('capabilities, limits and flow (PN §6.2, §7, §9)', () => {
  it('EN: the full capability set of PN §9.1', () => {
    expect(TINYG_EN.caps).toMatchObject({
      jobKill: true,
      enq: true,
      tid: true,
      programStopPauses: true,
      m2ClearsAlarm: true,
      arcSoftLimits: true,
      alarmStopsSpindle: true,
      lineInSr: true,
      footerRevs: [2, 3],
    });
  });

  it('TG: all of them false except m2ClearsAlarm; the M0 and arc corrections are encoded (PN §9.2, §10.2)', () => {
    const { footerRevs, footerChecksum, spindlePauseOnHold, m2ClearsAlarm, ...flags } = TINYG_440.caps;
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
    expect(footerRevs).toEqual([1]);
    expect(footerChecksum).toBe('required');
    expect(spindlePauseOnHold).toBe('never');
    // A queued program end overwrites the soft alarm's machine_state (TG canonical_machine.c:1351-1353):
    // a buffered M2/M30 clears the alarm on 440.21 too, so it must be held back (H35).
    expect(m2ClearsAlarm).toBe(true);
  });

  it('limits: EN ring 250, headroom 12, 12 line headers; TG ring 254, headroom 4', () => {
    expect(TINYG_EN.limits).toMatchObject({ rxBytes: 250, plannerHeadroom: 12, lineHeaders: 12, maxLineBytes: 120 });
    expect(TINYG_440.limits).toMatchObject({ rxBytes: 254, plannerHeadroom: 4, maxLineBytes: 120 });
    expect(TINYG_440.limits.lineHeaders).toBeUndefined();
  });

  it('plannerBlocks is the provisional constant 32 on both TinyG dialects and is flagged B-QR-1', () => {
    for (const d of [TINYG_EN, TINYG_440]) {
      expect(d.limits.plannerBlocks).toBe(32);
      expect(d.unverified.find((u) => u.field === 'limits.plannerBlocks')?.bench).toBe('B-QR-1');
    }
  });

  it('flow (PN §7.4): EN 180 B, 10 lines, pause at 2 free headers, rev-2 cross-check; TG rev-1 cross-check', () => {
    expect(TINYG_EN.flow.engine).toMatchObject({ kind: 'byteWindow', inFlightMax: 180, linesInFlightMax: 10, freeHeaderPause: 2, byteCrossCheck: 'rev2' });
    expect(TINYG_440.flow.engine).toMatchObject({ kind: 'byteWindow', inFlightMax: 180, byteCrossCheck: 'rev1' });
    expect(G2CORE_EDGE.flow.engine).toMatchObject({ kind: 'lineWindow', linesInFlightMax: 4 });
  });

  it('G-code rules (PN §9.3): TG L2 only, EN L2/L20; barriers M0/M60/M1; every TinyG dialect holds back M2/M30', () => {
    expect(TINYG_440.gcode.lWords).toEqual([2]);
    expect(TINYG_EN.gcode.lWords).toEqual([2, 20]);
    for (const d of [TINYG_EN, TINYG_440]) expect(d.gcode.barrierCodes).toEqual(['M0', 'M60', 'M1']);
    // EN: E135 (a standalone M2/M30 clears ALARM). TG: a queued program end overwrites the soft alarm.
    for (const d of [TINYG_EN, TINYG_440, TINYG_449_STOCK]) expect(d.gcode.holdbackEndCodes, d.id).toEqual(['M2', 'M30']);
  });

  it('TG blocks G18 arcs, G28/G30 under G20/G91, G28.4, E words and caps queued commands at 3', () => {
    const kinds = TINYG_440.gcode.blocked.map((r) => r.id);
    expect(kinds).toEqual(
      expect.arrayContaining(['text-after-comment', 'g18-arc', 'g28-g30-g20-g91', 'g28.4', 'e-word', 'e088-queued-per-line', 'g93']),
    );
    const cap = TINYG_440.gcode.blocked.find((r) => r.kind === 'queuedCommandsPerLine');
    expect(cap?.kind === 'queuedCommandsPerLine' && cap.max).toBe(3);
    const underModal = TINYG_440.gcode.blocked.find((r) => r.kind === 'codeUnderModal');
    expect(underModal?.kind === 'codeUnderModal' && [underModal.codes, underModal.modes]).toEqual([['G28', 'G30'], ['G20', 'G91']]);
  });

  it('EN blocks M201.3 and G93 but not G18 arcs or E words (fixed there)', () => {
    const codes = TINYG_EN.gcode.blocked.flatMap((r) => (r.kind === 'code' ? [r.code] : []));
    expect(codes).toEqual(['M201.3', 'G93']);
    expect(TINYG_EN.gcode.blocked.some((r) => r.kind === 'arcInPlane' || r.kind === 'word')).toBe(false);
    expect(TINYG_440.gcode.blocked.some((r) => r.kind === 'code' && r.code === 'G93')).toBe(true);
  });
});

describe('stop sequences as data (SAFETY §4.4)', () => {
  it('EN: stop feeding, halt on SHUTDOWN/PANIC, ^D, wait for alarm 207 (or an alarm already latched), C13, clear, then the E114 drain check', () => {
    const kinds = TINYG_EN.stopJob.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      'awaitInFlightWrite',
      'stopFeeding',
      'haltIfStat',
      'writeRealtime',
      'awaitAlarm',
      'confirm',
      'clearAlarm',
      'verifyDrained',
      'requireRehomeIfUnhomed',
      'resetCounters',
      'done',
    ]);
    expect(writtenBytes(TINYG_EN.stopJob)).toEqual([BYTE.KILL]);
    // EN cm_alarm prints nothing when already ALARM/SHUTDOWN/PANIC (canonical_machine.c:797-803).
    expect(TINYG_EN.stopJob.steps).toContainEqual({ kind: 'awaitAlarm', status: 207, alreadyAlarmedStat: [2], timeoutMs: 2000 });
    expect(TINYG_EN.stopJob.steps).toContainEqual({ kind: 'haltIfStat', stat: [12, 13], spindle: 'unknown' });
    expect(mapStat(TINYG_EN, 2)).toBe('alarm');
    expect(mapStat(TINYG_EN, 12)).toBe('shutdown');
    expect(TINYG_EN.stopJob.steps).toContainEqual(
      expect.objectContaining({ kind: 'verifyDrained', stat: [1, 3, 4], holdZero: true, plannerEmpty: true, velZero: true, consecutive: 2, intervalMs: 250 }),
    );
  });

  it('TG: !, wait for hold, %, drain, then M5 and M9 each waiting for r; spindle unconfirmed', () => {
    expect(writtenBytes(TINYG_440.stopJob)).toEqual([BYTE.FEEDHOLD, BYTE.FLUSH]);
    const lines = TINYG_440.stopJob.steps.flatMap((s) => (s.kind === 'writeLine' ? [s.line] : []));
    expect(lines).toEqual(['M5', 'M9']);
    expect(TINYG_440.stopJob.steps.at(-1)).toEqual({ kind: 'done', spindle: 'unconfirmed' });
  });

  it('read-only dialects stop with `!` and "Use your E-stop" only', () => {
    for (const d of [TINYG_449_STOCK, G2CORE_EDGE]) {
      expect(d.stopJob).toBe(READ_ONLY_STOP_JOB);
      expect(writtenBytes(d.stopJob)).toEqual([BYTE.FEEDHOLD]);
      expect(d.stopJob.steps.some((s) => s.kind === 'adviseEstop')).toBe(true);
    }
  });

  it('stopJobFor: only a full session on an approvable dialect gets ^D or the flush path', () => {
    expect(stopJobFor(TINYG_EN, 'full')).toBe(TINYG_EN.stopJob);
    expect(stopJobFor(TINYG_440, 'full')).toBe(TINYG_440.stopJob);
    expect(stopJobFor(TINYG_EN, 'readOnly')).toBe(READ_ONLY_STOP_JOB);
    expect(stopJobFor(TINYG_440, 'readOnly')).toBe(READ_ONLY_STOP_JOB);
    expect(stopJobFor(null, 'full')).toBe(READ_ONLY_STOP_JOB);
    expect(stopJobFor(null, 'readOnly')).toBe(READ_ONLY_STOP_JOB);
    // A read-only dialect never gets more than `!`, even if a session claimed full mode.
    expect(stopJobFor(TINYG_449_STOCK, 'full')).toBe(READ_ONLY_STOP_JOB);
    expect(writtenBytes(stopJobFor(TINYG_EN, 'readOnly'))).not.toContain(BYTE.KILL);
  });

  it('selectFlowEngine: no engine at all for a READ_ONLY or unclassified session', () => {
    expect(selectFlowEngine(TINYG_EN, 'full')).toBe(TINYG_EN.flow.engine);
    expect(selectFlowEngine(TINYG_EN, 'readOnly')).toBeNull();
    expect(selectFlowEngine(TINYG_449_STOCK, 'full')).toBeNull();
    expect(selectFlowEngine(G2CORE_EDGE, 'full')).toBeNull();
    expect(selectFlowEngine(null, 'full')).toBeNull();
  });
});

describe('modes and lookups', () => {
  it('tinyg-449-stock and g2core-edge are read-only always; EN and 440 need the manifest', () => {
    expect(TINYG_449_STOCK.mode).toBe('readOnly');
    expect(G2CORE_EDGE.mode).toBe('readOnly');
    expect(TINYG_EN.mode).toBe('manifest');
    expect(TINYG_440.mode).toBe('manifest');
    expect(TINYG_449_STOCK.upgradeOffer).toBe(true);
  });

  it('dialectById finds each dialect; g2core-101.03 has no data', () => {
    for (const d of DIALECTS) expect(dialectById(d.id)).toBe(d);
    expect(dialectById('g2core-101.03')).toBeUndefined();
  });

  it('holdName reads the hold table: EN 0..6, TG 0..5, g2 0..12', () => {
    expect(holdName(TINYG_EN, 6)).toBe('HOLD');
    expect(holdName(TINYG_EN, 1)).toBe('REQUESTED');
    expect(holdName(TINYG_440, 4)).toBe('HOLD');
    expect(holdName(G2CORE_EDGE, 10)).toBe('HOLD');
    expect(holdName(TINYG_440, 6)).toBeUndefined();
    expect(holdName(TINYG_EN, -1)).toBeUndefined();
    expect(holdName(TINYG_EN, 0.5)).toBeUndefined();
  });

  it('dialect data is frozen all the way down, including the status tables', () => {
    const d: Dialect = TINYG_EN;
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.stat)).toBe(true);
    expect(Object.isFrozen(d.stat[12])).toBe(true);
    expect(Object.isFrozen(d.stopJob.steps[2])).toBe(true);
    expect(Object.isFrozen(d.realtime.kill)).toBe(true);
    expect(() => {
      (d.stat as unknown as { machineClass: string }[])[12]!.machineClass = 'idle';
    }).toThrow(TypeError);
    // The status table has no mutating methods at all.
    expect('set' in d.status).toBe(false);
    expect('delete' in d.status).toBe(false);
    expect(Object.isFrozen(d.status)).toBe(true);
    expect(Object.isFrozen(d.status.get(207))).toBe(true);
  });

  it('the status table behaves as a ReadonlyMap', () => {
    const t = TINYG_EN.status;
    expect(t.size).toBeGreaterThan(30);
    expect(t.has(207)).toBe(true);
    expect([...t.keys()]).toContain(203);
    expect([...t.values()].some((e) => e.statusClass === 'jobKilled')).toBe(true);
    expect([...t.entries()].length).toBe(t.size);
    expect([...t].length).toBe(t.size);
    const seen: number[] = [];
    t.forEach((_v, k, map) => {
      expect(map).toBe(t);
      seen.push(k);
    });
    expect(seen.length).toBe(t.size);
  });
});

describe('job G-code data (ROADMAP P0-10)', () => {
  it('EN: L20 accounts, G43.1 and G90.1 exist, M48-M51 are refused, a mid-file program end blocks', () => {
    const job = TINYG_EN.gcode.job;
    if (job === null) throw new Error('EN streams jobs');
    for (const code of ['G43.1', 'G90.1', 'G91.1', 'M201.3', 'G93']) expect(job.codes).toContain(code);
    for (const code of ['M48', 'M49', 'M50', 'M51', 'G43']) expect(job.codes).not.toContain(code);
    expect(job.ignoredCodes).toEqual([]);
    expect(job.maxTool).toBe(31);
    expect(job.midFileProgramEnd).toBe('block');
    expect(job.optionalStopOff).toBe('send');
    expect(job.programEndStopsOutputs).toBe(true);
    expect(job.storedMoveIntermediate).toBe('work');
    expect(job.rotaryOffsetsUseUnits).toBe(false);
  });

  it('TG: no arc distance mode, no tool offset, no M201.3; M48-M51 ignored; a mid-file program end warns', () => {
    const job = TINYG_440.gcode.job;
    if (job === null) throw new Error('440.21 streams jobs');
    for (const code of ['G90.1', 'G91.1', 'G43.1', 'M201.3']) expect(job.codes).not.toContain(code);
    expect(job.ignoredCodes).toEqual(['M48', 'M49', 'M50', 'M51']);
    expect(job.maxTool).toBe(255);
    expect(job.midFileProgramEnd).toBe('warn');
    expect(job.optionalStopOff).toBe('drop');
    // UNVERIFIED (B-M2-1): until the bench closes it, C22 inserts M5 M9 before a final M2/M30.
    expect(job.programEndStopsOutputs).toBe(false);
    expect(job.storedMoveIntermediate).toBe('machine');
    expect(job.rotaryOffsetsUseUnits).toBe(true);
  });

  it('read-only dialects have no job data', () => {
    expect(TINYG_449_STOCK.gcode.job).toBeNull();
    expect(G2CORE_EDGE.gcode.job).toBeNull();
  });
});


describe('dialect footer checksum rule (TG json_parser.c:529, :543-550)', () => {
  const withSum = (prefix: string, tail = ']}'): string => `${prefix}${checksum440(`${prefix}0`)}${tail}`;

  it('440.21 always prints a checksum: a rev-1 footer without one is garbled for that dialect', () => {
    const damaged = classifyLine('{"r":{},"f":[1,0,6]}');
    expect(damaged.kind).toBe('Response');
    expect(checkFooterForDialect(TINYG_440, damaged)).toEqual({ kind: 'Garbled', reason: 'bad-footer', line: '{"r":{},"f":[1,0,6]}' });
    const good = classifyLine(withSum('{"r":{},"f":[1,0,6,'));
    expect(good.kind).toBe('Response');
    expect(checkFooterForDialect(TINYG_440, good)).toBe(good);
  });

  it('a g2core rev-1 footer never has one: four fields are garbled for g2core', () => {
    const four = classifyLine(withSum('{"r":{},"f":[1,0,6,'));
    expect(checkFooterForDialect(G2CORE_EDGE, four)).toMatchObject({ kind: 'Garbled', reason: 'bad-footer' });
    const three = classifyLine('{"r":{},"f":[1,0,6]}');
    expect(checkFooterForDialect(G2CORE_EDGE, three)).toBe(three);
  });

  it('applies to banners too, and leaves rev 2/3 footers and footer-less events alone', () => {
    const banner = classifyLine('{"r":{"fv":0.97,"fb":440.21,"hp":1,"hv":8,"id":"x","msg":"SYSTEM READY"},"f":[1,0,0]}');
    expect(banner.kind).toBe('Banner');
    expect(checkFooterForDialect(TINYG_440, banner)).toMatchObject({ kind: 'Garbled', reason: 'bad-footer' });
    const en = classifyLine('{"r":{},"f":[3,0,12]}');
    expect(checkFooterForDialect(TINYG_EN, en)).toBe(en);
    expect(checkFooterForDialect(TINYG_440, en)).toBe(en);
    const sr = classifyLine('{"sr":{"stat":3}}');
    expect(checkFooterForDialect(TINYG_440, sr)).toBe(sr);
    const bareBanner = classifyLine('{"sr":{"fb":450.01,"msg":"SYSTEM READY"}}');
    expect(checkFooterForDialect(TINYG_440, bareBanner)).toBe(bareBanner);
  });

  it('every dialect states the rule, and only rev-1 dialects may require a checksum', () => {
    for (const d of DIALECTS) {
      if (d.caps.footerChecksum === 'required') expect(d.caps.footerRevs, d.id).toEqual([1]);
    }
    expect(TINYG_440.caps.footerChecksum).toBe('required');
    expect(G2CORE_EDGE.caps.footerChecksum).toBe('absent');
  });
});
