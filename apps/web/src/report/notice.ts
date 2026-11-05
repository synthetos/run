/**
 * The notices a report can start from (REPORT_A_PROBLEM §2): a fault
 * (including an unexpected response from the board), motion this page did
 * not send (ORPHANED_MOTION), and an alarm the controller reports. Each
 * carries the event context the report pre-fills. Pure, from the snapshot
 * the worker already posted; it never asks the board anything.
 */
import type { WorkerStatus } from '../machine-worker/rpc.ts';
import type { ReportEvent } from './collect.ts';

type SessionSnapshot = WorkerStatus['session'];

export interface EventNotice {
  readonly kind: 'fault' | 'unexpected-response' | 'orphaned-motion' | 'alarm' | 'settings-defaulted';
  readonly title: string;
  readonly detail: string;
  readonly event: ReportEvent;
}

const ALARM_CLASSES = new Set(['alarm', 'shutdown', 'panic', 'softAlarm', 'interlock']);

const CAUSE_TEXT: Readonly<Record<string, string>> = {
  bannerAfterReady: 'The board printed its start-up banner after it was ready: it reset.',
  resetLoop: 'The board kept resetting while it was being identified.',
  writeFailed: 'Writing to the port failed.',
  writeRefused: 'run’s own write check refused bytes it had built.',
  unexpectedResponse: 'The board sent an answer run did not expect.',
  footerRevisionChanged: 'The board’s answer format changed during the session.',
  exceptionReport: 'The board reported an internal exception.',
};

/** The notice to show for this snapshot, or null. FAULT first, then ORPHANED_MOTION, then an alarm. */
export function eventNotice(s: (Pick<SessionSnapshot, 'base' | 'overlays' | 'fault' | 'live'> & Partial<Pick<SessionSnapshot, 'notices'>>) | null): EventNotice | null {
  if (s === null || s.base === 'NOT_CONNECTED') return null;
  const context = { state: s.base, overlays: [...s.overlays], line: typeof s.live.line === 'number' ? s.live.line : null, stat: typeof s.live.stat === 'number' ? s.live.stat : null };
  if (s.overlays.includes('FAULT')) {
    const cause = s.fault?.cause ?? 'unknown';
    const unexpected = cause === 'unexpectedResponse';
    const raw = s.fault?.detail ?? CAUSE_TEXT[cause] ?? 'The session stopped trusting the link.';
    const detail = raw.charAt(0).toUpperCase() + raw.slice(1);
    return {
      kind: unexpected ? 'unexpected-response' : 'fault',
      title: unexpected ? 'Unexpected response.' : 'Fault.',
      detail,
      event: { code: `FAULT ${cause}`, message: CAUSE_TEXT[cause] === undefined ? raw : `${CAUSE_TEXT[cause]} (${raw})`, ...context },
    };
  }
  if (s.overlays.includes('ORPHANED_MOTION')) {
    return {
      kind: 'orphaned-motion',
      title: 'Motion this page did not send.',
      detail: 'Held or queued moves from a previous session.',
      event: { code: 'ORPHANED_MOTION', message: 'The board had held or queued moves when this page connected.', ...context },
    };
  }
  const cls = s.live.machineClass;
  if (cls !== undefined && ALARM_CLASSES.has(cls)) {
    return {
      kind: 'alarm',
      title: 'The controller reports an alarm.',
      detail: `Machine state: ${cls}.`,
      event: { code: `ALARM ${cls}`, message: `The controller reported machine state ${cls}.`, ...context },
    };
  }
  // TinyG 450.02+ (N61): stored settings that would not load now run on their defaults.
  const defaulted = s.notices?.settingsDefaulted;
  if (defaulted !== undefined) {
    return {
      kind: 'settings-defaulted',
      title: 'Some saved settings were reset to their defaults.',
      detail: `The board could not load them at start-up: ${defaulted.text.replace(/^Settings restored to defaults - /i, '')}. Check them in Board, All settings, before you run a job.`,
      event: { code: 'STATUS 118', message: `The board reset stored settings to their defaults: ${defaulted.text}`, ...context },
    };
  }
  return null;
}
