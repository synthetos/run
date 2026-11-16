import { describe, expect, it } from 'vitest';
import { type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS, TG_ANSWERS, tg } from './sessionDriver.ts';
import { EN_APPROVED, connected } from './sessionReducerFixtures.ts';

describe('an unclassified board is checked for rest from its {sr:null} answer (SAFETY H14 mitigation 5, T-S60)', () => {

  const HELD_SR = '{"r":{"sr":{"line":0,"posx":1.5,"vel":0,"unit":1,"stat":6,"hold":6}},"f":[3,0,10]}';


  it('a held board whose probe answer arrives damaged is ORPHANED_MOTION, not only READ_ONLY', () => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, sr: HELD_SR }, (t) => t === 'hp');
    d.written();
    d.line('{"r":{"hp":1},"f":[3,0');
    expect(d.state.classification).toMatchObject({ dialectId: null, reason: 'probeFailed' });
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    expect(d.intent({ intent: 'stopJob' })).toEqual({ allowed: true });
  });


  it('a held board whose probe cannot be built is ORPHANED_MOTION', () => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, sr: HELD_SR }, (t) => t === 'spph');
    const probe = d.state.probe;
    if (probe === null) throw new Error('no probe');
    d.state = { ...d.state, probe: { ...probe, answers: probe.answers.filter(([k]) => k !== 'fb') } };
    d.answer(EN_ANSWERS);
    expect(d.state.classification).toMatchObject({ dialectId: null, reason: 'probeFailed' });
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });


  it('a held board that no dialect matches (READING never runs) is ORPHANED_MOTION', () => {
    const d = connected({ ...EN_ANSWERS, sr: HELD_SR, fv: '{"r":{"fv":0.5},"f":[3,0,10]}' });
    expect(d.state.classification).toMatchObject({ dialectId: null });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    const resting = connected({ ...EN_ANSWERS, fv: '{"r":{"fv":0.5},"f":[3,0,10]}' });
    expect(resting.state.overlays).toEqual(['READ_ONLY']);
  });


  it('a classified board already ORPHANED_MOTION at the end of the probe skips READING', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'spph');
    d.written();
    d.line('{"sr":{"vel":12}}');
    d.line(EN_ANSWERS.spph as string);
    expect(d.state.classification).toMatchObject({ dialectId: 'tinyg-en' });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });


  it.each([
    ['stat missing', '{"r":{"sr":{"posx":0,"vel":0}},"f":[3,0,10]}'],
    ['stat 3', '{"r":{"sr":{"posx":0,"vel":0,"stat":3}},"f":[3,0,10]}'],
    ['vel not 0', '{"r":{"sr":{"posx":0,"vel":4,"stat":1}},"f":[3,0,10]}'],
    ['hold not 0', '{"r":{"sr":{"posx":0,"vel":0,"stat":1,"hold":4}},"f":[3,0,10]}'],
  ])('damaged probe, %s: ORPHANED_MOTION', (_label, sr) => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, sr }, (t) => t === 'hp');
    d.written();
    d.line('{"r":{"hp":1},"f":[3,0');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });


  it('a resting board (stat 1 or 4, vel 0) with a damaged probe stays READ_ONLY only', () => {
    for (const stat of [1, 4]) {
      const d = new Driver();
      d.open();
      d.answer({ ...EN_ANSWERS, sr: `{"r":{"sr":{"posx":0,"vel":0,"stat":${stat}}},"f":[3,0,10]}` }, (t) => t === 'hp');
      d.written();
      d.line('{"r":{"hp":1},"f":[3,0');
      expect(d.state.overlays).toEqual(['READ_ONLY']);
    }
  });
});

describe('the resting check on 440.21 uses only stat and vel (SAFETY H14 mitigation 2)', () => {

  it('an idle, empty 440.21 board that reports hold != 0 is not ORPHANED_MOTION', () => {
    const d = connected({ ...TG_ANSWERS, hold: tg('{"hold":3}') });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });


  it('a 440.21 board whose hold read fails is not ORPHANED_MOTION either', () => {
    const d = connected({ ...TG_ANSWERS, hold: tg('{}', 100) });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });


  it('edge-next still requires hold = 0', () => {
    const d = connected({ ...EN_ANSWERS, hold: '{"r":{"hold":3},"f":[3,0,10]}' });
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });
});

describe('flow control: ex 0, 1 and 2 keep an approved session full; any other ex is READ_ONLY (OD-33; PN §5.3)', () => {

  const logs = (d: Driver): string[] => d.effects.filter((e) => e.kind === 'log').map((e) => (e as Extract<SessionEffect, { kind: 'log'; }>).text);


  it('ex = 0, 1 and 2 (RTS/CTS, with RTS held on, rts.ts) keep the approved session full', () => {
    for (const v of [0, 1, 2]) {
      const d = connected({ ...EN_ANSWERS, ex: `{"r":{"ex":${v}},"f":[3,0,10]}` }, { manifest: EN_APPROVED });
      expect(d.state.classification, String(v)).toMatchObject({ dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved' });
      expect(d.state.overlays, String(v)).toEqual([]);
      expect(d.state.live.ex).toBe(v);
      expect(logs(d).some((l) => l.includes('flow control'))).toBe(false);
    }
  });


  it('an ex that cannot be read, or one Run does not know, ends READ_ONLY with reason flowControl (fail closed)', () => {
    for (const ex of ['{"r":{},"f":[3,100,10]}', '{"r":{"ex":"2"},"f":[3,0,10]}', '{"r":{"ex":3},"f":[3,0,10]}']) {
      const d = connected({ ...EN_ANSWERS, ex }, { manifest: EN_APPROVED });
      expect(d.state.classification, ex).toMatchObject({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'flowControl', buildIdentity: 'fbOnly' });
      expect(d.state.overlays, ex).toEqual(['READ_ONLY']);
    }
    const three = connected({ ...EN_ANSWERS, ex: '{"r":{"ex":3},"f":[3,0,10]}' }, { manifest: EN_APPROVED });
    expect(three.state.classification?.detail).toContain('flow control (ex) is 3: read-only, Run knows only ex 0, 1 and 2');
    expect(logs(three)).toContain('classification: read-only, flow control (ex) is 3');
  });


  it('a board already READ_ONLY keeps its classifier reason (440.21 at ex = 2)', () => {
    const d = connected({ ...TG_ANSWERS, ex: tg('{"ex":2}') });
    expect(d.state.classification).toMatchObject({ dialectId: 'tinyg-440', mode: 'readOnly', reason: 'tg440-not-approved' });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });
});
