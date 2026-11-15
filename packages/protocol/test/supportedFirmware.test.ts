import { expect, it } from 'vitest';
import { SUPPORTED_TINYG_BUILDS, supportsFirmware } from '../src/supportedFirmware.ts';
it('pins the reviewed TinyG builds without approving adjacent or future downloads', () => {
  expect(SUPPORTED_TINYG_BUILDS).toEqual([450.01, 450.02, 450.03, 450.04, 450.05, 450.06]);
  for (const fb of SUPPORTED_TINYG_BUILDS) expect(supportsFirmware('tinyg-en', fb)).toBe(true);
  for (const fb of [undefined, null, '450.05', NaN, Infinity, 440.21, 450, 450.07, 450.051]) expect(supportsFirmware('tinyg-en', fb)).toBe(false);
  expect(supportsFirmware('tinyg-440', 450.05)).toBe(false);
});
