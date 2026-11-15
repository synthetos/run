/** The open updater's dedicated worker. Its role is fixed by this build entry. */
import { releaseSource } from './releaseSource.ts';
import { MachineLock } from './machineLock.ts';
import { browserLocks } from './stopChannel.ts';
import { FirmwareWorkerHost } from './firmwareHost.ts';
import { realClock, workerPlatform } from './hostCore.ts';
import { firmwareReleaseFor } from './firmwareRelease.ts';
import { createTransportSource } from './transport.ts';
const origin = (globalThis as unknown as { location: { origin: string } }).location.origin;
const host = new FirmwareWorkerHost(createTransportSource(), realClock(), workerPlatform(), { file: null, origin, releases: releaseSource({ postMessage: (message, transfer) => postMessage(message, { transfer }) }, origin) }, firmwareReleaseFor(origin));
const lock = new MachineLock({ session: host.session, locks: browserLocks(), instance: crypto.randomUUID(), flashing: () => host.flash.busy ? { boardId: host.flash.view?.boardId ?? null } : null });
host.flashListener = () => lock.sync();
(globalThis as unknown as { addEventListener(type: 'message', listener: (event: MessageEvent) => void): void }).addEventListener('message', event => {
  const reply = event.ports[0];
  if (reply === undefined) return;
  void host.handle(event.data, reply).then(answer => {
    reply.postMessage(answer);
    if (!(answer.ok && answer.kind === 'subscribe')) reply.close();
  });
});
