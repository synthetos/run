#!/bin/sh
# Pull Synthetos production database backups from R2 to zeus cold storage.
#
# - Copies new objects from the private bucket `synthetos-db-backups` (production prefixes only; staging/ is skipped)
#   into /mnt/storage/coldstorage/synthetos-db/, keeping the bucket's paths.
# - Never overwrites and never deletes anything here: cold storage keeps every file.
# - Verifies each new `.sql.gz` against its `.sha256` (sha256sum format: "<hex>  <file name>").
# - Writes one line per run to pull.log. Until the read-only R2 credential exists it logs "not configured" and exits 0.
# - The credential lives only in $CONF (an rclone config with a remote named "r2"); this script never prints it.
set -eu

DEST=/mnt/storage/coldstorage/synthetos-db
CONF="${HOME}/.config/synthetos-db-backups/rclone.conf"
BUCKET=synthetos-db-backups
LOG="$DEST/pull.log"
VERIFIED="$DEST/.verified"
LOCK="$DEST/.lock"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '%s %s\n' "$(now)" "$1" >> "$LOG"; }

mkdir -p "$DEST"
touch "$VERIFIED"

exec 9>"$LOCK"
if ! flock -n 9; then log "skipped: another pull is running"; exit 0; fi

if [ ! -s "$CONF" ]; then log "not configured: no read-only R2 credential at $CONF yet"; exit 0; fi

before=$(find "$DEST" -type f -name '*.sql.gz' | wc -l)
if ! rclone --config "$CONF" copy "r2:$BUCKET" "$DEST" \
      --exclude 'staging/**' --ignore-existing --no-update-modtime \
      --transfers 2 --log-level ERROR 2>>"$DEST/rclone-errors.log"; then
  log "FAILED: rclone copy returned an error (see rclone-errors.log)"
  exit 1
fi
after=$(find "$DEST" -type f -name '*.sql.gz' | wc -l)

checked=0
bad=0
for f in $(find "$DEST" -type f -name '*.sql.gz' | sort); do
  grep -qxF "$f" "$VERIFIED" && continue
  sum="$f.sha256"
  [ -f "$sum" ] || sum="${f%.gz}.sha256"
  if [ ! -f "$sum" ]; then log "FAILED: no checksum file for $f"; bad=$((bad + 1)); continue; fi
  want=$(cut -d' ' -f1 < "$sum")
  got=$(sha256sum "$f" | cut -d' ' -f1)
  if [ "$want" = "$got" ]; then
    printf '%s\n' "$f" >> "$VERIFIED"
    checked=$((checked + 1))
  else
    log "FAILED: checksum mismatch for $f"
    bad=$((bad + 1))
  fi
done

log "ok: $((after - before)) new file(s), $checked verified, $bad failed, $after total"
[ "$bad" -eq 0 ]
