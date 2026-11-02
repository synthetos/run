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
import { MockSerialPort, SimEndpoint, TinyGEdgeNextModel, type Clock } from '@synthetos/testkit';
import type { PortSelector, TransportSource } from '@synthetos/machine';
import { MockTransport } from './mockTransport.ts';

/** Where the ports this source created are listed, in the worker's global scope. */
export const FAKE_SERIAL_GLOBAL = '__RUN_FAKE_SERIAL__';

/** The simulated board's boot time before its first banner, ms. */
const BOOT_MS = 50;

/** A persisted settings write stalls the simulated board this long (EEPROM; bytes sent meanwhile are lost). */
const EEPROM_WRITE_MS = 25;

export interface FakeSerialRegistry {
  readonly ports: MockSerialPort[];
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
      const device = new TinyGEdgeNextModel({ start: 'boot', bootMs: BOOT_MS, eepromWriteMs: EEPROM_WRITE_MS });
      const endpoint = new SimEndpoint({ clock: realTimeClock(), device });
      const port = new MockSerialPort(endpoint);
      registry().ports.push(port);
      return Promise.resolve(new MockTransport(port));
    },
  });
}
