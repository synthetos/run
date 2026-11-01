/**
 * The audible alarm (ROADMAP P1-04; SAFETY §4.3 "Audible alarms", §5 W3,
 * T-S30).
 *
 * Browsers start an AudioContext suspended until the page has a user
 * gesture, so the context is created and resumed inside the Connect click
 * (`unlock`, called synchronously from that handler). After that the alarm
 * can sound with nobody touching the page, which is exactly when it matters:
 * the link dropped (W3). W12 and FAULT during a job join it when jobs exist.
 *
 * Sound is never counted as a mitigation on its own (SAFETY §4.3): the
 * banner is always shown, with or without audio.
 *
 * The tone is a square wave pulsed by a second, low-frequency square wave
 * (about two beeps a second), built from audio nodes only, so it keeps
 * going without page timers (Chrome throttles those in hidden tabs).
 */
import type { SessionSnapshot } from '@synthetos/machine';

/** The tone's pitch. */
export const ALARM_TONE_HZ = 880;
/** Beeps per second (the pulse oscillator's frequency). */
export const ALARM_PULSE_HZ = 2;
/** Peak gain of the tone. */
export const ALARM_GAIN = 0.25;

/** Creates the page's AudioContext (`() => new AudioContext()` in the page; a fake in tests). */
export type AudioContextFactory = () => AudioContext;

export type AlarmState = 'unavailable' | 'locked' | 'running';

/** The overlays that sound the alarm in this release: LOST (W3). */
export function alarmWanted(snapshot: Pick<SessionSnapshot, 'overlays'> | null): boolean {
  return snapshot !== null && snapshot.overlays.includes('LOST');
}

export class AlarmTone {
  readonly #factory: AudioContextFactory | null;
  #context: AudioContext | null = null;
  #nodes: { readonly tone: OscillatorNode; readonly pulse: OscillatorNode } | null = null;

  /** `factory` null: no Web Audio in this browser; the banners still show. */
  constructor(factory: AudioContextFactory | null) {
    this.#factory = factory;
  }

  /**
   * Creates and resumes the AudioContext. Call it synchronously inside the
   * Connect gesture, before anything awaits: that is what lets the alarm
   * sound later without a gesture. Never throws.
   */
  unlock(): void {
    try {
      this.#context ??= this.#factory?.() ?? null;
      void this.#context?.resume().catch(() => undefined);
    } catch {
      this.#context = null;
    }
  }

  get state(): AlarmState {
    if (this.#context === null) return 'unavailable';
    return this.#context.state === 'running' ? 'running' : 'locked';
  }

  get sounding(): boolean {
    return this.#nodes !== null;
  }

  /** Starts the tone if it is not already sounding. Returns whether it is sounding. Never throws. */
  start(): boolean {
    const context = this.#context;
    if (this.#nodes !== null || context === null) return this.#nodes !== null;
    try {
      // A context the browser suspended again (some do after a long idle): try to resume; nodes play once it runs.
      if (context.state !== 'running') void context.resume().catch(() => undefined);
      const tone = context.createOscillator();
      tone.type = 'square';
      tone.frequency.value = ALARM_TONE_HZ;
      const out = context.createGain();
      out.gain.value = ALARM_GAIN / 2;
      const pulse = context.createOscillator();
      pulse.type = 'square';
      pulse.frequency.value = ALARM_PULSE_HZ;
      const depth = context.createGain();
      depth.gain.value = ALARM_GAIN / 2;
      // gain = ALARM_GAIN/2 ± ALARM_GAIN/2: on, off, on, off.
      pulse.connect(depth);
      depth.connect(out.gain);
      tone.connect(out);
      out.connect(context.destination);
      tone.start();
      pulse.start();
      this.#nodes = { tone, pulse };
    } catch {
      this.#nodes = null;
    }
    return this.#nodes !== null;
  }

  stop(): void {
    const nodes = this.#nodes;
    this.#nodes = null;
    if (nodes === null) return;
    for (const node of [nodes.tone, nodes.pulse]) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Already stopped: nothing to do.
      }
    }
  }

  /** Sounds the tone while the snapshot wants it, silences it otherwise. */
  sync(snapshot: Pick<SessionSnapshot, 'overlays'> | null): void {
    if (alarmWanted(snapshot)) this.start();
    else this.stop();
  }
}
