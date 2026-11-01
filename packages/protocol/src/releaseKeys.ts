/**
 * The compiled-in public keys that may sign `firmware/approved-builds.json`
 * (RUN_PLAN §6.3: "signed with an offline release key (Ed25519; the public
 * key is compiled into the app)").
 *
 * Each key lists the environments it may approve builds for. A key that may
 * not sign for production cannot make a production approval, whatever its
 * payload says (the payload's `env` must ALSO match: approvedBuilds.ts).
 *
 * LEAD ACTION (owner): the only key below is a PLACEHOLDER generated during
 * P0-08 so the bench channel can be signed and tested now. It is authorised
 * for `staging` only, so it can never approve a production build. Before any
 * release-channel entry is needed (D4, D5), the owner generates the offline
 * Ed25519 release key on a hardware-isolated machine, adds its public half
 * here with the environments it may sign, removes the placeholder, and
 * re-signs the manifest with `pnpm sign:builds` (docs/ops/release-key.md).
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
  Object.freeze({
    kid: 'placeholder-bench-2026-11-01',
    publicKey: 'yYYGnK63u6XSBDm94KyboC7q3nfTzjRlgxrB1VZWYuo=',
    environments: Object.freeze(['staging'] as const),
    placeholder: true,
  }),
]);
