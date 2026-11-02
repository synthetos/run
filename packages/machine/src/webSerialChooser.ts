/**
 * The window's Web Serial port chooser (OD-3 "The window's port chooser",
 * approved by the owner 2026-11-02; RUN_PLAN §5.4;
 * docs/testing/fake-serial.md "Recommended for P1-01").
 *
 * THE SECOND AND LAST MODULE THAT MAY TOUCH WEB SERIAL
 * (tools/gates/src/shared/webSerialNames.ts, WEB_SERIAL_CHOOSER_MODULE),
 * next to the transport (webSerialTransport.ts). `requestPort()` exists only
 * on Window and needs a user gesture, so the machine worker cannot show the
 * chooser; this module does, on the main thread, and describes the choice as
 * a `PortSelector`: the chosen port's USB identity (`getInfo()`) and its
 * index and full USB grant snapshot. The worker holds an unopened matching
 * port, then the window confirms the original grant objects still match.
 * Only that held worker port may open; changed or ambiguous grants refuse.
 *
 * It never opens, reads or writes a port: it has no `open`, no streams and
 * no transport. Every gate holds it to that:
 * - lint admits a static `navigator.serial` read here (as in the transport)
 *   and nowhere else;
 * - dependency-cruiser lets exactly one main-thread module import it
 *   (apps/web/src/live/portChooser.ts, WEB_SERIAL_CHOOSER_IMPORTER) plus
 *   this package's tests, and lets it import types only;
 * - the page build files it in a chunk of its own under `assets/serial/`
 *   (apps/web/build/chunks.ts), the only place the bundle scan admits Web
 *   Serial, for the staging and bench targets only; production refuses it.
 *
 * `chooseSerialPort` calls `requestPort()` synchronously, before anything is
 * awaited, so the caller's click (the C1 confirm, live/liveEntry.ts) is
 * still the active user gesture.
 */
import type { PortSelector } from './transport.ts';

/** The parts of a granted `SerialPort` the chooser reads. */
export interface ChooserPort {
  getInfo(): { readonly usbVendorId?: unknown; readonly usbProductId?: unknown };
}

/** The parts of the window's `navigator.serial` the chooser uses. */
export interface ChooserSerial {
  requestPort(): Promise<ChooserPort>;
  getPorts(): Promise<readonly ChooserPort[]>;
}

export type ChooserRefusal =
  /** No Web Serial in this browser or context. */
  | 'unavailable'
  /** The user closed the chooser without picking a port. */
  | 'cancelled'
  /** The browser refused the chooser (no user gesture, or the Permissions-Policy denies serial). */
  | 'refused'
  /** The chosen port has no USB vendor and product id, so the worker could not find it again. */
  | 'no-usb-identity'
  /** The chosen port is not in the window's granted ports. */
  | 'not-granted'
  /** More than one grant has the selected USB identity. */
  | 'ambiguous'
  /** Anything else the browser threw. */
  | 'failed';

export type ChooserResult = { readonly ok: true; readonly selector: PortSelector; readonly confirm: () => Promise<boolean> } | { readonly ok: false; readonly code: ChooserRefusal; readonly detail: string };

/** The largest grant index a `PortSelector` carries (isPortSelector). */
const MAX_GRANT_INDEX = 255;

function isU16(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffff;
}

function refusal(code: ChooserRefusal, detail: string): ChooserResult {
  return Object.freeze({ ok: false, code, detail });
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : '';
}

function fromError(error: unknown): ChooserResult {
  const name = errorName(error);
  const detail = error instanceof Error ? error.message : String(error);
  if (name === 'NotFoundError') return refusal('cancelled', detail);
  if (name === 'SecurityError' || name === 'NotAllowedError') return refusal('refused', detail);
  return refusal('failed', detail);
}

/** The window's `navigator.serial`, or undefined where Web Serial does not exist. */
function windowSerial(): ChooserSerial | undefined {
  return (navigator as unknown as { readonly serial?: ChooserSerial }).serial;
}

async function describe(serial: ChooserSerial, requested: Promise<ChooserPort>): Promise<ChooserResult> {
  let port: ChooserPort;
  try {
    port = await requested;
  } catch (error) {
    return fromError(error);
  }
  try {
    const { usbVendorId, usbProductId } = port.getInfo();
    if (!isU16(usbVendorId) || !isU16(usbProductId)) {
      return refusal('no-usb-identity', 'the chosen port reports no USB vendor and product id');
    }
    const grants = [...(await serial.getPorts())];
    const grantIndex = grants.indexOf(port);
    if (grantIndex < 0 || grantIndex > MAX_GRANT_INDEX || grants.length > MAX_GRANT_INDEX + 1) return refusal('not-granted', 'the chosen port is not among the ports this page was granted');
    const snapshot = (): string[] => grants.map((p) => {
      const info = p.getInfo();
      if (!isU16(info.usbVendorId) || !isU16(info.usbProductId)) throw new Error('a grant has no USB identity');
      return `${info.usbVendorId}:${info.usbProductId}`;
    });
    const grantSnapshot = Object.freeze(snapshot());
    if (grantSnapshot.filter((id) => id === grantSnapshot[grantIndex]).length !== 1) return refusal('ambiguous', 'disconnect or revoke indistinguishable grants before choosing a port');
    let consumed = false;
    const confirm = async (): Promise<boolean> => {
      if (consumed) return false;
      consumed = true;
      try {
        const current = await serial.getPorts();
        // Object identity catches removal/replacement even with identical USB ids.
        return current.length === grants.length && current.every((p, i) => p === grants[i]) && snapshot().every((id, i) => id === grantSnapshot[i]);
      } catch {
        return false;
      }
    };
    return Object.freeze({ ok: true, selector: Object.freeze({ usbVendorId, usbProductId, grantIndex, grantSnapshot }), confirm });
  } catch (error) {
    return fromError(error);
  }
}

/**
 * Shows the browser's port chooser and describes the choice. Call it
 * synchronously inside the user's click. Never throws; never opens the port.
 */
export function chooseSerialPort(serial: ChooserSerial | undefined = windowSerial()): Promise<ChooserResult> {
  if (serial === undefined) return Promise.resolve(refusal('unavailable', 'this browser has no Web Serial'));
  let requested: Promise<ChooserPort>;
  try {
    // Synchronously, inside the gesture: requestPort() needs the click's user activation.
    requested = serial.requestPort();
  } catch (error) {
    return Promise.resolve(fromError(error));
  }
  return describe(serial, requested);
}
