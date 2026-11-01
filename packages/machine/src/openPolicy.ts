/**
 * What `Transport.open` may do, decided before any port is opened (ROADMAP
 * P0-12; SAFETY §3 OPENING "115200, flowControl 'none'; refuse 1200; refuse
 * 2341:003D before open", T-S16; PN §3, §7.4; RUN_PLAN §5.1 rule 5).
 *
 * Everything per controller family comes from `Dialect.transport`:
 * - USB identities with role `refuse` are never opened, token or not. The
 *   Arduino Due programming port (2341:003D) is one: any DTR edge resets the
 *   SAM3X and opening it at 1200 baud erases it (OLD-PN §3.2).
 * - USB identities with role `bootloader` (SAM-BA) are opened only with a
 *   `BootloaderCapability`: only the flasher talks to them.
 * - The baud rates a session may open at are the dialects' own (115200).
 *   Any other rate on TinyG's UART turns traffic into garbage in which `!`,
 *   ^D or ^X can appear by chance, so it is refused rather than tried.
 * - A baud rate any dialect lists in `refuseBaudRates` (1200, the SAM-BA
 *   touch) needs the capability. The 1200 rule is also stated here directly,
 *   so it holds even if a data edit dropped it.
 * - `flowControl` must be `'none'` (PN §7.4: `'hardware'` waits on B-FC-1).
 * - `bufferSize` must be 256, the bound on bytes Web Serial can hold queued
 *   (OLD-TP §4.2; SAFETY H2b).
 */
import { DIALECTS, type Dialect, type UsbIdentity } from '@synthetos/protocol';
import type { TransportInfo, TransportOpenOptions } from './transport.ts';

/** The SAM-BA touch rate (@cite MOT MotateUSBCDC.h:537-548). Never opened without the capability. */
export const BOOTLOADER_TOUCH_BAUD = 1200;

/** The only `bufferSize` run opens with (OLD-TP §4.2). */
export const TRANSPORT_BUFFER_SIZE = 256;

/** The Arduino Due programming port, which `open` always refuses (S T-S16). */
export const DUE_PROGRAMMING_PORT = Object.freeze({ vendorId: 0x2341, productId: 0x003d });

function usbIdentities(dialects: readonly Dialect[], role: UsbIdentity['role']): readonly UsbIdentity[] {
  return Object.freeze(dialects.flatMap((d) => d.transport.usb.filter((u) => u.role === role)));
}

/**
 * USB identities `open` refuses outright, from `dialects`. The Due
 * programming port is listed directly as well, so it stays refused even if
 * a data edit dropped it from the g2core dialect.
 */
export function refusedPortsOf(dialects: readonly Dialect[]): readonly UsbIdentity[] {
  return Object.freeze([
    ...usbIdentities(dialects, 'refuse'),
    Object.freeze({ ...DUE_PROGRAMMING_PORT, role: 'refuse' as const, label: 'Arduino Due programming port' }),
  ]);
}

/** Baud rates that need the capability: every dialect's `refuseBaudRates`, and 1200 always. */
export function capabilityBaudRatesOf(dialects: readonly Dialect[]): ReadonlySet<number> {
  return Object.freeze(new Set([BOOTLOADER_TOUCH_BAUD, ...dialects.flatMap((d) => d.transport.refuseBaudRates)]));
}

/** USB identities `open` refuses outright. Always includes the Due programming port. */
export const REFUSED_PORTS: readonly UsbIdentity[] = refusedPortsOf(DIALECTS);

/** USB identities only the flasher opens. */
export const BOOTLOADER_PORTS: readonly UsbIdentity[] = usbIdentities(DIALECTS, 'bootloader');

/** Baud rates a session opens at without a capability: each dialect's own. */
export const SESSION_BAUD_RATES: ReadonlySet<number> = Object.freeze(new Set(DIALECTS.map((d) => d.transport.baudRate)));

/** The options a session on `dialect` opens with: its baud rate (dialect data), flowControl 'none', the one buffer size. */
export function sessionOpenOptionsFor(dialect: Dialect): TransportOpenOptions {
  return Object.freeze({ baudRate: dialect.transport.baudRate, flowControl: 'none', bufferSize: TRANSPORT_BUFFER_SIZE });
}

