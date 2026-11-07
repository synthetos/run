/**
 * T-S130 (Probe Z, SAFETY §4.5c "The probe", "Setting Z", "Write gate"): exactly `G21`, `G91 G38.2 Z-<d> F<f>` and,
 * only after `e`=1 at rest with no Pause or Stop job since the start, `G10 L20 P<n> Z<thickness − L>`; the write gate
 * refuses every other probe or zero shape and any value over its limit; no line is sent after an ALARM; nothing is
 * retried.
 */
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { LINE_INTENTS, MAX_PROBE_DEPTH_MM, MAX_PROBE_FEED, checkWrite, motionLineKind, phase1WriteVerdict, probeKillWritable, probeLine, probeLineWritable, probeZeroLine, type SessionState } from '../src/index.ts';
import { JOBS_RELEASE_NO_FI, runUntil, writes } from './jobHarness.ts';
import { passTouch, probeHarness, probeWrites, startProbe, untilResult } from './probeHarness.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('T-S130 (U): the two new line shapes and their builders', () => {
  it('admits G91 G38.2 Z-<n> F<f> with n ≤ 15 and f ≤ 100, and G10 L20 P1-6 Z<n> with |n| ≤ 50, and nothing near them', () => {
    expect(motionLineKind('G91 G38.2 Z-5 F25')).toBe('probe');
    expect(motionLineKind(`G91 G38.2 Z-${MAX_PROBE_DEPTH_MM} F${MAX_PROBE_FEED}`)).toBe('probe');
    expect(motionLineKind('G91 G38.2 Z-0.5 F10')).toBe('probe');
    for (const bad of ['G91 G38.2 Z-15.0001 F25', 'G91 G38.2 Z-0 F25', 'G91 G38.2 Z-5 F101', 'G91 G38.2 Z-5 F0', 'G91 G38.2 Z5 F25', 'G90 G38.2 Z-5 F25', 'G38.2 Z-5 F25', 'G91 G38.3 Z-5 F25', 'G91 G38.2 X-5 F25', 'G91 G38.2 Z-5', 'G91 G38.2 Z-5 F25 M3', 'G91 G38.2 Z-5 F25.5']) {
      expect(motionLineKind(bad), bad).toBeUndefined();
    }
    expect(motionLineKind('G10 L20 P1 Z12.6782')).toBe('probeZero');
    expect(motionLineKind('G10 L20 P6 Z-0.0600')).toBe('probeZero');
    expect(motionLineKind('G10 L20 P1 Z50')).toBe('probeZero');
    for (const bad of ['G10 L20 P1 Z50.0001', 'G10 L20 P7 Z1', 'G10 L2 P1 Z1', 'G10 L20 P1 X1', 'G10 L20 P1 Z1 X0', 'G10 L20 Z1']) expect(motionLineKind(bad), bad).toBeUndefined();
    // Set zero keeps its own shape: the probe's zero always carries decimals, so it is never `Z0`.
    expect(motionLineKind('G10 L20 P1 Z0')).toBe('setZero');
    expect(probeZeroLine(1, 0)).toBe('G10 L20 P1 Z0.0000');
    expect(probeZeroLine(1, -0.00001)).toBe('G10 L20 P1 Z0.0000');
    expect(probeZeroLine(3, 12.678152)).toBe('G10 L20 P3 Z12.6782');
    expect(probeLine(5, 25)).toBe('G91 G38.2 Z-5 F25');
    expect(probeLine(2.5, 10)).toBe('G91 G38.2 Z-2.5 F10');
    expect(LINE_INTENTS.probe).toEqual(['probeZ']);
    expect(LINE_INTENTS.probeZero).toEqual(['probeZ']);
    expect(LINE_INTENTS.units).toContain('probeZ');
    expect(LINE_INTENTS.restore).toContain('probeZ');
  });

  it('the write gate admits a probe line only as the probe\'s own line in its step, and ^D only for a probe', async () => {
    const h = await probeHarness();
    const s = h.session.state;
    const verdict = (line: string, probeLineOk: boolean): unknown => phase1WriteVerdict(enc(`${line}\n`), { readable: () => true, enqAllowed: false, motion: true, probeLine: () => probeLineOk });
    expect(verdict('G91 G38.2 Z-5 F25', true)).toMatchObject({ ok: true, kind: 'motion', lineKind: 'probe' });
    expect(verdict('G91 G38.2 Z-5 F25', false)).toMatchObject({ ok: false, reason: '"G91 G38.2 Z-5 F25" is not the probe\'s own line in the step that sends it' });
    expect(verdict('G10 L20 P1 Z1.0000', false)).toMatchObject({ ok: false });
    expect(phase1WriteVerdict(enc('G91 G38.2 Z-5 F25\n'), { readable: () => true, enqAllowed: false, motion: true })).toMatchObject({ ok: false });
    expect(phase1WriteVerdict(Uint8Array.of(0x04), { readable: () => true, enqAllowed: false, motion: true })).toMatchObject({ ok: false, reason: 'realtime byte 0x04 is never written in this release' });
    expect(phase1WriteVerdict(Uint8Array.of(0x04), { readable: () => true, enqAllowed: false, motion: true, kill: true })).toEqual({ ok: true, kind: 'kill' });
    expect(phase1WriteVerdict(Uint8Array.of(0x04), { readable: () => true, enqAllowed: false, kill: true })).toMatchObject({ ok: false });
    // On an idle session nothing of the probe is writable: refused (a bug), never written.
    expect(probeLineWritable(s, 'G91 G38.2 Z-5 F25')).toBe(false);
    expect(probeKillWritable(s)).toBe(false);
    // With no probe running a probe line is held back (denied, dropped), never written.
    expect(checkWrite(s, s, JOBS_RELEASE_NO_FI, enc('G91 G38.2 Z-5 F25\n'), 'motion', 'probeZ')).toEqual({ kind: 'denied', reason: 'not written: the probe was stopped or has ended' });
    expect(checkWrite(s, s, JOBS_RELEASE_NO_FI, Uint8Array.of(0x04), 'kill', 'stopJob')).toMatchObject({ kind: 'refused' });
    // A probe line issued by another intent, and a jog line issued by the probe, are refused by kind.
    const starting: SessionState = { ...s, base: 'JOGGING', probeZ: { ...s.probeZ, step: 'starting', plan: { thicknessMm: 12.7, depthMm: 5, feed: 25, stopMm: 0.02, zeroZ: 12.68, maxSeconds: 17 }, run: { fromPos: 0, fromMpo: 0, units: 1, dist: 0, checked: true, sent: true, deadline: 0, stopped: null, report: null, confirmed: 0, zero: null, system: null, settleUntil: null, readback: {}, pending: null } }, queue: [{ token: 'gc', purpose: 'probeZ', line: 'G91 G38.2 Z-5 F25', intent: 'probeZ' }] };
    expect(probeLineWritable(starting, 'G91 G38.2 Z-5 F25')).toBe(true);
    expect(probeLineWritable(starting, 'G91 G38.2 Z-15 F25')).toBe(false);
    expect(probeLineWritable({ ...starting, queue: [] }, 'G91 G38.2 Z-5 F25')).toBe(false);
    expect(probeLineWritable({ ...starting, probeZ: { ...starting.probeZ, run: null } }, 'G91 G38.2 Z-5 F25')).toBe(false);
    expect(checkWrite(starting, starting, JOBS_RELEASE_NO_FI, enc('G91 G38.2 Z-5 F25\n'), 'motion', 'probeZ')).toBeUndefined();
    expect(checkWrite(starting, starting, JOBS_RELEASE_NO_FI, enc('G91 G38.2 Z-5 F25\n'), 'motion', 'jog')).toMatchObject({ kind: 'refused', reason: 'a probe line was issued by jog' });
    expect(checkWrite(starting, starting, JOBS_RELEASE_NO_FI, enc('G21 G91 G1 Z-5 F25\n'), 'motion', 'probeZ')).toMatchObject({ kind: 'refused', reason: 'a jog line was issued by probeZ' });
    expect(checkWrite(starting, starting, PHASE_2_RELEASE, Uint8Array.of(0x04), 'kill', 'stopJob')).toBeUndefined();
    const zeroing: SessionState = { ...starting, probeZ: { ...starting.probeZ, step: 'zeroing', run: { ...(starting.probeZ.run as NonNullable<SessionState['probeZ']['run']>), zero: 'line' } }, queue: [], writing: { token: 'gc', purpose: 'probeZ', line: 'G10 L20 P1 Z12.6800', intent: 'probeZ', seq: 9 } };
    expect(probeLineWritable(zeroing, 'G10 L20 P1 Z12.6800')).toBe(true);
    expect(probeLineWritable(zeroing, 'G10 L20 P2 Z12.6800')).toBe(false);
    expect(probeLineWritable({ ...zeroing, live: { ...zeroing.live, coor: 0 } }, 'G10 L20 P1 Z12.6800')).toBe(false);
    expect(probeLineWritable({ ...zeroing, probeZ: { ...zeroing.probeZ, step: 'result' } }, 'G10 L20 P1 Z12.6800')).toBe(false);
  });
});

