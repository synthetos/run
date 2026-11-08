/**
 * `carve.worker` (docs/design/tool-sim.md, slice 2): carves the open file into the stock's heightmap off the
 * main thread for the 3D preview (gcode-view `createCarveHandler`). It has no transport and cannot reach a
 * machine. Cancel is a newer target, a newer session, or `terminate()` from the page.
 */
import { createCarveHandler, type FromCarveWorker, type ToCarveWorker } from '@synthetos/gcode-view';

/** The part of the dedicated worker scope this worker uses. */
interface CarveWorkerScope {
  postMessage(message: FromCarveWorker, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToCarveWorker>) => void): void;
}

const handle = createCarveHandler((message, transfer) => { (globalThis as unknown as CarveWorkerScope).postMessage(message, transfer ?? []); });
(globalThis as unknown as CarveWorkerScope).addEventListener('message', (event) => { handle(event.data); });
