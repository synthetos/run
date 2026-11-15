import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { FIRMWARE_RELEASE_REPOSITORIES } from '../../../packages/protocol/src/firmwareReleases.ts';
import { FIRMWARE_REPOSITORIES } from '../../../workers/run/src/firmwareProxy.ts';
it('pins the only firmware repository on both sides and removes signing commands/files', () => {
  expect(FIRMWARE_RELEASE_REPOSITORIES).toEqual(['synthetos/TinyG']);
  expect(FIRMWARE_REPOSITORIES).toEqual(FIRMWARE_RELEASE_REPOSITORIES);
  const root = resolve(import.meta.dirname, '../../..');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const command of ['sign:builds', 'sign:advisory', 'sign:releases']) expect(pkg.scripts[command]).toBeUndefined();
  expect(existsSync(resolve(root, 'firmware/releases.json'))).toBe(false);
});
