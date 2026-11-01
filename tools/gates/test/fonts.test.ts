/**
 * Self-hosted IBM Plex (ROADMAP P0-04): the vendored files are the ones
 * recorded in their README (IBM's unmodified Latin-1 subsets), the OFL ships
 * with them and in the build, and the stylesheet references only vendored
 * files, never another origin.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './scratch.ts';

const FONT_DIR = join(REPO_ROOT, 'apps/web/src/fonts/ibm-plex');
const README = readFileSync(join(FONT_DIR, 'README.md'), 'utf8');
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** `| file | package | sha256 |` rows of the README table. */
const recorded = new Map(
  [...README.matchAll(/^\| (\S+\.(?:woff2|txt)) \| [^|]+ \| ([0-9a-f]{64}) \|$/gm)].map((m) => [m[1] as string, m[2] as string]),
);

describe('vendored IBM Plex', () => {
  it('every file in the directory is recorded, and every recorded file is present with its hash', () => {
    const files = readdirSync(FONT_DIR).filter((f) => f !== 'README.md').sort();
    expect([...recorded.keys()].sort()).toEqual(files);
    for (const [file, hash] of recorded) expect(sha(join(FONT_DIR, file)), file).toBe(hash);
  });

  it('ships the SIL Open Font License, also served by the build', () => {
    const ofl = readFileSync(join(FONT_DIR, 'OFL.txt'), 'utf8');
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(ofl).toContain('Reserved Font Name "Plex"');
    expect(readFileSync(join(REPO_ROOT, 'apps/web/public/licenses/IBM-Plex-OFL.txt'), 'utf8')).toBe(ofl);
  });

  it('fonts.css references only vendored WOFF2 files, by relative path', () => {
    const css = readFileSync(join(REPO_ROOT, 'apps/web/src/styles/fonts.css'), 'utf8');
    const urls = [...css.matchAll(/url\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] as string);
    expect(urls.length).toBe([...recorded.keys()].filter((f) => f.endsWith('.woff2')).length);
    for (const url of urls) {
      expect(url).toMatch(/^\.\.\/fonts\/ibm-plex\/[A-Za-z0-9-]+\.woff2$/);
      expect(existsSync(resolve(REPO_ROOT, 'apps/web/src/styles', url)), url).toBe(true);
    }
    expect(css).not.toMatch(/:\/\/|@import/);
  });
});
