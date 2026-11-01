/**
 * Asset retention across deploys (ROADMAP P0-04, RUN_PLAN §6.3: "Previous
 * hashed assets are kept for 14 days").
 *
 * A tab opened before a deploy keeps running the old version for hours, and
 * the app never reloads itself. Each Workers deploy replaces the whole asset
 * set, so without retention a lazily loaded chunk of the old version would
 * 404 mid-session. The deploy job therefore merges into the new asset set the
 * hashed assets of the previous deployment that stopped being current less
 * than 14 days ago.
 *
 * The previous deployment's state is the `run-deployed-<env>` workflow
 * artifact that the previous deploy job of the same environment uploaded
 * (previous.ts decides which artifact may be trusted). It holds
 * `retention.json` and the bytes of every asset it lists.
 *
 * The state artifact itself is NOT trusted: any job of a `main` push run can
 * upload an artifact of that name (P0 review). So every retained file must
 * also appear, with the same sha256, in the ATTESTED `run-web.sha256`
 * manifest of the build of the commit the state names for it. The deploy job
 * downloads and `gh attestation verify`s those manifests (signer workflow
 * ci.yml, source ref main, source digest = that commit) and passes them in.
 *
 * Rules (each one fails closed):
 * - only `assets/**` files with a content hash in the name and an extension
 *   Vite emits there (js, css, woff2, png) are ever retained, never HTML,
 *   SVG, XML, text, `_headers` or anything else that a browser would
 *   navigate to as a document or that is not content-addressed;
 * - a retained file whose commit has no attested manifest is dropped (it
 *   cannot be shown to come from a build); one whose attested manifest lacks
 *   it or records other bytes is tampering, and the deploy is refused;
 * - the state must be for the same environment: bench (staging) assets never
 *   reach production;
 * - every listed file must be present with the recorded sha256;
 * - a retained name that the new build also produces must have identical
 *   bytes (a hashed name with two contents means tampering or a broken build);
 * - timestamps must parse and must not be in the future.
 * An asset's age is measured from the last deploy in which it was CURRENT
 * (part of the build being deployed), not from when it first appeared: an
 * asset that was current for a month and then replaced still gets 14 days.
 *
 * Dependency-free (node: only).
 */
import { createHash } from 'node:crypto';

export const RETENTION_DAYS = 14;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const STATE_FILE = 'retention.json';
export const STATE_VERSION = 1;

/**
 * `assets/<name>-<8-char hash>.<ext>` as Vite/Rolldown emit them (base64url
 * hash), for the extensions the build puts under `assets/`. Never html, svg,
 * xml or txt: a navigable document type on run's origin could load script
 * that `script-src 'self'` allows.
 */
const HASHED_ASSET_RE = /^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2|png)$/;

/** Attested `run-web.sha256` manifests by the full commit sha of the build they belong to (path -> sha256). */
export type AttestedManifests = ReadonlyMap<string, ReadonlyMap<string, string>>;

export interface RetainedAsset {
  readonly sha256: string;
  /** ISO time of the last deploy in which this asset was part of the deployed build. */
  readonly lastCurrent: string;
  /** Commit whose build last contained it. */
  readonly commit: string;
}

export interface RetentionState {
  readonly version: typeof STATE_VERSION;
  readonly env: string;
  readonly assets: Readonly<Record<string, RetainedAsset>>;
}

export interface FileBytes {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export class RetentionError extends Error {
  override readonly name = 'RetentionError';
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isHashedAsset(path: string): boolean {
  return HASHED_ASSET_RE.test(path) && !path.split('/').includes('..');
}

/** Validates an untrusted `retention.json`. */
export function parseState(text: string): RetentionState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RetentionError(`${STATE_FILE} is not JSON`);
  }
  const obj = raw as { version?: unknown; env?: unknown; assets?: unknown };
  if (typeof raw !== 'object' || raw === null || obj.version !== STATE_VERSION) throw new RetentionError(`${STATE_FILE}: unsupported version`);
  if (typeof obj.env !== 'string') throw new RetentionError(`${STATE_FILE}: env missing`);
  if (typeof obj.assets !== 'object' || obj.assets === null || Array.isArray(obj.assets)) throw new RetentionError(`${STATE_FILE}: assets missing`);
  const assets: Record<string, RetainedAsset> = {};
  for (const [path, value] of Object.entries(obj.assets as Record<string, unknown>)) {
    const v = value as { sha256?: unknown; lastCurrent?: unknown; commit?: unknown };
    if (!isHashedAsset(path)) throw new RetentionError(`${STATE_FILE}: '${path}' is not a hashed asset path`);
    if (typeof v !== 'object' || v === null || typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.sha256)) {
      throw new RetentionError(`${STATE_FILE}: '${path}' has no valid sha256`);
    }
    if (typeof v.lastCurrent !== 'string' || Number.isNaN(Date.parse(v.lastCurrent))) throw new RetentionError(`${STATE_FILE}: '${path}' has no valid lastCurrent`);
    if (typeof v.commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(v.commit)) throw new RetentionError(`${STATE_FILE}: '${path}' has no valid commit`);
    assets[path] = { sha256: v.sha256, lastCurrent: v.lastCurrent, commit: v.commit };
  }
  return { version: STATE_VERSION, env: obj.env, assets };
}

