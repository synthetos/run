/**
 * Cloud chunk attribution (ROADMAP P0-03). The bundle scan trusts
 * `assets/cloud/` only, so a chunk goes there only when its contents are
 * cloud-client code and its permitted dependencies.
 */
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOUD_ASSET_DIR, chunkPolicy } from '../build/chunks.ts';

const web = resolve(import.meta.dirname, '..');
const repo = resolve(web, '../..');
const policy = chunkPolicy(web);
const cloud = join(web, 'src/cloud/client.ts');

describe('chunkPolicy', () => {
  it('recognises cloud-client modules by location under apps/web/src/cloud', () => {
    expect(policy.isCloudModule(cloud)).toBe(true);
    expect(policy.isCloudModule(join(web, 'src/shell/cloud.ts'))).toBe(false);
    expect(policy.isCloudModule(join(web, 'src/cloudy/x.ts'))).toBe(false);
    expect(policy.isCloudModule(join(repo, 'packages/contracts/src/index.ts'))).toBe(false);
  });

  it('files a chunk of cloud code and permitted dependencies under assets/cloud/', () => {
    const ids = [
      '\0rolldown/runtime.js',
      cloud,
      join(repo, 'packages/contracts/src/index.ts'),
      join(repo, 'packages/provenance/src/index.ts'),
      join(repo, 'node_modules/.pnpm/valibot@1.5.0/node_modules/valibot/dist/index.js'),
    ];
    expect(policy.chunkFileName({ moduleIds: ids })).toBe(`${CLOUD_ASSET_DIR}[name]-[hash].js`);
  });

  it('files a chunk with any other module under assets/, whatever its name', () => {
    for (const other of [join(repo, 'packages/machine/src/index.ts'), join(web, 'src/shell/Shell.tsx'), join(repo, 'node_modules/preact/dist/preact.mjs')]) {
      expect(policy.chunkFileName({ moduleIds: [cloud, other] })).toBe('assets/[name]-[hash].js');
    }
  });

  it('never files a chunk without cloud code, or an empty facade, as cloud', () => {
    expect(policy.chunkFileName({ moduleIds: [join(repo, 'packages/contracts/src/index.ts')] })).toBe('assets/[name]-[hash].js');
    expect(policy.chunkFileName({ moduleIds: [] })).toBe('assets/[name]-[hash].js');
  });
});
