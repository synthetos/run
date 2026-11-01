/**
 * What the suite serves (ROADMAP P0-06): the mode comes only from the
 * environment, a half-artifact configuration is refused, and the artifact
 * command is the deploy command with `dev`.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { REPO_ROOT, servedMode, servedPath, shellQuote, wranglerArgs } from '../src/served.ts';

describe('servedMode', () => {
  it('is source mode with neither variable, serving apps/web/dist', () => {
    expect(servedMode({}, '/x')).toEqual({ kind: 'source', siteDir: join(REPO_ROOT, 'apps/web/dist') });
    expect(servedMode({ RUN_E2E_SITE: '', RUN_E2E_WORKER: '' }, '/x').kind).toBe('source');
  });

  it('is artifact mode with both, resolving relative paths against cwd', () => {
    expect(servedMode({ RUN_E2E_SITE: 'site', RUN_E2E_WORKER: '/abs/worker' }, '/w')).toEqual({ kind: 'artifact', siteDir: '/w/site', workerDir: '/abs/worker' });
  });

  it('refuses only one of the two', () => {
    expect(() => servedMode({ RUN_E2E_SITE: 'site' }, '/w')).toThrow(/got only RUN_E2E_SITE/);
    expect(() => servedMode({ RUN_E2E_WORKER: 'worker' }, '/w')).toThrow(/got only RUN_E2E_WORKER/);
  });
});

describe('wranglerArgs', () => {
  it('serves the artifact Worker unbundled with the artifact site, through the deploy config', () => {
    const args = wranglerArgs({ kind: 'artifact', siteDir: '/a/site', workerDir: '/a/worker' }, 8790);
    expect(args.slice(1, 6)).toEqual(['dev', '/a/worker/index.mjs', '--no-bundle', '--assets', '/a/site']);
    expect(args).toContain(join(REPO_ROOT, 'workers/run/wrangler.jsonc'));
    expect(args.join(' ')).toContain('--ip 127.0.0.1');
  });

  it('bundles the source Worker in source mode and never passes --assets or --no-bundle', () => {
    const args = wranglerArgs({ kind: 'source', siteDir: '/d' }, 8790);
    expect(args[1]).toBe('dev');
    expect(args).not.toContain('--no-bundle');
    expect(args).not.toContain('--assets');
  });
});

describe('shellQuote', () => {
  it('leaves plain paths alone and single-quotes anything else', () => {
    expect(shellQuote('/a/b-c_d.mjs')).toBe('/a/b-c_d.mjs');
    expect(shellQuote('/a b/c')).toBe("'/a b/c'");
    expect(shellQuote("/it's")).toBe(`'/it'\\''s'`);
    expect(shellQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'");
  });
});

describe('servedPath', () => {
  it('maps site files to the paths the asset layer serves them at', () => {
    expect(servedPath('index.html')).toBe('/');
    expect(servedPath('safety/index.html')).toBe('/safety/');
    expect(servedPath('assets/base-x.js')).toBe('/assets/base-x.js');
    expect(servedPath('_headers')).toBeUndefined();
    expect(servedPath('404.html')).toBeUndefined();
  });
});
