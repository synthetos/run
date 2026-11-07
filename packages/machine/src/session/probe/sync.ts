/**
 * Probe Z: what is decided again after every event (SAFETY §4.5c; T-S128, T-S129), and the probe's checks in the
 * write gate. `syncProbe` runs at the end of each transition: it keeps the block current and lapses a touch test
 * on any change of position, base state, overlay or input configuration, or when a block arrives.
 */
import type { SessionConfig, SessionState, PendingRead } from '../types.ts';
import { activeSystem } from '../motion.ts';
import { probeCapable, probeBlock } from './gate.ts';
import { tick, setProbe, runProbeLine, type ProbeTx } from './common.ts';
import { PROBE_CLOSED, SETTING_TOKENS, TOUCH_NONE, probeRunning, type ProbeZState } from './state.ts';
import { zeroLine } from './zero.ts';

/** Position, state (the session's and the board's) and input configuration: a touch test is good only while this stays the same. */
export function anchorOf(s: SessionState): string {
  const { x, y, z } = s.live.mpo;
  const settings = s.probeZ.settings;
  return JSON.stringify([s.base, s.overlays, s.live.stat ?? null, [x, y, z].map((v) => (v === undefined ? null : v.toFixed(3))), settings.modes, settings.prbp, settings.zjh]);
}

export function syncProbe(t: ProbeTx): void {
  const s = t.s;
  const p = s.probeZ;
  const block = probeBlock(s, t.config);
  if (block !== p.block) setProbe(t, { block });
  if ((p.step !== 'touch' && p.step !== 'ready') || p.refreshing) return;
  const anchor = block === null ? anchorOf(t.s) : null;
  if (anchor !== p.anchor) {
    // A lapse: back to the start of the touch test (it starts again by itself once nothing blocks it).
    setProbe(t, { step: 'touch', touch: TOUCH_NONE, touchAt: null, passedAt: null, anchor });
  }
  if (anchor !== null && t.s.probeZ.touch.problem === null && t.s.timers.probe === undefined) tick(t);
}

/** The probe's settings, read once at connect after the full state read, on a board that can probe. */
export function probeSeedReads(s: SessionState, config: SessionConfig): readonly PendingRead[] {
  return probeCapable(s, config) ? SETTING_TOKENS.map((token) => ({ token, purpose: 'probeZ' as const })) : [];
}

/**
 * Across a disconnect or reconnect: only "the plate is out" and the last result are kept. A run cannot be in progress
 * (Disconnect is refused while it moves, and a lost link has already ended it).
 */
export function probeCarried(p: ProbeZState): ProbeZState {
  return { ...PROBE_CLOSED, plateOut: p.plateOut, outcome: p.outcome, step: p.step === 'result' ? 'result' : 'closed' };
}

/** The write gate: `line` is exactly the probe's own `G38.2` while it starts, or its zero while it zeroes. */
export function probeLineWritable(s: SessionState, line: string): boolean {
  const p = s.probeZ;
  const own = s.queue.some((q) => q.purpose === 'probeZ' && q.line === line) || (s.writing?.purpose === 'probeZ' && s.writing.line === line);
  if (!own || p.run === null || p.plan === null) return false;
  if (p.step === 'starting') return line === runProbeLine(p.plan);
  const system = activeSystem(s);
  return p.step === 'zeroing' && p.run.zero === 'line' && system !== null && line === zeroLine(system, p.plan);
}

/** The write gate: ^D only for a probe (Stop job during a probe is ^D, §4.5c), on a dialect that has it. */
export function probeKillWritable(s: SessionState): boolean {
  return (probeRunning(s.probeZ.step) || s.probeZ.alarmExpected) && s.dialect?.realtime.kill !== undefined;
}
