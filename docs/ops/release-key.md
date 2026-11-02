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
    number, is done: edge-next reports 450.01, at `ead63997` and still at the
    current pin `6ec70652`.)
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

### The signed bench note predates D4

The bench entry's `note` in `firmware/approved-builds.unsigned.json`, and so
inside the signed payload of `firmware/approved-builds.json`, still says the
build number is undecided, in the words it was signed with on 2026-11-01,
before D4 was decided. Only the note is out of date: the entry's `fb`
(450.01), `fbs` (`null`) and staging-only scope are correct, and no
approval decision reads the note. (The commit is the previous pin; see the
next section.)

It was deliberately **not** edited in the P0 review fix pass. A note is part
of the signed bytes, so changing it means re-signing (step 3 below) with a
key only the owner holds. The 2026-11-02 re-sign with the owner's bench key
kept the note's wording, so the note also still says it was signed with the
placeholder bench key. Editing the unsigned file alone would fail the gate
test that compares the two files.

**At your next re-sign** (which step 2 below needs anyway), replace the note
with, for example: "TinyG edge-next 450.01 (D4 done) for bench use on staging
only. It reports no fbs, so every 450.01 build matches; no image has passed
D5." The gate test `tools/gates/test/doc-drift.test.ts` then requires this
section to be removed.

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
   the edge-next candidate you approve, by `fb` and commit; replace the bench
   note that predates D4, see above), then run this on
   the offline machine:

   ```sh
   pnpm sign:builds --key /path/outside/the/repo/release.pkcs8.pem --kid <kid>
   ```

   Commit both files. CODEOWNERS makes you a required reviewer of
   `firmware/`, `releaseKeys.ts` and `approvedBuilds.ts`.
4. **When an edge-next image passes D5 and is published (D6):** D4, the
   build number, is already done (450.01; the pinned commit is now
   `6ec70652`). Then:
   - add the release build to the `release` channel, signed for production;
   - if the published release commit is not `6ec70652`, re-pin
     `vendor/firmware-pins.json` and the dialect citations to it (PIN-1);
   - ask for the `fbs` token D4 recommends, so that entries can name the
     build hash (a `release` entry without `fbs` is refused).
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