describe('T-S130 (M): the lines on the model', () => {
  it('a contact: G21, the probe move, then the zero corrected for the stop distance, then the modes put back', async () => {
    const h = await probeHarness();
    await passTouch(h);
    const from = startProbe(h);
    expect(h.session.snapshot.base).toBe('JOGGING');
    await untilResult(h);
    expect(probeWrites(h, from)).toEqual(['G21', 'G91 G38.2 Z-5 F25', 'G10 L20 P1 Z12.6782', 'G90']);
    // The zero is written only after the report and the machine at rest (two polled cycles).
    const w = writes(h).slice(from);
    const zero = w.indexOf('G10 L20 P1 Z12.6782');
    expect(w.slice(0, zero).filter((x) => x === '{"qr":null}').length).toBeGreaterThanOrEqual(3);
    expect(w.slice(zero + 1, zero + 5)).toEqual(['{"g54":null}', '{"pos":null}', '{"ofs":null}', '{"coor":null}']);
    // The read-back is the session's own read of the new zero too (job checks and C31 read it).
    expect(h.session.snapshot.values['g54']?.value).toMatchObject({ z: expect.closeTo(-15.7, 1) });
    expect(h.session.snapshot.values['ofs']?.status).toBe(0);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.fault).toBeNull();
  });

  it('nothing is sent after an ALARM, and nothing is retried', async () => {
    const h = await probeHarness({ plate: null });
    await passTouch(h);
    const from = startProbe(h);
    await untilResult(h);
    expect(h.session.snapshot.probeZ.outcome).toMatchObject({ kind: 'noContact', status: 250 });
    await h.run(5000);
    expect(probeWrites(h, from)).toEqual(['G21', 'G91 G38.2 Z-5 F25']);
    // A second probe needs the owner's touch test and start again.
    expect(h.session.request({ intent: 'probeZ', step: 'start', confirm: true })).toMatchObject({ allowed: false });
  });

  it('no zero after Pause, even when the board reports contact', async () => {
    const h = await probeHarness({ plate: -0.2 });
    await passTouch(h);
    const from = startProbe(h);
    await runUntil(h, () => h.session.snapshot.probeZ.step === 'probing');
    h.session.feedhold();
    await untilResult(h);
    expect(probeWrites(h, from).filter((w) => w.startsWith('G10'))).toEqual([]);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'paused' });
  });
});
