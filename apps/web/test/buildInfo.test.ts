/** The version chip's data (ROADMAP P0-05) and how the build determines it. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBuildInfo, shortSha, versionLabel } from '../src/build-info/buildInfo.ts';
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

  it('takes the SHA from RUN_BUILD_SHA when set, and refuses a malformed one', () => {
    expect(buildInfo(web, { RUN_BUILD_SHA: SHA }).sha).toBe(SHA);
    expect(() => buildInfo(web, { RUN_BUILD_SHA: 'main' })).toThrow(/40-digit commit SHA/);
  });

  it('otherwise reads HEAD from git in the web root', () => {
    const head = execFileSync('git', ['-C', web, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(buildInfo(web, {}).sha.slice(0, 40)).toBe(head);
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
