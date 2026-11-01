/**
 * The D1 sign-in gate (ROADMAP P1-05; RUN_PLAN §2.2; DECISIONS D1; D41
 * proposed, docs/ops/owner-decisions.md OD-3).
 *
 * The gate lives in the UI/auth layer only. Nothing in machine.worker or the
 * machine-path packages imports it (dependency-cruiser), so losing the
 * identity mid-session can only refuse NEW requests from the identity-gated
 * set G; it never cancels an accepted operation and never touches the
 * never-gated actions, which do not even reach this module (their type is
 * not accepted by `check`).
 *
 * It is pluggable, with exactly three identity providers:
 * - `run-session`: the accounts.synthetos.com session (A1-07). Not shipped
 *   yet, so it never yields an identity. Production accepts only this one.
 * - `access`: the Cloudflare Access identity the run Worker verified
 *   (`GET /api/identity`), on staging only, until A1-07.
 * - `bench`: "whoever sits at this computer", supplied only by the bench
 *   build's channel module (channel/bench.ts), on loopback only.
 */
import type { AdvisoryEnvironment } from '@synthetos/protocol';
import type { BuildChannel } from '../channel/channel.ts';

/** The identity-gated set G (RUN_PLAN §2.2, exhaustive). */
export const IDENTITY_GATED = [
  'connect',
  'armOrStart',
  'jog',
  'home',
  'setWorkZero',
  'spindleOrCoolantOn',
  'settingsWrite',
  'applyProfile',
  'flashFirmware',
] as const;
export type GatedAction = (typeof IDENTITY_GATED)[number];

/** Never gated on identity (RUN_PLAN §2.2). Listed so tests can prove the two sets are disjoint. */
export const NEVER_GATED = ['pause', 'stopJob', 'spindleCoolantOffNow', 'resetController', 'disconnect', 'recoveryCard'] as const;
export type NeverGatedAction = (typeof NEVER_GATED)[number];

export type ProviderKind = 'run-session' | 'access' | 'bench';

export interface Identity {
  readonly provider: ProviderKind;
  readonly subject: string;
}

export interface IdentityProvider {
  readonly kind: ProviderKind;
  /** The identity now, or null. Must not throw. */
  current(): Promise<Identity | null>;
}

export type AuthDecision = { readonly allowed: true; readonly identity: Identity } | { readonly allowed: false; readonly reason: 'signed-out' };

export function isGatedAction(value: unknown): value is GatedAction {
  return typeof value === 'string' && (IDENTITY_GATED as readonly string[]).includes(value);
}

export class AuthGate {
  readonly providers: readonly IdentityProvider[];

  constructor(providers: readonly IdentityProvider[]) {
    this.providers = providers;
  }

  /** Decides one request from G. Anything not in G is refused (a caller bug, never a pass). */
  async check(action: GatedAction): Promise<AuthDecision> {
    if (!isGatedAction(action)) return { allowed: false, reason: 'signed-out' };
    for (const provider of this.providers) {
      let identity: Identity | null = null;
      try {
        identity = await provider.current();
      } catch {
        identity = null;
      }
      if (identity !== null && identity.provider === provider.kind && identity.subject.length > 0) return { allowed: true, identity };
    }
    return { allowed: false, reason: 'signed-out' };
  }
}

/** The run session provider: A1-07 has not shipped, so there is never a session. */
export const RUN_SESSION_PROVIDER: IdentityProvider = Object.freeze({
  kind: 'run-session',
  current: () => Promise.resolve(null),
});

/** The Access provider over the cloud client's identity read. */
export function accessProvider(fetchIdentity: () => Promise<{ provider: string; subject: string } | null>): IdentityProvider {
  return {
    kind: 'access',
    async current() {
      const id = await fetchIdentity().catch(() => null);
      return id !== null && id.provider === 'access' ? { provider: 'access', subject: id.subject } : null;
    },
  };
}

/**
 * The providers a page uses. Production: the run session only. Staging:
 * the run session, then the Access identity. The bench channel: its own
 * bench identity only. Any other origin (localhost release builds,
 * previews): the run session only, which today means "refused".
 */
export function providersFor(channel: BuildChannel, environment: AdvisoryEnvironment | null, access: IdentityProvider): readonly IdentityProvider[] {
  if (channel.kind === 'bench') return channel.benchIdentity === null ? [] : [channel.benchIdentity];
  if (environment === 'staging') return [RUN_SESSION_PROVIDER, access];
  return [RUN_SESSION_PROVIDER];
}
