/**
 * The compiled-in public keys that may sign `firmware/approved-builds.json`
 * (RUN_PLAN §6.3: "signed with an offline release key (Ed25519; the public
 * key is compiled into the app)").
 *
 * Each key lists the environments it may approve builds for. A key that may
 * not sign for production cannot make a production approval, whatever its
 * payload says (the payload's `env` must ALSO match: approvedBuilds.ts).
 *
 * Owner action: the only key below is the owner's bench key. It is marked
 * `placeholder` and authorised for `staging` only, so it can never approve a
 * production build. Before any release-channel entry is needed (D5), the
 * owner generates the offline Ed25519 release key on a hardware-isolated
 * machine, adds its public half here with the environments it may sign, and
 * re-signs the manifest with `pnpm sign:builds` (docs/ops/release-key.md).
 *
 * The P0-08 development key `placeholder-bench-2026-11-01` was removed on
 * 2026-11-02: its private half was treated as disclosed, and nothing
 * committed is signed with it any more.
 */

export interface ReleaseKey {
  /** Key id, as the manifest's `kid` names it. */
  readonly kid: string;
  /** Raw 32-byte Ed25519 public key, base64. */
  readonly publicKey: string;
  readonly environments: readonly ('staging' | 'production')[];
  /** True for a development placeholder: never authorised for production (tested). */
  readonly placeholder: boolean;
}

export const RELEASE_KEYS: readonly ReleaseKey[] = Object.freeze([
  // Owner's bench key (2026-11-02): staging and the localhost bench build only,
  // so it can never approve a production build. Private half kept outside the
  // repository (~/.synthetos-release-bench/). Not the offline release key.
  Object.freeze({
    kid: 'owner-bench-2026-11-02',
    publicKey: 'pC9KYeUSYum5QOyA8MoehjMWLGOg/2luNgaB/O6oJkY=',
    environments: Object.freeze(['staging'] as const),
    placeholder: true,
  }),
]);
