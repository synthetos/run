/** The version chip's data (ROADMAP P0-05) and how the build determines it. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBuildInfo, committedLabel, shortSha, versionLabel } from '../src/build-info/buildInfo.ts';
import { buildInfo } from '../build/buildInfo.ts';

const SHA = 'a'.repeat(40);
const web = resolve(import.meta.dirname, '..');

describe('build info', () => {
  it('accepts a semantic version and a full SHA, with or without -dirty', () => {
    expect(checkBuildInfo({ version: '0.0.0', sha: SHA })).toEqual({ version: '0.0.0', sha: SHA });
    expect(checkBuildInfo({ version: '1.2.3-rc.1', sha: `${SHA}-dirty` }).sha).toBe(`${SHA}-dirty`);
  });

  it.each([
    { version: '', sha: SHA },
    { version: 'latest', sha: SHA },
    { version: '0.0.0', sha: '' },
    { version: '0.0.0', sha: 'abc1234' },
    { version: '0.0.0', sha: `${SHA}0` },
    { version: '0.0.0', sha: 'G'.repeat(40) },
    { version: '0.0.0', sha: `${SHA}-modified` },
  ])('refuses %j', (info) => {
    expect(() => checkBuildInfo(info)).toThrow(/build info/);
  });

  it('labels the chip with the version and the first 12 digits of the SHA', () => {
    expect(versionLabel({ version: '0.4.1', sha: '0123456789abcdef0123456789abcdef01234567' })).toBe('v0.4.1 · 0123456789ab');
    expect(shortSha(`${SHA}-dirty`)).toBe(`${'a'.repeat(12)}-dirty`);
  });

  it('adds the commit time to the chip when it is known, in the commit\'s own offset', () => {
    const info = checkBuildInfo({ version: '0.0.0', sha: SHA, committedAt: '2026-11-03T10:48:12-05:00' });
    expect(versionLabel(info)).toBe(`v0.0.0 · ${'a'.repeat(12)} · 2026-11-03 10:48`);
    expect(committedLabel('2026-11-03T10:48:12Z')).toBe('2026-11-03 10:48');
    expect(() => checkBuildInfo({ version: '0.0.0', sha: SHA, committedAt: 'yesterday' })).toThrow(/ISO 8601/);
  });

  it('takes the SHA from RUN_BUILD_SHA when set, and refuses a malformed one', () => {
    expect(buildInfo(web, { RUN_BUILD_SHA: SHA })).toEqual({ version: expect.any(String), sha: SHA });
    expect(buildInfo(web, { RUN_BUILD_SHA: SHA, RUN_BUILD_COMMITTED_AT: '2026-11-03T10:48:12Z' }).committedAt).toBe('2026-11-03T10:48:12Z');
    expect(() => buildInfo(web, { RUN_BUILD_SHA: 'main' })).toThrow(/40-digit commit SHA/);
  });

  it('otherwise reads HEAD and its commit time from git in the web root', () => {
    const head = execFileSync('git', ['-C', web, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const when = execFileSync('git', ['-C', web, 'show', '-s', '--format=%cI', 'HEAD'], { encoding: 'utf8' }).trim();
    const info = buildInfo(web, {});
    expect(info.sha.slice(0, 40)).toBe(head);
    expect(info.committedAt).toBe(when);
  });

  it('refuses to build outside a git checkout without RUN_BUILD_SHA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-buildinfo-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.0.0' }));
      expect(() => buildInfo(dir, {})).toThrow(/refusing to build without a commit SHA/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
