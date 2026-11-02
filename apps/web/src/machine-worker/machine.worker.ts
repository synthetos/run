/**
 * `machine.worker`: the dedicated worker that owns the serial link and the
 * read-only `MachineSession`, the single writer (ROADMAP P0-14, P1-02;
 * RUN_PLAN §5.1 rule 1, §5.4). It has no network code (RUN_PLAN §5.4) and
 * no account state (DECISIONS D1).
 *
 * Each message is one request (rpc.ts) with a reply port in `ports[0]`; the
 * answer goes back on that port, which is then closed, except after a
 * successful `subscribe`: that port stays open and receives the session
 * snapshots. A message without a reply port gets no answer and does
 * nothing.
 *
 * The worker also holds the machine Web Lock while a port is open and
 * answers stop-class requests from any tab on the stop BroadcastChannel
 * (P1-06, stopService.ts).
 *
 * Synthetic `message` events are not filtered out (`isTrusted` is not
 * checked): only code already running inside this worker could dispatch
 * one, and such code has the worker's full power anyway. The fake-serial
 * Playwright test drives the worker that way (docs/testing/fake-serial.md).
 */
import approvedBuilds from '../../../../firmware/approved-builds.json';
import { MachineWorkerHost, realClock, workerPlatform } from './host.ts';
import { releaseFor } from './motionFlag.ts';
import { browserLocks, openStopChannel } from './stopChannel.ts';
import { MachineStopService } from './stopService.ts';
import { createTransportSource } from './transport.ts';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

// The signed approved-builds manifest, bundled (the worker has no network code). It is verified again
// before every connect, for this worker's own origin (approval.ts, P1-03).
const origin = (globalThis as unknown as { location: { origin: string } }).location.origin;
// The motion capability flag comes from the worker's own origin (motionFlag.ts): Phase 2 on the bench and
// staging origins only, Phase 1 (read-only) everywhere else, production included.
const host = new MachineWorkerHost(createTransportSource(), realClock(), workerPlatform(), { file: approvedBuilds as unknown, origin }, releaseFor(origin));
new MachineStopService({ session: host.session, channel: openStopChannel(), locks: browserLocks(), instance: crypto.randomUUID() });

(globalThis as unknown as WorkerScope).addEventListener('message', (event) => {
  const reply = event.ports[0];
  if (reply === undefined) return;
  void host.handle(event.data, reply).then((answer) => {
    reply.postMessage(answer);
    if (!(answer.ok && answer.kind === 'subscribe')) reply.close();
  });
});
