# The release key and the approved-builds manifest

ROADMAP P0-08, RUN_PLAN §5.2 and §6.3, SAFETY H27 and H44, DECISIONS D4 and D5.

`firmware/approved-builds.json` decides which firmware builds may run with
full support. A board that is not listed is always READ_ONLY. The app checks
the file's Ed25519 signatures against public keys compiled into
`packages/protocol/src/releaseKeys.ts`, so whoever holds the private release
key decides which builds may move machines. Treat that key like the deploy
token.

## How the file works

- **Two channels.**
  - `bench`: edge-next candidates you approve for bench use. Signed with
    `env: "staging"`. Only `staging.run.synthetos.com` reads it.
  - `release`: builds that pass D5 (a hash match and a signed HIL run of that
    exact image). Signed with `env: "production"`. Only `run.synthetos.com`
    reads it. It stays empty until D4 and D5 are done.
- **One artifact for both sites.** The code works out its environment from
  `location.origin`. It accepts a channel only when all of these hold:
  - the signature verifies;
  - the signing key is authorised for that environment;
  - the signed payload names that same environment;
  - the payload has not expired.

  The artifact that passed HIL on staging is therefore byte-for-byte the
  artifact production serves. Production still refuses bench entries, because
  of the signature and the `env` field, not because of a build flag (T-S75).
- **Any other origin** (localhost, previews, `workers.dev`) has no environment
  and approves nothing.
- **Each entry names an exact build.** It gives the dialect (`tinyg-en` or
  `tinyg-440` only), the `fb`, the `fbs` (or `null` for a build that reports
  none) and the firmware commit. The capability probe must also classify the
  board as that dialect: a manifest entry never upgrades a board on its own
  (PN §2.3).
- **The files.** The reviewed source is
  `firmware/approved-builds.unsigned.json`. The signed file holds each channel
  as a JSON string with its signature. A gate test fails if the two disagree.

## Status (2026-11-01): placeholder key

The only key in `releaseKeys.ts` is `placeholder-bench-2026-11-01`. It was
generated during P0-08 so that the bench channel could be signed and tested.
It is authorised for **staging only**, and a test fails if a placeholder key
is ever authorised for production. Its private half is not in the repository.
It was left in the P0-08 build session's scratch directory; treat it as
disclosed and replace it.

## Lead actions (owner)

1. **Create the release key** on an offline, hardware-isolated machine:

   ```sh
   openssl genpkey -algorithm ed25519 -out release.pkcs8.pem
   openssl pkey -in release.pkcs8.pem -pubout -outform DER | tail -c 32 | base64
   ```

   Keep `release.pkcs8.pem` offline, for example on encrypted removable media
   with a backup. Never put it in CI, in a GitHub secret or in this
   repository.
2. **Compile the public key in.** Add it to `RELEASE_KEYS` in
   `packages/protocol/src/releaseKeys.ts` with a new `kid`,
   `placeholder: false`, and the environments it may sign (`staging`, and
   `production` once D5 has an approved image). Remove the placeholder entry.
3. **Approve and sign.** Edit `firmware/approved-builds.unsigned.json` (bench:
   the edge-next candidate you approve, by `fb` and commit), then run this on
   the offline machine:

   ```sh
   pnpm sign:builds --key /path/outside/the/repo/release.pkcs8.pem --kid <kid>
   ```

   Commit both files. CODEOWNERS makes you a required reviewer of
   `firmware/`, `releaseKeys.ts` and `approvedBuilds.ts`.
4. **When edge-next is released (D4, D5):**
   - add the release build to the `release` channel, signed for production;
   - re-pin `vendor/firmware-pins.json` and the dialect citations to the
     release commit (PIN-1);
   - ask for the `fbs` token (D4) so that entries can name the build hash.
5. **Before each expiry,** re-sign with a later `expires` date. An expired
   channel approves nothing, so every board becomes READ_ONLY. That fails
   safe, but it stops the bench.

## Rotation and revocation

- **Rotation:** add the new key, re-sign, ship, then remove the old key in a
  later release. Tabs that are already open keep the old code until they
  reload.
- **Withdrawing a build:** remove its entry and re-sign. A tab that is
  already LIVE keeps its session (SAFETY H27); every new connect reads the new
  file.
- **Compromised key:** remove it from `RELEASE_KEYS` and ship at once. The
  incident runbook applies (SAFETY H46).
