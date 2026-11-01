/**
 * `gcode.worker` (RUN_PLAN §5.4, ROADMAP TB-03): parses, sanitises and
 * interprets a G-code file off the main thread for the preview. It has no
 * transport and cannot reach a machine. Cancel is `terminate()` from the page.
 */
import { createGcodeHandler } from './handler.ts';
import type { FromGcodeWorker, ToGcodeWorker } from './protocol.ts';

const scope = self as unknown as {
  postMessage(message: FromGcodeWorker, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToGcodeWorker>) => void) | null;
};

const handle = createGcodeHandler((message, transfer) => { scope.postMessage(message, transfer ?? []); });
scope.onmessage = (event) => { void handle(event.data); };
