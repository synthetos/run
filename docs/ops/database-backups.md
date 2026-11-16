# Database backups and recovery

Owner decision: 2026-11-13, option C. Cloudflare backs itself up through private
scheduled Workers; no new backup key or nightly GitHub approval is needed.

## Provisioning and nightly operation

Each repository builds its backup Worker into the same twice-built, compared and
attested archive as its application Worker. Its existing deploy jobs provision
resources and deploy the backup Worker with that verified artifact: staging first,
then production with the owner's normal production approval. The application
Workers and their bindings are unchanged. Exact configuration gates refuse extra
bindings, routes, custom domains, workers.dev and preview URLs. The backup Workers
have only a cron handler and a fetch handler returning 404.

| Repo | Production / staging Worker | Source D1 | UTC cron |
| --- | --- | --- | --- |
| accounts | accounts-backup / accounts-backup-staging | identity / identity-staging | 07:45 production / 07:30 staging daily |
| run | run-backup / run-backup-staging | run-auth + run-data / run-auth-staging + run-data-staging | 07:50 production / 07:35 staging daily |

Backup provisioning runs after the site's post-deploy check where one exists. If
all source databases for the environment are absent, it prints “Backups not deployed
yet” in the log and job summary, publishes `ready=false`, and skips the backup Worker
deploy. No bucket or scratch resources are created in that case. With no D1 token,
the existing API token must be able to list D1 databases to establish absence;
a failed lookup is not treated as absence. Once any source exists, the D1 credential
is required and missing required sources or bucket/permission failures remain errors.
Run-data is optional only while it is absent before provisioning: existing run-auth
backups keep running. Once the database exists, provisioning binds SOURCE_DATA and
the same nightly dump and monthly scratch restore run for both databases.

The source databases are read-only **by code**, using SELECT (including schema
metadata queries). D1 bindings themselves do not enforce read-only access. Scratch
restores receive only the separate SCRATCH binding. Source and scratch IDs must
differ. No source writes are issued by the cron path. Run-data is listed alongside run-auth in `workers/backup/src/sources.ts` and both
reviewed templates. Provisioning, exact gates and the cron consume that same list;
no new credential or separate database backup engine is needed.

**File bytes are copied nightly** by the same run-backup cron (07:50 UTC production,
07:35 UTC staging), from the first night after deployment with the source bucket.
Provisioning optionally binds `SOURCE_FILES` to `run-files` or `run-files-staging`.
A missing bucket is logged and skipped; permission/lookup failures remain errors.
No source bucket is created by backup provisioning. The source binding is read-only
**by code**, not an R2 permission boundary: its interface exposes only list/head/get.
There are no source writes or deletes, and no delete operation on the destination.
D1 and file-copy results are logged separately; a database failure still allows the
file-copy attempt and a file failure marks the invocation failed.

### File copy, checkpoints and retention

Production copies use `files/<original-key>` in `synthetos-db-backups`; staging uses
`staging/files/<original-key>`. Original account-file keys are
`u/<user-id>/<sha256>-<upload-token>`. The copy preserves them, including the token
needed to reconcile restored database rows. It compares source etag and size with
saved destination metadata, skipping unchanged objects and replacing a changed
version at the same backup key using a conditional put. These are current object
copies, not a version history of an overwritten key. Normal account uploads use
immutable content-addressed keys with a new upload token.

