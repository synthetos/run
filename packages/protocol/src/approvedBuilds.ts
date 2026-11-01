/**
 * The signed approved-builds manifest (ROADMAP P0-08; RUN_PLAN §5.2, §6.3;
 * SAFETY H27, H44; red-team round 2 MS-F16).
 *
 * `firmware/approved-builds.json` is a per-environment signed data file. The
 * code is identical in staging and production: it derives its environment
 * from `location.origin` (passed in by the caller) and accepts a channel only
 * when its Ed25519 signature verifies under a compiled-in release key that is
 * authorised for that environment, AND the signed payload names that same
 * environment. So the artifact that ran HIL on staging is byte-for-byte the
 * artifact production serves, and production still rejects the bench entries
 * by signature and `env`, never by a build flag.
 *
 * Channels:
 * - `bench`: edge-next candidates the owner approved for bench use; signed
 *   with `env: "staging"`.
 * - `release`: builds that passed D5 (hash match plus a signed HIL run);
 *   signed with `env: "production"`. Empty until D4 and D5.
 *
 * The signed message is a domain-separation prefix plus the payload's exact
 * UTF-8 bytes (the payload travels as a JSON string, so no canonicalisation
 * is needed and a signature for another file type can never be replayed here).
 *
 * Verification never throws: anything malformed, unsigned, expired, for
 * another environment or for a read-only dialect contributes nothing, and
 * the board stays READ_ONLY (fail closed).
 */
import type { DialectId } from './dialects/types.ts';
import { RELEASE_KEYS } from './releaseKeys.ts';
import type { ReleaseKey } from './releaseKeys.ts';

export type Environment = 'staging' | 'production';
export type Channel = 'bench' | 'release';

/** The outer file format. */
export const APPROVED_BUILDS_FORMAT = 'synthetos-run/approved-builds@1';
/** The format of each signed payload. */
export const CHANNEL_PAYLOAD_FORMAT = 'synthetos-run/approved-builds-channel@1';
/** Prefixed to the payload before signing (domain separation). */
export const SIGNING_PREFIX = 'synthetos-run approved-builds v1\n';

/**
 * run's hosts and the environment each one is. Hosts only, compared after
 * checking the scheme is https, so no origin literal sits in the machine-path
 * bundle (the bundle scan allows run's origins only in cloud chunks).
 */
const ENVIRONMENT_BY_HOST: ReadonlyMap<string, Environment> = new Map([
  ['run.synthetos.com', 'production'],
  ['staging.run.synthetos.com', 'staging'],
]);

/** Which channel each environment reads; each channel must be signed for exactly that environment. */
const CHANNEL_ENVIRONMENT: Readonly<Record<Channel, Environment>> = Object.freeze({ bench: 'staging', release: 'production' });

/**
 * Dialects a manifest entry may approve: those whose `mode` is `manifest`.
 * `tinyg-449-stock` and g2core are READ_ONLY whatever the manifest says, so an
 * entry for them is a malformed channel.
 */
const APPROVABLE_DIALECTS: readonly DialectId[] = ['tinyg-en', 'tinyg-440'];

export interface ApprovedBuild {
  readonly channel: Channel;
  readonly dialect: DialectId;
  /** The `fb` the board reports. */
  readonly fb: number;
  /** The `fbs` build hash the board reports, or null for a build that reports none (edge-next today). */
  readonly fbs: string | null;
  /** The firmware commit the build was made from (40 hex digits). */
  readonly commit: string;
  readonly note: string;
}

export interface ApprovedBuilds {
  /** The environment the builds were accepted for, or null on any other origin. */
  readonly environment: Environment | null;
  readonly builds: readonly ApprovedBuild[];
}

/** No approvals: every board is READ_ONLY. The default whenever the manifest is missing or rejected. */
export const NO_APPROVED_BUILDS: ApprovedBuilds = Object.freeze({ environment: null, builds: Object.freeze([]) });

export type ChannelRejection =
  | 'no-environment'
  | 'malformed'
  | 'wrong-environment-for-channel'
  | 'unknown-key'
  | 'key-not-authorised-for-environment'
  | 'bad-signature'
  | 'malformed-payload'
  | 'channel-mismatch'
  | 'environment-mismatch'
  | 'not-yet-valid'
  | 'expired';

export interface ChannelVerdict {
  /** The channel name as the file states it, or `?` when unreadable. */
  readonly channel: string;
  readonly accepted: boolean;
  readonly rejection?: ChannelRejection;
}

export interface VerifiedApprovedBuilds {
  readonly approved: ApprovedBuilds;
  /** One verdict per channel in the file, for diagnostics. */
  readonly channels: readonly ChannelVerdict[];
}

export interface VerifyOptions {
  /** `location.origin` of the page or worker. */
  readonly origin: string;
  /** The current time (injected for tests). */
  readonly now: Date;
  /** The trusted keys; the compiled-in `RELEASE_KEYS` unless a test passes its own. */
  readonly keys?: readonly ReleaseKey[];
}

/** The environment of an origin: run's two hosts over https, nothing else (localhost, previews, workers.dev → null). */
export function environmentForOrigin(origin: string): Environment | null {
  const match = /^https:\/\/([a-z0-9.-]+)$/.exec(origin);
  return match === null ? null : (ENVIRONMENT_BY_HOST.get(match[1] as string) ?? null);
}

