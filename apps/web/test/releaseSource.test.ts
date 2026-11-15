import { expect, it } from 'vitest';
import { releaseSource } from '../src/machine-worker/releaseSource.ts';
const file = { format: 'synthetos-run/github-releases@1', releases: [{ repo: 'synthetos/TinyG', tag: '450.06', file: 'tinyg-450.06.hex', sha256: 'a'.repeat(64), size: 100, date: '2026-11-15', notes: '', prerelease: true, unavailable: null }] };
it('uses a dedicated reply port and independently rejects untrusted metadata shapes', async () => {
  for (const [body, accepted] of [[file, true], [{ ...file, releases: [{ ...file.releases[0], repo: 'attacker/firmware' }] }, false], [null, false]] as const) {
    const source = releaseSource({ postMessage(message, transfer) {
      expect(message).toEqual({ v: 1, kind: 'firmwareCatalog' });
      const port = transfer[0] as MessagePort;
      port.postMessage(body); port.close();
    } }, 'https://run.synthetos.com');
    expect((await source(new Date())) !== null).toBe(accepted);
  }
});