/**
 * The options a session opens with before the board is classified (SAFETY
 * §3 OPENING). The dialect is not known yet, so the baud rate must be the one
 * every dialect uses; it is derived from dialect data, and module load fails
 * if the dialects ever disagree (a family-aware open is then required, not a
 * silent guess).
 */
export const SESSION_OPEN_OPTIONS: TransportOpenOptions = sharedSessionOptions(DIALECTS);

/** The single-baud session options for `dialects`. Throws when they do not share one baud rate. */
export function sharedSessionOptions(dialects: readonly Dialect[]): TransportOpenOptions {
  const rates = new Set(dialects.map((d) => d.transport.baudRate));
  const [only] = rates;
  if (rates.size !== 1 || only === undefined) {
    throw new Error(`dialects do not share one session baud rate (${[...rates].join(', ')}): the open needs the family first`);
  }
  return Object.freeze({ baudRate: only, flowControl: 'none', bufferSize: TRANSPORT_BUFFER_SIZE });
}

/** Baud rates that need the capability. Always includes 1200. */
export const CAPABILITY_BAUD_RATES: ReadonlySet<number> = capabilityBaudRatesOf(DIALECTS);

export type OpenRefusalReason =
  | 'refused-port'
  | 'invalid-port-identity'
  | 'capability-required'
  | 'unexpected-capability'
  | 'baud-rate'
  | 'flow-control'
  | 'buffer-size';

export type OpenDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: OpenRefusalReason; readonly detail: string };

function sameId(a: { readonly vendorId: number; readonly productId: number }, b: { readonly vendorId: number; readonly productId: number }): boolean {
  return a.vendorId === b.vendorId && a.productId === b.productId;
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, '0');
}

function isUsbId(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffff;
}

/**
 * Decide whether `open(options)` may proceed on a link with identity `info`.
 * `hasCapability` says whether a valid, unused `BootloaderCapability` came
 * with the call. Pure; the guard calls it before touching the port.
 */
export function decideOpen(info: TransportInfo, options: TransportOpenOptions, hasCapability: boolean): OpenDecision {
  const vid = info.usbVendorId;
  const pid = info.usbProductId;
  // A half-known or malformed identity cannot be checked against the refusal list, so it is refused.
  if ((vid === undefined) !== (pid === undefined) || (vid !== undefined && !(isUsbId(vid) && isUsbId(pid)))) {
    return { ok: false, reason: 'invalid-port-identity', detail: `USB identity ${String(vid)}:${String(pid)} is not a valid pair` };
  }
  let bootloaderPort = false;
  if (vid !== undefined && pid !== undefined) {
    const id = { vendorId: vid, productId: pid };
    const refused = REFUSED_PORTS.find((u) => sameId(u, id));
    if (refused !== undefined) {
      return { ok: false, reason: 'refused-port', detail: `${hex4(vid)}:${hex4(pid)} (${refused.label}) is never opened` };
    }
    bootloaderPort = BOOTLOADER_PORTS.some((u) => sameId(u, id));
  }

  if (options.flowControl !== 'none') {
    return { ok: false, reason: 'flow-control', detail: `flowControl ${String(options.flowControl)} is refused; only 'none'` };
  }
  if (options.bufferSize !== TRANSPORT_BUFFER_SIZE) {
    return { ok: false, reason: 'buffer-size', detail: `bufferSize ${String(options.bufferSize)} is refused; only ${TRANSPORT_BUFFER_SIZE}` };
  }

  const baud = options.baudRate;
  const capabilityBaud = CAPABILITY_BAUD_RATES.has(baud);
  if (!capabilityBaud && !SESSION_BAUD_RATES.has(baud)) {
    return { ok: false, reason: 'baud-rate', detail: `baud rate ${String(baud)} is not one a controller uses` };
  }
  const needsCapability = capabilityBaud || bootloaderPort;
  if (needsCapability && !hasCapability) {
    const what = capabilityBaud ? `${baud} baud` : `bootloader port ${hex4(vid as number)}:${hex4(pid as number)}`;
    return { ok: false, reason: 'capability-required', detail: `${what} needs the flasher's bootloader capability` };
  }
  if (!needsCapability && hasCapability) {
    return { ok: false, reason: 'unexpected-capability', detail: 'a bootloader capability was presented for an ordinary open' };
  }
  return { ok: true };
}
