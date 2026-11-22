/**
 * The port in bootloader role for an update (flashService.ts step 3), and recovery's ways in (H80; owner report
 * 2026-11-21, TinyG v8 3Y2462-WWR).
 *
 * Recovery first looks at what is on the port (`lookFirst`): xboot answering the AVR109 check is used at once; a
 * firmware that answers the one line end (markProbe.ts) is running, so the update goes in the normal way
 * (`{"boot":1}`, xboot's 60 s window) instead of waiting for a reset. Only a silent board gets the wait
 * (`waitForBootloader`): ESC and S go out continuously, so xboot's short window after a Reset (about 3 s on a v8,
 * longer on newer xboot builds) is caught whenever it comes. On a TinyG v8 the USB bridge is powered by USB and the
 * processor is not, so replugging USB does not reset the board: the person presses Reset or switches its power off
 * and on. Cancel closes the link the wait holds, which ends it at once.
 */
import type { FlashEntryTrace } from './flashEntryTrace.ts';
import { BootloaderLink, type EventLog, type PortSelector, type SessionClock, type SessionExecutor, type Transport, type TransportSource } from '@synthetos/machine';
import { X192A3, XbootClient, recoverEntry, type FlashAuthorization } from '@synthetos/flasher';
import { avr109Check, firmwareAnswers } from './markProbe.ts';
import { entryDiagnosis } from './flashDiagnosis.ts';

/** The recovery wait: Reset (or the board's power switched off and on) within this time. */
export const RECOVERY_MS = 45_000;

export interface EntryDeps {
  readonly session: SessionExecutor;
  readonly source: TransportSource;
  readonly clock: SessionClock;
  readonly transcript: EventLog | null;
  readonly trace?: FlashEntryTrace;
}

export function sleep(clock: SessionClock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

/** The same port in bootloader role, once the session's link has closed it; null when it cannot be had. */
export async function openFlashLink(d: EntryDeps, auth: FlashAuthorization, port: PortSelector): Promise<BootloaderLink | null> {
  // The FTDI bridge stays on the bus while the board resets: the same port, asked for by the same selector, once the
  // session's link has closed it (a port that is still closing cannot be opened again).
  await d.session.portReleased();
  await sleep(d.clock, 300);
  const inner = await d.source.request(port).catch(() => null);
  if (inner === null) return null;
  const link = new BootloaderLink(inner, d.clock, X192A3, d.transcript);
  d.trace?.track(link);
  const token = auth.capability();
  if (token === null) return null;
  await link.open(token);
  return link;
}

/** How long recovery lets a freshly connected session finish reading the board before `{"boot":1}`. */
export const SESSION_SETTLE_MS = 15_000;

/** Resolves once the session is past identifying and reading the board (or disconnected), or after `ms`. */
export function sessionSettled(session: SessionExecutor, clock: SessionClock, ms: number): Promise<void> {
  const settled = (s: SessionExecutor['snapshot']): boolean => s.base === 'NOT_CONNECTED' || (s.base !== 'IDENTIFYING' && s.base !== 'READING');
  if (settled(session.snapshot)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = clock.setTimeout(() => { unsubscribe(); resolve(); }, ms);
    const unsubscribe = session.subscribe((s) => {
      if (!settled(s)) return;
      clock.clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

/** What recovery found on the port before any wait. */
export type FirstLook =
  | { readonly kind: 'bootloader'; readonly link: BootloaderLink }
  | { readonly kind: 'firmware'; readonly transport: Transport }
  | { readonly kind: 'silent' };

/** ESC and S, then (silent) the one line end; the port stays open for what answered, and closes otherwise. */
export async function lookFirst(d: EntryDeps, port: PortSelector): Promise<FirstLook> {
  await d.session.portReleased();
  const inner = await d.source.request(port).catch(() => null);
  if (inner === null) return { kind: 'silent' };
  const link = new BootloaderLink(inner, d.clock, X192A3, d.transcript);
  d.trace?.track(link);
  try {
    await link.openProbe();
    if (await avr109Check(link, true)) return { kind: 'bootloader', link };
    if (await firmwareAnswers(link)) return { kind: 'firmware', transport: link.applicationTransport() };
  } catch {
    // A port that fails here is no answer: the wait below reopens it.
  }
  await link.close().catch(() => undefined);
  return { kind: 'silent' };
}

export interface RecoveryWait {
  /** False once the wait should end (cancelled, or another run started). */
  readonly alive: () => boolean;
  readonly show: (patch: { readonly countdown: number | null; readonly note: string | null }) => void;
  /** The link the wait holds now (null: none). Cancel closes it. */
  readonly holding: (link: BootloaderLink | null) => void;
}

export interface RecoverySteps {
  /** The bootloader link Connect kept open (a board found in its bootloader), if any. */
  readonly waiting: () => Promise<BootloaderLink | null>;
  /** The firmware answered: connect the session and check the board id. Null when it is the board to recover. */
  readonly firmware: (transport: Transport) => Promise<string | null>;
  readonly wait: RecoveryWait;
}

/** Use `link` for this update (a fresh capability); null, port closed, when it can no longer be. */
async function authorized(link: BootloaderLink, auth: FlashAuthorization): Promise<BootloaderLink | null> {
  try {
    link.authorizeUpdate(auth.capability() ?? undefined);
    return link;
  } catch {
    await link.close().catch(() => undefined);
    return null;
  }
}

/**
 * Recovery's way in: a bootloader link open for this update, `'firmware'` when the firmware runs and the session is
 * connected to the right board (the caller sends `{"boot":1}`), or why not.
 */
export async function recoveryEntry(d: EntryDeps, auth: FlashAuthorization, port: PortSelector, steps: RecoverySteps): Promise<BootloaderLink | 'firmware' | string> {
  const kept = await steps.waiting();
  const ready = kept === null ? null : await authorized(kept, auth);
  if (ready !== null) return ready;
  const first = await lookFirst(d, port);
  const found = first.kind === 'bootloader' ? await authorized(first.link, auth) : null;
  if (found !== null) return found;
  if (first.kind === 'firmware') return (await steps.firmware(first.transport)) ?? 'firmware';
  const link = await waitForBootloader(d, auth, port, steps.wait);
  if (link !== null) return link;
  return steps.wait.alive() ? `The bootloader did not answer. ${entryDiagnosis(d.transcript?.events() ?? [])}` : 'Recovery was cancelled. Nothing was written.';
}

/** Keep the port open and send ESC and S until the bootloader answers; reopen it when it drops. */
export async function waitForBootloader(d: EntryDeps, auth: FlashAuthorization, port: PortSelector, w: RecoveryWait): Promise<BootloaderLink | null> {
  const start = d.clock.now();
  while (d.clock.now() - start < RECOVERY_MS && w.alive()) {
    const left = RECOVERY_MS - (d.clock.now() - start);
    const link = await openFlashLink(d, auth, port).catch(() => null);
    w.holding(link);
    if (link === null) {
      w.show({ countdown: Math.ceil(left / 1000), note: 'Waiting for the board on USB…' });
      await sleep(d.clock, 500);
      continue;
    }
    try {
      await recoverEntry(new XbootClient(link, d.clock, X192A3), () => d.clock.now(), left, (seconds) => w.show({ countdown: seconds, note: null }), (ms) => sleep(d.clock, ms));
      w.show({ countdown: null, note: 'The bootloader answered.' });
      return link;
    } catch {
      w.holding(null);
      await link.close().catch(() => undefined);
      await sleep(d.clock, 300);
    }
  }
  return null;
}
