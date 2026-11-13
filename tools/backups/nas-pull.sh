#!/bin/sh
# The rclone config's remote must be named synthetos-backups (Object Read only, this bucket only).
set -eu
umask 077
if [ "$#" -ne 1 ] || [ ! -r "$1" ]; then
  echo 'Usage: nas-pull.sh /path/to/private-rclone.conf' >&2
  exit 2
fi
config=$1
root=/mnt/user/mybackups/synthetos-db
mkdir -p "$root"
status=FAILED
files=$(mktemp)
finish() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$status" >> "$root/pull.log"
  rm -f "$files"
}
trap finish 0
trap 'exit 1' HUP INT TERM
# copy, never sync: no delete or overwrite of cold-storage files, even after R2 retention expires.
for repo in accounts run; do
  mkdir -p "$root/$repo"
  rclone --config "$config" copy "synthetos-backups:synthetos-db-backups/$repo" "$root/$repo" \
    --ignore-existing --include '*.sql.gz' --include '*.sql.gz.sha256' --quiet >/dev/null 2>&1 || exit 1
done
find "$root/accounts" "$root/run" -type f -name '*.sql.gz' > "$files"
while IFS= read -r archive; do
  checksum=$archive.sha256
  [ -f "$checksum" ] || exit 1
  filename=$(basename "$archive")
  # Reject paths or extra entries in an untrusted sidecar before invoking sha256sum.
  awk -v name="$filename" 'NR == 1 && length($1) == 64 && $1 !~ /[^0-9a-f]/ && $2 == name && NF == 2 { ok = 1; next } { ok = 0; exit } END { exit !ok }' "$checksum" || exit 1
  (cd "$(dirname "$archive")" && sha256sum -c "$filename.sha256" >/dev/null 2>&1) || exit 1
done < "$files"
find "$root/accounts" "$root/run" -type f -name '*.sql.gz.sha256' > "$files"
while IFS= read -r checksum; do
  [ -f "${checksum%.sha256}" ] || exit 1
done < "$files"
status=OK