export interface MergeInput {
  readonly env: string;
  readonly commit: string;
  readonly now: Date;
  /** Every file of the new (attested) site. */
  readonly site: readonly FileBytes[];
  /**
   * The previous deployment's state and asset files, and the attested
   * manifests of the builds it names, or null for the first deploy.
   */
  readonly previous: { readonly state: RetentionState; readonly files: readonly FileBytes[]; readonly attested: AttestedManifests } | null;
}

export interface MergeResult {
  /** Files to add to the site before deploying (retained old assets). */
  readonly retained: readonly FileBytes[];
  /** Asset paths dropped because they aged out. */
  readonly expired: readonly string[];
  /** Asset paths dropped because no attested build manifest was available for their commit. */
  readonly unattested: readonly string[];
  /** The new state to upload as `run-deployed-<env>` along with every asset it lists. */
  readonly state: RetentionState;
}

export function mergeRetained(input: MergeInput): MergeResult {
  const nowMs = input.now.getTime();
  const nowIso = input.now.toISOString();
  if (!/^[0-9a-f]{40}$/.test(input.commit)) throw new RetentionError('commit must be a full 40-character sha');
  const assets: Record<string, RetainedAsset> = {};
  const siteByPath = new Map(input.site.map((f) => [f.path, f]));
  for (const file of input.site) {
    if (isHashedAsset(file.path)) assets[file.path] = { sha256: sha256(file.bytes), lastCurrent: nowIso, commit: input.commit };
  }
  const retained: FileBytes[] = [];
  const expired: string[] = [];
  const unattested: string[] = [];
  if (input.previous !== null) {
    const { state, files, attested } = input.previous;
    if (state.env !== input.env) {
      throw new RetentionError(`previous state is for '${state.env}', this deploy is '${input.env}': assets never cross environments`);
    }
    const previousByPath = new Map(files.map((f) => [f.path, f]));
    for (const [path, entry] of Object.entries(state.assets).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const file = previousByPath.get(path);
      if (file === undefined) throw new RetentionError(`previous state lists '${path}' but its file is missing`);
      if (sha256(file.bytes) !== entry.sha256) throw new RetentionError(`previous '${path}' does not match its recorded sha256`);
      const lastMs = Date.parse(entry.lastCurrent);
      if (lastMs > nowMs) throw new RetentionError(`previous '${path}' has lastCurrent in the future (${entry.lastCurrent})`);
      const current = siteByPath.get(path);
      if (current !== undefined) {
        if (sha256(current.bytes) !== entry.sha256) throw new RetentionError(`'${path}' exists in the new build with different bytes`);
        continue; // still current: already recorded with lastCurrent = now
      }
      if (nowMs - lastMs >= RETENTION_MS) {
        expired.push(path);
        continue;
      }
      const manifest = /^[0-9a-f]{40}$/.test(entry.commit) ? attested.get(entry.commit) : undefined;
      if (manifest === undefined) {
        unattested.push(path);
        continue;
      }
      const attestedSha = manifest.get(path);
      if (attestedSha !== entry.sha256) {
        throw new RetentionError(
          attestedSha === undefined
            ? `previous '${path}' is not in the attested build of ${entry.commit}`
            : `previous '${path}' differs from the attested build of ${entry.commit}`,
        );
      }
      retained.push(file);
      assets[path] = entry;
    }
  }
  const sorted: Record<string, RetainedAsset> = {};
  for (const path of Object.keys(assets).sort()) sorted[path] = assets[path] as RetainedAsset;
  return { retained, expired, unattested, state: { version: STATE_VERSION, env: input.env, assets: sorted } };
}

export function formatState(state: RetentionState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** The distinct full commit shas a state names, sorted: the builds whose attested manifests the deploy must fetch. */
export function stateCommits(state: RetentionState): string[] {
  return [...new Set(Object.values(state.assets).map((a) => a.commit))].filter((c) => /^[0-9a-f]{40}$/.test(c)).sort();
}
