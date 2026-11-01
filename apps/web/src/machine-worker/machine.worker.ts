/**
 * `machine.worker`: the dedicated worker that owns the serial link
 * (ROADMAP P0-14; RUN_PLAN §5.1 rule 1, §5.4). It has no network code
 * (RUN_PLAN §5.4) and no session or account state (DECISIONS D1).
 *
 * Each message is one request (rpc.ts) with a reply port in `ports[0]`; the
 * answer goes back on that port. A message without a reply port gets no
 * answer and does nothing.
 *
 * Synthetic `message` events are not filtered out (`isTrusted` is not
 * checked): only code already running inside this worker could dispatch
 * one, and such code has the worker's full power anyway. The fake-serial
 * Playwright test drives the worker that way (docs/testing/fake-serial.md).
 */
import { MachineWorkerHost } from './host.ts';
import { createTransportSource } from './transport.ts';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

const host = new MachineWorkerHost(createTransportSource());

(globalThis as unknown as WorkerScope).addEventListener('message', (event) => {
  const reply = event.ports[0];
  if (reply === undefined) return;
  void host.handle(event.data).then((answer) => {
    reply.postMessage(answer);
    reply.close();
  });
});
