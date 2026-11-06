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
    reads it. It stays empty until an image passes D5. (D4, the build
    number, is done: edge-next reported 450.01 from `ead63997` to `93a723b8`;
    the current pin `a7489b79`, tagged 450.02, reports 450.02.)
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

## Status (2026-11-02): owner bench key

The only key in `releaseKeys.ts` is `owner-bench-2026-11-02`, the owner's
bench key. It is marked `placeholder: true` and authorised for **staging
only**, and a test fails if a placeholder key is ever authorised for
production. Its private half is kept outside the repository. It is not the
offline release key, which step 1 below still creates.

Both committed signed files are signed with it, and each signature verifies
against its compiled-in public key:

- `firmware/approved-builds.json`: the `bench` and `release` channels;
- `apps/web/public/safety-advisory.json`: the `staging` advisory.

The P0-08 development key `placeholder-bench-2026-11-01` was removed from
`RELEASE_KEYS` on 2026-11-02. Its private half had been left in a build
session's scratch directory and was treated as disclosed; nothing committed
was signed with it any more, so removing it changes no approval.

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
   `production` once D5 has an approved image). Remove the bench key entry
   once nothing committed is signed with it (see Rotation below).
3. **Approve and sign.** Edit `firmware/approved-builds.unsigned.json` (bench:
   the edge-next candidate you approve, by `fb` and commit), then run this on
   the offline machine:

   ```sh
   pnpm sign:builds --key /path/outside/the/repo/release.pkcs8.pem --kid <kid>
   ```

   Commit both files. CODEOWNERS makes you a required reviewer of
   `firmware/`, `releaseKeys.ts` and `approvedBuilds.ts`.
4. **When an edge-next image passes D5 and is published (D6):** D4, the
   build number, is already done (450.02; the pinned commit is now
   `a7489b79`). Then:
   - add the release build to the `release` channel, signed for production;
   - if the published release commit is not `a7489b79`, re-pin
     `vendor/firmware-pins.json` and the dialect citations to it (PIN-1);
   - ask for the `fbs` token D4 recommends, so that entries can name the
     build hash (a `release` entry without `fbs` is refused).
5. **Before each expiry,** re-sign with a later `expires` date. An expired
   channel approves nothing, so every board becomes READ_ONLY. That fails
   safe, but it stops the bench.

## The firmware release list (2026-11-03)

`firmware/releases.json` is signed with the same keys and the same rules (per
environment, an authorised key, the payload naming its environment, an
expiry), over its own prefix, with `pnpm sign:releases`. Staging is signed with
the bench key; production has no entry until you sign one with the release key.
See docs/ops/firmware-releases.md.

## Rotation and revocation

- **Rotation:** add the new key, re-sign, ship, then remove the old key in a
  later release. Tabs that are already open keep the old code until they
  reload.
- **Withdrawing a build:** remove its entry and re-sign. A tab that is
  already LIVE keeps its session (SAFETY H27); every new connect reads the new
  file.
- **Compromised key:** remove it from `RELEASE_KEYS` and ship at once. The
  incident runbook applies (SAFETY H46).