/** The approval for a probed build, if the manifest has one for exactly this dialect, `fb` and `fbs`. */
export function findApproval(
  manifest: ApprovedBuilds,
  dialect: DialectId,
  fb: number | undefined,
  fbs: string | undefined,
): ApprovedBuild | undefined {
  if (fb === undefined) return undefined;
  // A build that reports an fbs differs from one approved without it, and vice versa (D4: manifest(fb, fbs)).
  return manifest.builds.find((b) => b.dialect === dialect && b.fb === fb && b.fbs === (fbs ?? null));
}

/** Verify the manifest file for this origin. Never throws; rejects anything it cannot fully verify. */
export async function verifyApprovedBuilds(file: unknown, options: VerifyOptions): Promise<VerifiedApprovedBuilds> {
  const environment = environmentForOrigin(options.origin);
  const keys = options.keys ?? RELEASE_KEYS;
  const channels = readChannels(file);
  if (channels === undefined) {
    return { approved: { environment, builds: Object.freeze([]) }, channels: Object.freeze([{ channel: '?', accepted: false, rejection: 'malformed' }]) };
  }
  const verdicts: ChannelVerdict[] = [];
  const builds: ApprovedBuild[] = [];
  for (const entry of channels) {
    const outcome = await verifyChannel(entry, environment, keys, options.now);
    const channel = isRecord(entry) && typeof entry['channel'] === 'string' ? entry['channel'] : '?';
    if (Array.isArray(outcome)) {
      builds.push(...outcome);
      verdicts.push(Object.freeze({ channel, accepted: true }));
    } else {
      verdicts.push(Object.freeze({ channel, accepted: false, rejection: outcome }));
    }
  }
  return {
    approved: Object.freeze({ environment, builds: Object.freeze(builds) }),
    channels: Object.freeze(verdicts),
  };
}

function readChannels(file: unknown): readonly unknown[] | undefined {
  if (!isRecord(file) || file['format'] !== APPROVED_BUILDS_FORMAT || !Array.isArray(file['channels'])) return undefined;
  return file['channels'];
}

async function verifyChannel(
  entry: unknown,
  environment: Environment | null,
  keys: readonly ReleaseKey[],
  now: Date,
): Promise<ApprovedBuild[] | ChannelRejection> {
  if (environment === null) return 'no-environment';
  if (!isRecord(entry)) return 'malformed';
  const { channel, kid, payload, sig } = entry;
  if (!isChannel(channel) || typeof kid !== 'string' || typeof payload !== 'string' || typeof sig !== 'string') {
    return 'malformed';
  }
  // Each environment reads only its own channel.
  if (CHANNEL_ENVIRONMENT[channel] !== environment) return 'wrong-environment-for-channel';
  const key = keys.find((k) => k.kid === kid);
  if (key === undefined) return 'unknown-key';
  if (!key.environments.includes(environment)) return 'key-not-authorised-for-environment';
  if (!(await verifyEd25519(key.publicKey, sig, SIGNING_PREFIX + payload))) return 'bad-signature';

  // The bytes are authentic from here on; their content is still checked strictly.
  const body = parseJson(payload);
  if (!isRecord(body) || body['format'] !== CHANNEL_PAYLOAD_FORMAT) return 'malformed-payload';
  if (body['channel'] !== channel) return 'channel-mismatch';
  if (body['env'] !== environment) return 'environment-mismatch';
  const issued = parseTime(body['issued']);
  const expires = parseTime(body['expires']);
  if (issued === undefined || expires === undefined || !(issued < expires)) return 'malformed-payload';
  if (now.getTime() < issued) return 'not-yet-valid';
  if (now.getTime() >= expires) return 'expired';
  const builds = body['builds'];
  if (!Array.isArray(builds)) return 'malformed-payload';
  const out: ApprovedBuild[] = [];
  for (const b of builds) {
    const build = readBuild(b, channel);
    if (build === undefined) return 'malformed-payload';
    out.push(build);
  }
  return out;
}

function readBuild(b: unknown, channel: Channel): ApprovedBuild | undefined {
  if (!isRecord(b)) return undefined;
  const { dialect, fb, fbs, commit, note } = b;
  if (typeof dialect !== 'string' || !APPROVABLE_DIALECTS.includes(dialect as DialectId)) return undefined;
  if (typeof fb !== 'number' || !Number.isFinite(fb) || fb <= 0) return undefined;
  if (fbs !== null && (typeof fbs !== 'string' || fbs.length === 0)) return undefined;
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) return undefined;
  if (typeof note !== 'string') return undefined;
  return Object.freeze({ channel, dialect: dialect as DialectId, fb, fbs, commit, note });
}

async function verifyEd25519(publicKey: string, signature: string, message: string): Promise<boolean> {
  try {
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.importKey('raw', fromBase64(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await subtle.verify({ name: 'Ed25519' }, key, fromBase64(signature), new TextEncoder().encode(message));
  } catch {
    // Bad key or signature encoding, or no Ed25519 support: not verified.
    return false;
  }
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new Error('not base64');
  const binary = atob(text);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** An RFC 3339 UTC timestamp `YYYY-MM-DDTHH:MM:SSZ`, as milliseconds. */
function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function isChannel(value: unknown): value is Channel {
  return value === 'bench' || value === 'release';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