R2's binding API has no server-side CopyObject operation, so the Worker passes the
R2 body stream directly to the destination without buffering the object. R2 checks
the SHA-256 from a content-addressed key during the put; zero-byte files use an empty
byte array. See the [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

Each trigger checks at most 40 source objects, with pages of at most 10 and a 200 MiB
copy-byte budget (reserving room for one maximum-sized object). Each object is at
most 50 MiB. A two-minute soft deadline is checked between operations; an in-flight
object operation can finish after it. Backup inventory uses at most 20 pages of 500
keys per trigger. The files path uses fewer than 250 R2 operations with these budgets,
in addition to the existing D1 archive work. Monthly verification reads at most five
50 MiB samples, streamed separately; it does not consume the copy-byte budget.

The small `backup-state/run-files.json` record (under `staging/` for staging)
checkpoints each completed source and inventory page. If a run dies mid-page, the
next trigger replays that page and skips already committed copies. Failed pages
are never advanced. Monthly verification checkpoints each verified sample. A
completed scan restarts on the next trigger, so keys added behind a listing cursor
are discovered on the next scan. A large backlog can take several nights; this is
not an atomic bucket/database snapshot or a guarantee that every new object reaches
the backup on its first night.

File-copy logs contain `sourceObjects`, `backupObjects`, `copied`, `skipped`, `failed`,
`bytes`, elapsed time and restore status. Counts are cumulative for their respective
current scan; `sourceComplete` / `backupComplete` distinguish a completed count from
a partial one. Source and backup scans can finish on different triggers. A `partial`
status means another trigger is needed, not that a complete snapshot exists. Failed
runs emit a sanitized summary and throw. Counts on failure may be partial or unknown.

Source deletion never deletes a saved copy. The current bucket lifecycle deletes
`staging/` objects after seven days; that includes staging files and its cursor.
Production's 30-day rules apply only to `accounts/` and `run/` SQL archives.
**Production `files/` currently has no automatic expiry** and grows until an explicit
owner-reviewed retention policy is added. This slice does not change bucket lifecycle
rules. Zeus retains cold copies indefinitely, never overwriting or deleting them.

Accounts provisions `synthetos-db-backups` idempotently during deploy, with no public
r2.dev access or custom domain. Existing public configuration fails closed. It
sets and reads back disjoint 30-day production and 7-day staging lifecycle rules;
it never deletes the bucket. Run verifies privacy before deploying. Deploy accounts
before run's first backup deployment. Existing CI credentials keep their existing
roles: `CLOUDFLARE_API_TOKEN` needs **Workers R2 Storage: Edit** and Worker deployment
permission; `CLOUDFLARE_D1_API_TOKEN` needs **D1: Edit** for scratch provisioning.
Those credentials stay in approved CI jobs and are never installed in the Workers.

The scheduled GitHub backup workflow was removed, including its secret-bearing
exception. There is no on-demand backup endpoint/workflow. Normal nights run under
Cloudflare cron without approval. Manual production **restore** remains a separate
protected workflow requiring approval, described below.

## Dump format, consistency and limits

Keys remain `<repo>/<database>/<YYYY-MM-DD>/<database>-<YYYY-MM-DDTHHMMZ>.sql.gz`,
with `<file>.sql.gz.sha256` beside each archive. Production uses `accounts/identity/`
and `run/run-auth/`; staging prefixes every path with `staging/`. Sidecars contain
`<hex>  <file name>\n`, two spaces, compatible with the unchanged Zeus pull script.
Existing keys are never overwritten, including conditional-put races. Both objects
are read back; their SHA-256 and the restored SQL bytes must match the original.

The dump reads tables, indexes and triggers from sqlite_master, excludes system
objects, and emits table definitions, rows, then indexes/triggers (so restoring
rows cannot replay trigger effects). Text and blobs are encoded as hex, preserving
quotes, newlines and NULs. Integers are converted to text inside SQLite so even
64-bit values never pass through a JavaScript number. Reals keep round-trip precision.
Gzip uses CompressionStream; checksums use crypto.subtle. The pure key, quoting and
checksum validation module and SQL parser are shared with the protected CI restore.

Below a conservative 4 MiB estimated encoded row budget, schema and all table reads
are in one D1 batch/transaction, giving one consistent view. Above that threshold,
reads page by rowid; the log explicitly says `paged-rowid-not-atomic`. Concurrent
writes can then produce a cross-page/cross-table inconsistent snapshot. A rowid-less
or fully shadowed-rowid large table fails closed. Schema changes detected during
planning/paging also fail the run. SQL output is capped at 16 MiB to stay inside
Worker memory; reaching it is a failed backup that needs review, not a truncated
success. Large text/blob restore values are bound rather than embedded in the
D1 statement, keeping statement text below its size limit.

The binding-based dump does not invoke the D1 export API's exclusive export step.
Read batches still consume database capacity and can delay other requests while
they execute. There is no measured production pause duration yet; monitor elapsed
milliseconds and D1 query latency on staging. Cloudflare's current limits include
a 50 MB query-result cap and finite Worker memory/runtime; the lower local budget
is intentional. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
and [query-result limit](https://developers.cloudflare.com/changelog/post/2026-10-30-query-result-size-limit/).

## Monthly recovery proof and failure visibility

On UTC day 1 the cron restores the newest archive it just wrote and verified into
its own environment’s scratch database: production uses `restore-test-<repo>` and
staging uses `restore-test-<repo>-staging`. Each Worker binds only its own scratch. Import,
verification SELECTs and table removal execute in one D1 batch transaction. The
returned counts are compared with the dump afterward. Staging runs 15 minutes before
production; separate scratch databases keep the environments isolated. Empty
application tables are preserved and valid. The same SQL
parser handles this restore and protected CI recovery. Cleanup runs in finally,
including partial imports and count failures. Runner termination or an API outage
can prevent cleanup; verify the next successful monthly cleanup or recover through
an owner-reviewed CI operation. Scratch must not host unrelated data.

On UTC day 1, the files job marks a restore check due. It keeps a reservoir sample
of up to five random backup objects across the paginated inventory, then reads each
sample back, counts bytes and checks the SHA-256 embedded in the key where present.
Hashing uses [Workers DigestStream](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/),
so samples are not buffered whole. Corrupt or missing bytes fail the invocation.
If inventory or verification exceeds the budget, the pending check resumes on a
later trigger; pending verification is attempted before new copying. Sampling is
recovery evidence, not a checksum sweep of every object. It does not restore objects
into the live files bucket.

Each database emits one structured JSON log with database, object key, byte count,
rows per table, elapsedMs, consistency and restore result. Failure logs report only
the failed stage and throw a sanitized exception so Cloudflare marks the cron run
failed. No SQL, row values or original D1 exception is logged.

In Cloudflare dashboard → Workers & Pages → `accounts-backup` or `run-backup`
(select the staging Worker when applicable), open **Observability / Logs** and filter
scheduled invocations. Check the structured `status`, `restore` and `consistency`
fields, and the failed invocation/error metrics. In the Worker's **Triggers / Cron
Triggers** view confirm the cron is configured and inspect recent runs. An absence
of a successful log for a night is also a backup failure, even if no log was emitted
by a terminated invocation. Observability is enabled with full head sampling on
these dedicated Workers only; normal application logging is unchanged. See
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Owner-approved recovery

Stop application writes before restoring and keep them stopped until sign-in and
record checks pass. First record the current database ID and desired recovery
point. Use Actions → **database-restore** → Run workflow, **main**. This is the
checked-in, byte-pinned, manual-only workflow, not the nightly workflow. Select
`run-auth` or `run-data` and type `RESTORE` followed by that exact database name.
Restoring run-data restores metadata only; reconcile file-object availability before
reopening writes. Its job
uses the protected **production** environment and the same pinned toolchain.
Type `RESTORE identity` in accounts or `RESTORE run-auth` in run. Review the selected
inputs and approve the production job. Never dispatch with a guess about the
recovery point.

### Recent damage: Time Travel

Choose `mode=time-travel`, the database, and `timestamp=YYYY-MM-DDTHH:MM:SSZ` in UTC;
leave `key` empty. D1 Time Travel retains 30 days on Workers Paid (7 days on Free),
so verify the account plan and available recovery point. The CI command is:

```sh
node tools/backups/restore-cli.mjs
# This validates the protected dispatch and resolves the selected database ID,
# then invokes the pinned executable with a private generated config:
ci/deploy-toolchain/node_modules/.bin/wrangler d1 time-travel restore BACKUP_DB --timestamp "$RESTORE_TIMESTAMP" --config "$RESTORE_CONFIG"
```

`BACKUP_DB` is bound to the selected production database in that generated config;
no checked-in placeholder ID is used. The wrapper suppresses child output.
See [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

### Older recovery or a lost database: SQL archive

Choose `mode=sql` and the exact production `.sql.gz` object key; leave timestamp
empty. The wrapper refuses staging, another repository or a path traversal key.
For an archive older than R2 retention, copy the preserved NAS archive **and its
sidecar**, unchanged, back to the same private R2 key through an owner-reviewed
CI recovery step with the existing R2 write credential. The NAS credential cannot
upload. Never attach SQL to an issue, public artifact or workflow log.

The manual checked-in workflow executes `node tools/backups/restore-cli.mjs`. In order it:

1. Downloads the selected archive and sidecar using pinned `wrangler r2 object get
   synthetos-db-backups/<key> --remote --file <private-path> --config <private-config>`.
2. Checks SHA-256, decompresses, checks expected tables, and performs the scratch
   restore/count check described above. An invalid archive never reaches production.
3. Resolves the production database by name, creating it only if it was lost. If
   it still has tables, exports and verifies a fresh safety backup first. If that
   current database is too damaged to export, this path fails closed: use Time
   Travel or a separately reviewed incident recovery change rather than bypassing
   the safety backup silently.
4. Empties the selected production database and invokes pinned
   `wrangler d1 execute BACKUP_DB --remote --yes --file <verified-sql> --config
   <private-config>`, then verifies every table count against the archive.

A failed production import can leave partial data. Keep writes stopped and retry
only after assessing the failure; the source archive and safety backup remain.
The Worker dump includes and restores `d1_migrations`, preserving the migration
ledger. The normal CI migration step therefore applies only newer migrations after
a restore. Only `sqlite_*` and `_cf_*` system objects are excluded.

If the database was recreated, its ID changed: run the existing CI provisioning
and deployment path to update bindings and redeploy. Do not reopen traffic while
bindings still point at the lost ID. Check sign-in and application behavior after
either recovery path. Production restoration is never scheduled automatically.

## Zeus cold storage

The updated pull script is committed in run at
`tools/backups/zeus-db-pull.sh`. Zeus (`192.168.1.221`) pulls nightly at **03:30
America/New_York** into `/mnt/storage/coldstorage/synthetos-db/`, preserving bucket
paths and skipping `staging/`. It never deletes or overwrites cold copies.
The log is `/mnt/storage/coldstorage/synthetos-db/pull.log`; rclone errors go to
`rclone-errors.log` beside it. Install the updated script on Zeus through the existing owner-managed process; no schedule change is needed. This code change does not update the installed NAS copy.

The owner creates an R2 API token with **Object Read only**, **Apply to specific
buckets only**, selecting only `synthetos-db-backups`. Write its credentials as an
rclone config on zeus at `~/.config/synthetos-db-backups/rclone.conf` with remote
name **r2**, type `s3`, provider **Cloudflare**, region `auto`, and the endpoint from
R2. Keep the config private (mode 600); never commit or print its keys. This is an
S3 credential, not the CI Cloudflare REST token. See
[R2 token permissions](https://developers.cloudflare.com/r2/api/tokens/).

Until that config exists, the installed script logs “not configured” and exits
successfully. Once configured, it copies new SQL archives and `files/` objects (skipping cursor metadata), verifies each new archive and each content-addressed file against its key digest,
and records verified paths in `.verified`. Already verified files are retained
without rechecking on every pull. An overlapping pull is skipped under a lock.
Missing checksums or mismatches fail the pull; monitor its exit status and log.

Backups write each checksum as `<hex>  <file name>` (two spaces, terminating
newline) in `<file>.sql.gz.sha256` next to `<file>.sql.gz`, matching the installed
script. Bucket name and staging prefix remain unchanged. R2 expiry never deletes
the cold copy. An interrupted two-object upload may need a later pull once its
checksum arrives; investigate mismatches rather than replacing a cold copy.
Minute-granularity archive keys refuse same-minute retries rather than overwriting
an earlier archive; wait for the prior job to finish and the minute to change.

## Recovering account file bytes

Keep application writes stopped while reconciling a run-data SQL recovery. For each
ready file row, find `files/u/<user-id>/<sha256>-<token>` (or the staging equivalent)
and verify its size and SHA-256 before copying it back to the same original key in
the environment's private source bucket. Use a separately owner-reviewed recovery
operation with existing approved credentials; this slice adds no public restore
endpoint or automatic live-bucket writes. Check every file referenced by restored
projects before reopening writes. A row whose bytes never reached backup cannot
be recovered by restoring SQL alone. Retained orphan objects can be left in backup.

If the R2 copy is missing, look for the identical key in Zeus cold storage. The NAS
credential is read-only and cannot upload; restoration requires the owner-reviewed
write path. Zeus's never-overwrite rule retains the first cold copy if an R2 key is
later replaced. Validate that cold content against the desired row; never silently
replace a mismatched cold copy. For a damaged cursor, investigate logs first, then
reset only that environment's cursor via an owner-reviewed operation to restart
scanning; replay is safe and does not delete existing copies.
