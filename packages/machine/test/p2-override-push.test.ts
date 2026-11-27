/**
 * TinyG 450.06 pushes `{"ov":{...}}` when `{"rt":null}` is read (rt_get_ov sets ov_ask; rt_override_callback sends
 * the frame, @cite TG runtime.c rt_override_callback). On the owner's board (2026-11-26) the push arrived between
 * the rt probe's answer and the heartbeat's: run read it as a damaged answer, dropped the heartbeat's place, and
 * then faulted on `{"r":{"rt":{"hb":1}}}` as "a response nobody asked for". The push is a report, never an answer.
 */
import { type ApprovedBuilds, classifyLine } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { RUN_SR_FIELDS } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};
const OK = '{"r":{},"f":[3,0,10]}';
const RUN_SR = `{"r":{"sr":{${RUN_SR_FIELDS.map((f) => `"${f}":0`).join(',')}}},"f":[3,0,10]}`;
const OV = '{"ov":{"v":1,"q":1,"mfo":1.000,"mfc":1.000,"mfe":1,"capped":false}}';
const RT = '{"r":{"rt":{"hb":0,"qt":null,"up":3,"mfo":1.000,"mfe":1}},"f":[3,0,10]}';

describe('the 450.06 override push', () => {
  it('is classified as an override report, not a damaged line', () => {
    const c = classifyLine(OV);
    expect(c.kind).toBe('OverrideReport');
  });

  it('arriving between the rt probe and the heartbeat answers does not fault the session', () => {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    d.answer({ ...EN_ANSWERS, gc: OK, sr: RUN_SR, rt: RT }, () => d.state.reports.phase === 'configuring');
    expect(d.state.reports.step?.kind).toBe('rtProbe');
    d.written();
    d.line(RT);
    expect(d.state.reports.step?.kind).toBe('heartbeat');
    d.line(OV);
    d.written();
    d.line('{"r":{"rt":{"hb":1}},"f":[3,0,10]}');
    expect(d.state.overlays).not.toContain('FAULT');
    expect(d.state.reports).toMatchObject({ phase: 'done', heartbeatMs: 1000 });
  });
});
