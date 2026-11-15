/**
 * The bench server's firmware route (OD-10): the same
 * `GET /firmware/<owner>/<name>/<tag>/<asset>` the run Worker serves
 * (workers/run/src/firmwareProxy.ts), so the bench build's update panel can
 * fetch a listed release image on this computer.
 *
 * Uses the Worker's cached GitHub metadata, digest/size checks and fixed
 * repository proxy. Tests may inject metadata and a fake upstream.
 * Responses carry the bench serial headers.
 */
import { verifyFirmwareReleases } from '../../../../packages/protocol/src/firmwareReleases.ts';
import type { FirmwareAsset } from '../../../../workers/run/src/firmwareAssets.ts';
import { firmwareAssetPath, firmwareHeaders, memoryCache, proxyFirmwareAsset, type FetchLike, type FirmwareProxyDeps } from '../../../../workers/run/src/firmwareProxy.ts';
import { SERIAL_GRANTED_SECURITY_HEADERS } from '../../../../workers/run/src/headers.ts';

export interface BenchFirmwareResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface BenchFirmware {
  /** The listed images this bench can fetch. */
  readonly assets: readonly FirmwareAsset[];
  /** Answers a request whose path `isFirmwarePath`; GET and HEAD only. */
  respond(method: string, path: string): Promise<BenchFirmwareResponse>;
}

/** True for the four-segment firmware path the proxy serves (other `/firmware/...` paths are site files). */
export function isFirmwarePath(path: string): boolean {
  return firmwareAssetPath(path) !== null;
}

/** Validate public GitHub metadata for the bench; invalid data lists nothing. */
export async function benchFirmwareAssets(releasesFile: unknown, now: Date = new Date()): Promise<FirmwareAsset[]> {
  const verdict = await verifyFirmwareReleases(releasesFile, { environment: 'staging', now });
  if (!verdict.ok) return [];
  const out: FirmwareAsset[] = [];
  for (const board of verdict.releases.boards) {
    for (const r of board.releases) {
      if (r.repo === null || r.tag === null || r.unavailable !== undefined) continue;
      out.push({ env: 'staging', repo: r.repo, tag: r.tag, asset: r.file, sha256: r.sha256, size: r.size });
    }
  }
  return out;
}

const enc = new TextEncoder();

function plain(status: number, text: string, extra: Record<string, string> = {}): BenchFirmwareResponse {
  return { status, headers: { ...SERIAL_GRANTED_SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra }, body: enc.encode(`${text}\n`) };
}

/** The bench's firmware route over a list and a fetch (Node's by default). */
export function benchFirmware(assets: readonly FirmwareAsset[] | undefined, fetchFn: FetchLike = (url, init) => fetch(url, init)): BenchFirmware {
  const deps: FirmwareProxyDeps = { fetch: fetchFn, cache: memoryCache(), ...(assets === undefined ? {} : { assets }) };
  return {
    assets: assets ?? [],
    async respond(method, path) {
      if (method !== 'GET' && method !== 'HEAD') return plain(405, 'GET and HEAD only', { allow: 'GET, HEAD' });
      const result = await proxyFirmwareAsset(path, 'staging', deps);
      if (!result.ok) return result.reason === 'upstream' ? plain(502, 'GitHub did not answer; try again') : plain(404, 'not a listed firmware image');
      return { status: 200, headers: { ...SERIAL_GRANTED_SECURITY_HEADERS, ...firmwareHeaders(result.bytes) }, body: method === 'HEAD' ? new Uint8Array() : result.bytes };
    },
  };
}
