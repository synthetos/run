# Firmware sources

Owner decision, 2026-11-15: “i want to bring in the say top 5 releases from the tinyg repo thats it i dont think we need all of this signing stuff”.

The update page reads the latest five non-draft releases of `synthetos/TinyG`
that each have exactly one `tinyg-*.hex` asset, including labelled pre-releases.
"Latest" ranks by the firmware version in the hex name (`tinyg-450.06.hex`), then by
date, so older builds uploaded later cannot push the newest out (owner, 2026-11-19).
The run Worker reads the fixed GitHub API and caches its response for ten minutes.

GitHub allows 60 keyless API calls an hour per address, and Cloudflare's shared
addresses exhaust that, so hosted Run got only refusals (owner, 2026-11-19: "key").
The Worker sends a read-only key for public repositories, the Worker secret
`GITHUB_RELEASES_TOKEN` (5,000 calls an hour). It comes from the GitHub environment
secret `RUN_GITHUB_RELEASES_TOKEN` in `staging` and `production` and is uploaded with
each deploy (`wrangler deploy --secrets-file`), so a rollback keeps code and key
together. The workflow policy admits that secret only in the pinned deploy step
(`tools/gates/src/workflow/releasesKeyCredential.ts`). With no key saved, deploys
leave the Worker's current key, if any, in place, and the Worker calls keyless.
Release notes are displayed as plain text. No repository or upstream URL comes
from the browser. Older releases fall out of the proxy allowlist on refresh.

GitHub's asset `sha256` digest and size are checked by the proxy, the page and the
flash worker. Missing digests, excessive size and mismatches refuse flashing.
The firmware page requests public metadata through the cloud client; a dedicated
reply port supplies metadata to the network-isolated flash worker. That worker
validates it again and checks the image bytes, hardware and part. The same-origin
page/HTTPS deployment now supplies authority; metadata is not independently
signed. This does not defend against compromised same-origin page code. Never
present digest comparison as an independent author signature.

Supported versions are reviewed code in `packages/protocol/src/supportedFirmware.ts`,
currently 450.01 through 450.06. Listing a newer GitHub release does not approve
machine control; the page warns that an unknown version will connect read-only.
The role and release-phase gates still apply. This task adds no override controls.
450.06 override fields remain read-only in Board settings. The Run panel has a separate, bounded RAM-only feed/spindle control path during this tab’s running or held job (SAFETY live override amendment).

The safety advisory is an unsigned, environment-specific deployed file. Its
schema, environment, validity, revocations and offline-age checks remain enforced.
There are no owner release-key steps or firmware signing commands. Run's own
reproducible-build provenance and deploy attestation are unchanged.

## RUN_PLAN §5.2 amendment

This decision replaces the requirement for signed per-environment firmware and
advisory files in RUN_PLAN §5.2. Firmware comes from the fixed GitHub source and
its asset digests; support is compiled code; the advisory ships with the deploy.
The canonical RUN_PLAN lives in the synthetos.com repository; its matching
§5.2 amendment is committed on the firmware-sources-docs branch.
