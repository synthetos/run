/** The page is the network boundary; a reply port carries public metadata only. */
import { verifyFirmwareReleases } from '@synthetos/protocol';
import { fetchFirmwareCatalog } from '../cloud/firmwareCatalog.ts';
export function serveFirmwareCatalog(worker: Worker): void {
  worker.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.kind !== 'firmwareCatalog' || event.data?.v !== 1 || event.ports.length !== 1) return;
    const port = event.ports[0]!;
    void fetchFirmwareCatalog().then(file => port.postMessage(file), () => port.postMessage(null)).finally(() => port.close());
  });
}

/** Keep catalog loading out of the firmware hub's stateful mount function. */
export async function loadFirmwareCatalog(environment: import('@synthetos/protocol').ReleasesEnvironment | null): Promise<import('../workspace/model.ts').FirmwareHubView['releases']> {
  const verdict = await fetchFirmwareCatalog().then(file => verifyFirmwareReleases(file, { environment, now: new Date() })).catch(() => null);
  return verdict !== null && verdict.ok ? { ok: true, list: verdict.releases } : { ok: false, reason: verdict === null ? 'it could not be read' : verdict.rejection };
}
