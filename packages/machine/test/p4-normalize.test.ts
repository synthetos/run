/**
 * OD-14: a board whose GETs answer with no value (JSON verbosity below 3, bench 3 on 2026-11-04) is put right at
 * connect: {jv:4} once, its own reply, the firmware's 50 ms margin, then identification from the top.
 */
import { type ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_1_RELEASE, PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { RUN_SR_FIELDS, reportWritableIn, type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};
const EMPTY = '{"r":{},"f":[3,0,10]}';
const RUN_SR = `{"r":{"sr":{${RUN_SR_FIELDS.map((f) => `"${f}":0`).join(',')}}},"f":[3,0,10]}`;
const logs = (d: Driver): string[] => d.effects.filter((e) => e.kind === 'log').map((e) => (e as Extract<SessionEffect, { kind: 'log' }>).text);

describe('OD-14: GETs that answer empty get jv 4 at connect', () => {
  it('writes {jv:4} once, waits 50 ms after its reply, identifies again and classifies the board', () => {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    d.written();
    d.line('{"r":{"sr":{"posx":0.000,"stat":3}},"f":[3,0,10]}');
    expect(d.writing).toBe('fb');
    d.written();
    d.line(EMPTY);
    expect(d.lines().at(-1)).toBe('{jv:4}');
    expect(d.state.probe).toMatchObject({ normalized: true, normalizing: true });
    d.written();
    d.line('{"r":{"jv":4},"f":[3,0,10]}');
    expect(d.state.probe).toMatchObject({ normalizing: false, settling: 'ready' });
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'settle', seq: expect.any(Number), ms: 50 });
    d.fire('settle');
    expect(d.lines().at(-1)).toBe('{sr:null}');
    expect(d.state.probe).toMatchObject({ normalized: true, next: 0 });
    d.answer({ ...EN_ANSWERS, sr: RUN_SR });
    expect(d.state.classification?.dialectId).toBe('tinyg-en');
    expect(d.lines().filter((l) => l === '{jv:4}')).toHaveLength(1);
    expect(logs(d)).toContain('probe: jv is 4 (saved on the board); identifying the board again');
  });

  it('only once per link: empty answers after jv 4 leave the board unidentified; a refusal is said and changes nothing', () => {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    d.written();
    d.line('{"r":{"sr":{"stat":3}},"f":[3,0,10]}');
    d.written();
    d.line(EMPTY);
    d.written();
    d.line('{"r":{},"f":[3,108,10]}');
    expect(logs(d)).toContain('probe: the board refused {jv:4} (status 108): it stays unidentified');
    expect(d.lines().filter((l) => l === '{jv:4}')).toHaveLength(1);
    expect(d.state.classification).not.toBeNull();
    expect(d.state.classification?.dialectId ?? null).toBeNull();
  });

  it('a release without report configuration never writes jv', () => {
    const d = new Driver({ release: PHASE_1_RELEASE });
    d.open();
    d.written();
    d.line('{"r":{"sr":{"stat":1}},"f":[3,0,10]}');
    d.written();
    d.line(EMPTY);
    expect(d.lines()).not.toContain('{jv:4}');
    // A first answer with no state at all is not proof of rest either.
    const n = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    n.open();
    n.written();
    n.line('{"r":{"sr":{"posx":0}},"f":[3,0,10]}');
    n.written();
    n.line(EMPTY);
    expect(n.lines()).not.toContain('{jv:4}');
  });

  it('the write policy admits {jv:4} only while the probe is writing it', () => {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    expect(reportWritableIn(d.state, '{jv:4}')).toBe(false);
    d.written();
    d.line('{"r":{"sr":{"stat":3}},"f":[3,0,10]}');
    d.written();
    d.line(EMPTY);
    expect(reportWritableIn(d.state, '{jv:4}')).toBe(true);
  });
});

describe('OD-14 at the transport guard', () => {
  it('{jv:4} reaches the wire through the guard on a reports release; a moving board is never written to', () => {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    d.written();
    d.line('{"r":{"sr":{"stat":5}},"f":[3,0,10]}'); // moving
    d.written();
    d.line(EMPTY);
    expect(d.lines()).not.toContain('{jv:4}');
  });
});
