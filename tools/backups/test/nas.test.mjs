import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pack } from '../archive.mjs';
test('NAS copies only production, verifies sidecars, preserves old files and logs failures without keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nas-test-'));
  try {
    const root = join(dir, 'cold'), bin = join(dir, 'bin'); await mkdir(bin); await mkdir(root);
    const source = await readFile(new URL('../nas-pull.sh', import.meta.url), 'utf8');
    await writeFile(join(dir, 'pull.sh'), source.replace('/mnt/user/mybackups/synthetos-db', root));
    await writeFile(join(dir, 'rclone.conf'), 'private-key');
    const mock = '#!/bin/sh\n[ "$3" = copy ] || exit 9\ncase "$4" in *:synthetos-db-backups/accounts|*:synthetos-db-backups/run) ;; *) exit 9;; esac\n[ "$6" = --ignore-existing ] || exit 9\nmkdir -p "$5"\n';
    await writeFile(join(bin, 'rclone'), mock); await chmod(join(bin, 'rclone'), 0o700);
    const options = { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' };
    execFileSync('sh', [join(dir, 'pull.sh'), join(dir, 'rclone.conf')], options);
    const { bytes, hash } = pack(Buffer.from('old archive'));
    const archive = join(root, 'run', 'old.sql.gz'); await writeFile(archive, bytes); await writeFile(`${archive}.sha256`, `${hash}  old.sql.gz\n`);
    execFileSync('sh', [join(dir, 'pull.sh'), join(dir, 'rclone.conf')], options);
    assert.deepEqual(await readFile(archive), bytes);
    await writeFile(`${archive}.sha256`, `${'0'.repeat(64)}  old.sql.gz\n`);
    assert.throws(() => execFileSync('sh', [join(dir, 'pull.sh'), join(dir, 'rclone.conf')], options));
    const log = await readFile(join(root, 'pull.log'), 'utf8'); assert.match(log, /OK\n.*OK\n.*FAILED\n$/); assert.ok(!log.includes('private-key'));
    assert.deepEqual(await readFile(archive), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
