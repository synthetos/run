import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { SUPPORTED_TINYG_BUILDS } from '../../../packages/protocol/src/supportedFirmware.ts';
it('support is the reviewed code list, with no external approved-build signing file', () => {
  expect(SUPPORTED_TINYG_BUILDS).toEqual([450.01, 450.02, 450.03, 450.04, 450.05, 450.06]);
  expect(existsSync(resolve(import.meta.dirname, '../../../firmware/approved-builds.json'))).toBe(false);
});
