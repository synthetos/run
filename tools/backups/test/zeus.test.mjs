import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pack } from '../archive.mjs';
test('installed Zeus script skips staging, verifies new archives and retains cold copies without logging keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zeus-test-'));
  try {
    const root = join(dir, 'cold'), bin = join(dir, 'bin'); await mkdir(bin); await mkdir(root);
    const source = await readFile(new URL('../zeus-db-pull.sh', import.meta.url), 'utf8');
    await writeFile(join(dir, 'pull.sh'), source.replace('DEST=/mnt/storage/coldstorage/synthetos-db', `DEST=${root}`).replace('CONF="${HOME}/.config/synthetos-db-backups/rclone.conf"', `CONF="${join(dir, 'rclone.conf')}"`));
    await writeFile(join(dir, 'rclone.conf'), 'private-key');
    const mock = '#!/bin/sh\n[ "$3" = copy ] || exit 9\n[ "$4" = r2:synthetos-db-backups ] || exit 9\n[ "$6" = --exclude ] || exit 9\n[ "$7" = "staging/**" ] || exit 9\n[ "$8" = --ignore-existing ] || exit 9\n';
    await writeFile(join(bin, 'flock'), '#!/bin/sh\nexit 0\n'); await chmod(join(bin, 'flock'), 0o700);
    await writeFile(join(bin, 'rclone'), mock); await chmod(join(bin, 'rclone'), 0o700);
    const options = { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' };
    execFileSync('sh', [join(dir, 'pull.sh')], options);
    const { bytes, hash } = pack(Buffer.from('old archive'));
    await mkdir(join(root, 'run'));
    const archive = join(root, 'run', 'old.sql.gz'); await writeFile(archive, bytes); await writeFile(`${archive}.sha256`, `${hash}  old.sql.gz\n`);
    execFileSync('sh', [join(dir, 'pull.sh')], options);
    assert.deepEqual(await readFile(archive), bytes);
    const badArchive = join(root, 'run', 'new.sql.gz');
    await writeFile(badArchive, bytes);
    await writeFile(`${badArchive}.sha256`, `${'0'.repeat(64)}  new.sql.gz\n`);
    assert.throws(() => execFileSync('sh', [join(dir, 'pull.sh')], options));
    const log = await readFile(join(root, 'pull.log'), 'utf8'); assert.match(log, /1 verified, 0 failed/); assert.match(log, /FAILED: checksum mismatch/); assert.match(log, /0 verified, 1 failed/); assert.ok(!log.includes('private-key'));
    assert.deepEqual(await readFile(archive), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
