/** No network on the machine path: request public metadata through a dedicated reply port. */
import { verifyFirmwareReleases, type FirmwareReleases } from '@synthetos/protocol';
import { approvalEnvironment } from './approval.ts';
export interface ReleaseSourceScope { postMessage(message: unknown, transfer: Transferable[]): void }
export function releaseSource(scope: ReleaseSourceScope, origin: string): (now: Date) => Promise<FirmwareReleases | null> {
  return async now => {
    const file = await new Promise<unknown>(resolve => {
      const channel = new MessageChannel();
      const done = (value: unknown): void => { clearTimeout(timeout); channel.port1.close(); resolve(value); };
      const timeout = setTimeout(() => done(null), 10000);
      channel.port1.onmessage = event => done(event.data);
      scope.postMessage({ v: 1, kind: 'firmwareCatalog' }, [channel.port2]);
    });
    const verdict = await verifyFirmwareReleases(file, { environment: approvalEnvironment(origin), now });
    return verdict.ok ? verdict.releases : null;
  };
}
