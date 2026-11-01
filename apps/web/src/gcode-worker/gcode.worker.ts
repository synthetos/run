/**
 * `gcode.worker` (RUN_PLAN §5.4, ROADMAP TB-03): parses, sanitises and
 * interprets a G-code file off the main thread for the preview. It has no
 * transport and cannot reach a machine. Cancel is `terminate()` from the page.
 */
import { createGcodeHandler } from './handler.ts';
import type { FromGcodeWorker, ToGcodeWorker } from './protocol.ts';

/** The part of the dedicated worker scope this worker uses. */
interface GcodeWorkerScope {
  postMessage(message: FromGcodeWorker, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToGcodeWorker>) => void): void;
}

const handle = createGcodeHandler((message, transfer) => { (globalThis as unknown as GcodeWorkerScope).postMessage(message, transfer ?? []); });
(globalThis as unknown as GcodeWorkerScope).addEventListener('message', (event) => { void handle(event.data); });
