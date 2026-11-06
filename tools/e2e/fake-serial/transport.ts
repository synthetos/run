/**
 * The fake-serial replacement for the transport seam (ROADMAP P0-14).
 * TEST BUILD ONLY: `vite build --mode fake-serial` resolves every import of
 * apps/web/src/machine-worker/transport.ts to this file
 * (apps/web/build/fakeSerial.ts). A production build never contains it: it
 * imports the test kit, whose marker the bundle scan refuses.
 *
 * Each `request()` creates a fresh simulated TinyG edge-next board (the
 * test kit's `TinyGEdgeNextModel`, booting so it prints its banners) behind
 * a `SimEndpoint` and a `MockSerialPort`, on a real-time clock, and hands
 * the worker a `MockTransport` over that port. Every port is also listed on
 * `globalThis.__RUN_FAKE_SERIAL__` inside the worker, so a Playwright test
 * can inspect what the worker did to it (`openLog`, for example) with
 * `worker.evaluate`.
 *
 * `createTransportSource` keeps the seam's exact signature (see there); the
 * other exports serve this file's own tests.
 *
 * The selector is honoured as a real source must: the fake has one granted
 * port, the simulated edge-next board (FTDI 0403:6015) at grant index 0, and
 * any other selector resolves null (refuse, never guess).
 */
import { FlashableBoard, MockSerialPort, SimEndpoint, TinyGEdgeNextModel, type Clock, type FlashableBoardOptions, type TinyGModelOptions } from '@synthetos/testkit';
import type { PortSelector, TransportSource } from '@synthetos/machine';
import { MockTransport } from './mockTransport.ts';

/** The EN pin's build (vendor/firmware-pins.json): what the plain fake board reports. */
const PIN_BUILD = Object.freeze({ fb: 450.02, fv: 0.97, hv: 8, layout: 10002 });

/** Where the ports this source created are listed, in the worker's global scope. */
export const FAKE_SERIAL_GLOBAL = '__RUN_FAKE_SERIAL__';

/** The simulated board's boot time before its first banner, ms. */
const BOOT_MS = 50;

/** The flashable board's link rate (fast, so a whole flash takes seconds in real time). */
const FLASH_LINK_BAUD = 2_000_000;

/** A persisted settings write stalls the simulated board this long (EEPROM; bytes sent meanwhile are lost). */
const EEPROM_WRITE_MS = 25;

export interface FakeSerialRegistry {
  readonly ports: MockSerialPort[];
  /**
   * Options for the next simulated board only (then cleared): a spec sets, for example, an EEPROM image with
   * homing switches before it opens the port (amendment 2026-11-02 specs).
   */
  next?: Partial<TinyGModelOptions> | undefined;
  /**
   * The firmware update specs (SAFETY §4.8 as amended 2026-11-03): when set before the first open, the source keeps
   * ONE simulated flashable board (the xboot model plus the edge-next model running the flashed image) behind one
   * MockSerialPort for every request, as the FTDI port stays the same across `{"boot":1}`. Its link runs fast so a
   * whole flash takes seconds.
   */
  flashable?: FlashableBoardOptions | undefined;
  /** The persistent flashable board and its port, once created. */
  board?: { readonly device: FlashableBoard; readonly endpoint: SimEndpoint; readonly port: MockSerialPort } | undefined;
}

/** A `Clock` on the host's real timers (the virtual clock is for unit tests). */
export function realTimeClock(): Clock {
  const start = performance.now();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 1;
  return {
    now: () => performance.now() - start,
    setTimeout: (callback, delayMs) => {
      const id = next++;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          callback();
        }, delayMs),
      );
      return id;
    },
    clearTimeout: (id) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
    },
  };
}

function registry(): FakeSerialRegistry {
  const scope = globalThis as unknown as Record<string, FakeSerialRegistry | undefined>;
  const existing = scope[FAKE_SERIAL_GLOBAL];
  if (existing !== undefined) return existing;
  const created: FakeSerialRegistry = { ports: [] };
  scope[FAKE_SERIAL_GLOBAL] = created;
  return created;
}

/** The one port the fake has granted: the simulated board's FTDI identity at index 0. */
export const FAKE_GRANTED_PORT: PortSelector = Object.freeze({ usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 });

export function createTransportSource(): TransportSource {
  return Object.freeze({
    kind: 'fake',
    request: (selector: PortSelector) => {
      const g = FAKE_GRANTED_PORT;
      if (selector.usbVendorId !== g.usbVendorId || selector.usbProductId !== g.usbProductId || selector.grantIndex !== g.grantIndex) {
        return Promise.resolve(null);
      }
      const reg = registry();
      if (reg.flashable !== undefined) {
        if (reg.board === undefined) {
          const device = new FlashableBoard({ linkBaud: FLASH_LINK_BAUD, ...reg.flashable, model: { bootMs: BOOT_MS, eepromWriteMs: EEPROM_WRITE_MS, rxm: 0, ...reg.flashable.model } });
          const endpoint = new SimEndpoint({ clock: realTimeClock(), device, link: { baudRate: FLASH_LINK_BAUD, latencyMs: 1, coalesceMs: 4 } });
          const port = new MockSerialPort(endpoint);
          reg.board = { device, endpoint, port };
          reg.ports.push(port);
        }
        // The same port, reopened: a disconnected (unplugged) board has no port until it is plugged back in.
        return Promise.resolve(reg.board.endpoint.connected ? new MockTransport(reg.board.port) : null);
      }
      const next = reg.next ?? {};
      reg.next = undefined;
      // In character mode (rxm 0), as a board another sender used: a job then switches it to line mode and back (H77).
      // It reports the EN pin's build (450.02), the one the committed bench manifest approves; the model's behaviour
      // stays the 450.01 model's (testkit LIM-EN-REPIN).
      const device = new TinyGEdgeNextModel({ start: 'boot', bootMs: BOOT_MS, eepromWriteMs: EEPROM_WRITE_MS, rxm: 0, build: PIN_BUILD, ...next });
      const endpoint = new SimEndpoint({ clock: realTimeClock(), device });
      const port = new MockSerialPort(endpoint);
      registry().ports.push(port);
      return Promise.resolve(new MockTransport(port));
    },
  });
}
