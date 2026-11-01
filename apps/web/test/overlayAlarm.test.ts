/**
 * ROADMAP P1-04: W3 (LOST) and W4 (STALE) banners and the audible alarm
 * (T-S30: W3 renders with role="alert"/aria-live="assertive" and starts the
 * alarm tone; the AudioContext is running after the Connect gesture).
 * The browser-level run of the same checks needs the connect UI (P1-05).
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { w3, w4 } from '@synthetos/safety';
import { ALARM_TONE_HZ, AlarmTone, alarmWanted } from '../src/machine-ui/alarm.ts';
import { OverlayBanners, staleSeconds } from '../src/machine-ui/OverlayBanners.ts';
import { expand, root, text } from './tree.ts';

/** A minimal Web Audio fake: suspended until resumed, records what was built and started. */
class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  resumed = 0;
  readonly destination = { node: 'destination' };
  readonly oscillators: FakeOscillator[] = [];
  resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  createGain(): { gain: { value: number }; connect: (to: unknown) => void } {
    return { gain: { value: 1 }, connect: () => undefined };
  }
}

class FakeOscillator {
  type = 'sine';
  readonly frequency = { value: 440 };
  started = false;
  stopped = false;
  connect(): void {}
  disconnect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

function tone(): { alarm: AlarmTone; contexts: FakeAudioContext[] } {
  const contexts: FakeAudioContext[] = [];
  const alarm = new AlarmTone(() => {
    const c = new FakeAudioContext();
    contexts.push(c);
    return c as unknown as AudioContext;
  });
  return { alarm, contexts };
}

describe('T-S30: W3 renders as an assertive alert and starts the alarm tone', () => {
  it('LOST renders W3 with role="alert" and aria-live="assertive", the exact SAFETY string', () => {
    const el = root(h(OverlayBanners, { snapshot: { overlays: ['LOST', 'STALE'], stale: { silentForMs: 2500 } }, staleElapsedMs: 0 }));
    expect(el.props['role']).toBe('alert');
    expect(el.props['aria-live']).toBe('assertive');
    expect(el.props['data-safety']).toBe('W3');
    expect(text(el)).toBe(w3());
  });

  it('the AudioContext is created and resumed in the Connect gesture, so the tone can start later without one', () => {
    const { alarm, contexts } = tone();
    expect(alarm.state).toBe('unavailable');
    alarm.unlock();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.resumed).toBe(1);
    expect(alarm.state).toBe('running');
    alarm.unlock();
    expect(contexts).toHaveLength(1); // one context per page
    alarm.sync({ overlays: ['LOST'] });
    expect(alarm.sounding).toBe(true);
    const [toneOsc] = contexts[0]?.oscillators ?? [];
    expect(toneOsc?.frequency.value).toBe(ALARM_TONE_HZ);
    expect(contexts[0]?.oscillators.every((o) => o.started)).toBe(true);
    // Sounding again does not stack a second tone.
    alarm.sync({ overlays: ['LOST'] });
    expect(contexts[0]?.oscillators).toHaveLength(2);
    // Acknowledged: silent.
    alarm.sync({ overlays: [] });
    expect(alarm.sounding).toBe(false);
    expect(contexts[0]?.oscillators.every((o) => o.stopped)).toBe(true);
  });

  it('only LOST sounds the alarm in this release; STALE alone does not', () => {
    expect(alarmWanted({ overlays: ['LOST'] })).toBe(true);
    expect(alarmWanted({ overlays: ['STALE', 'READ_ONLY'] })).toBe(false);
    expect(alarmWanted({ overlays: ['FAULT'] })).toBe(false);
    expect(alarmWanted(null)).toBe(false);
  });

  it('a context the browser suspended again is resumed when the alarm starts', () => {
    const { alarm, contexts } = tone();
    alarm.unlock();
    (contexts[0] as FakeAudioContext).state = 'suspended';
    expect(alarm.state).toBe('locked');
    expect(alarm.start()).toBe(true);
    expect(contexts[0]?.resumed).toBe(2);
  });

  it('never throws: no Web Audio, a factory that throws, or nodes that fail; the banner still shows', () => {
    const none = new AlarmTone(null);
    none.unlock();
    expect(none.start()).toBe(false);
    expect(none.state).toBe('unavailable');
    none.stop();
    const throwing = new AlarmTone(() => {
      throw new Error('blocked');
    });
    throwing.unlock();
    expect(throwing.state).toBe('unavailable');
    const broken = new AlarmTone(() => ({ state: 'running', resume: () => Promise.resolve(), createOscillator: () => { throw new Error('no'); } }) as unknown as AudioContext);
    broken.unlock();
    expect(broken.start()).toBe(false);
    const rejecting = new AlarmTone(() => ({ state: 'suspended', resume: () => Promise.reject(new Error('not allowed')) }) as unknown as AudioContext);
    rejecting.unlock();
    expect(rejecting.state).toBe('locked');
  });

  it('stopping nodes that already stopped is harmless', () => {
    const { alarm, contexts } = tone();
    alarm.unlock();
    alarm.start();
    for (const o of contexts[0]?.oscillators ?? []) o.stop = () => { throw new Error('already stopped'); };
    expect(() => alarm.stop()).not.toThrow();
    expect(alarm.sounding).toBe(false);
  });
});

describe('W4: the STALE banner', () => {
  it('counts the silence on from STALE entry, in whole seconds, as a polite status', () => {
    const el = root(h(OverlayBanners, { snapshot: { overlays: ['STALE', 'READ_ONLY'], stale: { silentForMs: 3000 } }, staleElapsedMs: 2400 }));
    expect(el.props['role']).toBe('status');
    expect(el.props['data-safety']).toBe('W4');
    expect(text(el)).toBe(w4({ seconds: 5 }));
    expect(staleSeconds({ stale: null }, -50)).toBe(0);
  });

  it('nothing when there is no session or neither overlay', () => {
    expect(expand(h(OverlayBanners, { snapshot: null, staleElapsedMs: 0 }))).toEqual([]);
    expect(expand(h(OverlayBanners, { snapshot: { overlays: ['READ_ONLY'], stale: null }, staleElapsedMs: 0 }))).toEqual([]);
  });
});
