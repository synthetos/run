/**
 * Probe Z: may it run now? (SAFETY §4.5c "Where it runs" and "Preconditions", H90; T-S128.) Pure, over the
 * session's state; the session decides every command again with it, and the page shows its answer.
 */
import { jobActive } from '../jobState.ts';
import { activeSystem } from '../motion.ts';
import type { SessionBase, SessionConfig, SessionState } from '../types.ts';
import { PROBE_LIMITS, probeStopMm } from './limits.ts';
import { probeRunning, type ProbeSettings } from './state.ts';
import type { ProbeBlock } from './types.ts';

/** The first edge-next build whose probe cycle and report Run relies on (firmware facts, §4.5c). */
export const PROBE_MIN_FB = 450.02;

/** `in1`..`in8` in words. */
export const INPUT_LABELS: readonly string[] = Object.freeze(['X min', 'X max', 'Y min', 'Y max', 'Z min', 'Z max', 'A min', 'A max']);

/** SW_MODE_PROBE (EN switch.h:46). */
const PROBE_MODE = 4;

const UNCONNECTED: ReadonlySet<SessionBase> = new Set(['NOT_CONNECTED', 'PORT_REQUEST', 'OPENING', 'IDENTIFYING', 'READING', 'BLOCKED']);

/** An approved edge-next build of 450.02 or later, fully classified. Never TG, stock 449 or READ_ONLY. */
export function probeFirmware(s: SessionState): boolean {
  const fb = s.identity?.fb;
  return s.dialect?.id === 'tinyg-en' && s.classification?.mode === 'full' && !s.overlays.includes('READ_ONLY') && typeof fb === 'number' && fb >= PROBE_MIN_FB;
}

/** The session may probe on this board at all: the firmware, and the motion release (bench and staging only). */
export function probeCapable(s: SessionState, config: SessionConfig): boolean {
  return config.release.motion && probeFirmware(s);
}

/** The probe input: exactly one X/Y/Z min or max input in mode 4, read from the board. */
export type InputFind = { readonly kind: 'one'; readonly index: number } | { readonly kind: 'unread' | 'none' | 'many' | 'notZ' };

export function findProbeInput(settings: ProbeSettings): InputFind {
  if (settings.modes.some((m) => m === null)) return { kind: 'unread' };
  const probes = settings.modes.flatMap((m, i) => (m === PROBE_MODE ? [i] : []));
  if (probes.length === 0) return { kind: 'none' };
  if (probes.length > 1) return { kind: 'many' };
  const index = probes[0] as number;
  // Z min or Z max: on X, Y or A the probe would not move along Z (an A input is refused by the firmware too, 254).
  return index === 4 || index === 5 ? { kind: 'one', index } : { kind: 'notZ' };
}

/** The probe input's token (`in5`) and words, or null when there is not exactly one Z probe input. */
export function probeInput(settings: ProbeSettings): { readonly index: number; readonly token: string; readonly label: string } | null {
  const found = findProbeInput(settings);
  return found.kind === 'one' ? { index: found.index, token: `in${found.index + 1}`, label: INPUT_LABELS[found.index] as string } : null;
}

/**
 * The spindle is commanded on, by the board's own readouts. They are display values elsewhere (types.ts LiveState):
 * here they can only refuse more, never allow, and the owner also confirms the spindle is stopped (H90 mitigation 4).
 */
function spindleOn(s: SessionState): boolean {
  return s.live.spe === 1 || (s.live.spc !== undefined && s.live.spc !== 0);
}

/** A temporary offset (G92) is in force, from the session's last read of `g92`; null when it was not read. */
function tempOffset(s: SessionState): boolean | null {
  const read = s.values['g92'];
  const offsets = read !== undefined && read.status === 0 && typeof read.value === 'object' && read.value !== null && !Array.isArray(read.value) ? Object.values(read.value) : null;
  return offsets === null || !offsets.every((v) => typeof v === 'number') ? null : offsets.some((v) => v !== 0);
}

const INPUT_BLOCK: Readonly<Record<'none' | 'many' | 'notZ', ProbeBlock>> = { none: 'noInput', many: 'manyInputs', notZ: 'inputNotZ' };

/**
 * Why Probe Z cannot run now, or null. First match wins, from the connection to the machine. FAULT and
 * ORPHANED_MOTION have no block of their own: FAULT reads as `stale` (nothing is trusted until it is acknowledged)
 * and ORPHANED_MOTION as `moving`. While the probe itself runs, its own move is not a reason.
 */
export function probeBlock(s: SessionState, config: SessionConfig): ProbeBlock | null {
  const o = s.overlays;
  if (UNCONNECTED.has(s.base)) return 'notConnected';
  if (o.includes('LOST')) return 'lost';
  if (!config.release.motion) return 'motionOff';
  if (!probeFirmware(s)) return 'firmware';
  if (o.includes('FAULT') || o.includes('STALE')) return 'stale';
  if (o.includes('ORPHANED_MOTION')) return 'moving';
  if (o.includes('UNKNOWN') || s.base === 'CONNECTED_UNKNOWN') return 'unknown';
  if (o.includes('NEEDS_REVIEW')) return 'needsReview';
  const settings = s.probeZ.settings;
  const input = findProbeInput(settings);
  const g92 = tempOffset(s);
  if (input.kind === 'unread' || settings.prbp === null || g92 === null) return 'settingsUnread';
  if (input.kind !== 'one') return INPUT_BLOCK[input.kind];
  const stop = probeStopMm(PROBE_LIMITS.feed.min, settings.zjh);
  if (stop === null) return 'jerkUnread';
  if (stop > PROBE_LIMITS.maxStopMm) return 'stopOverLimit';
  if (s.base === 'ALARM') return 'alarm';
  if (s.base === 'PROGRAM_PAUSED' && s.job?.phase === 'toolChange') return 'toolChange';
  if (jobActive(s)) return 'job';
  if (s.base === 'HOMING') return 'homing';
  if (s.base === 'HELD') return 'held';
  if (!probeRunning(s.probeZ.step) && ((s.base !== 'IDLE_UNHOMED' && s.base !== 'IDLE_HOMED') || s.motion !== null)) return 'moving';
  if (spindleOn(s)) return 'spindleOn';
  if (g92) return 'tempOffset';
  if (activeSystem(s) === null) return 'noWcs';
  return null;
}
