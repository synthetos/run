import { expect, it } from 'vitest';
import * as contracts from '@synthetos/contracts';
import * as local from '../src/limits.ts';

it('the Worker’s local copies of the record and file limits equal the contracts', () => {
  expect([...local.RECORD_KINDS]).toEqual([...contracts.RECORD_KINDS]);
  expect(local.RECORD_MAX_BYTES).toBe(contracts.RECORD_MAX_BYTES);
  expect(local.PROJECT_RECORD_MAX_BYTES).toBe(contracts.PROJECT_RECORD_MAX_BYTES);
  expect(local.FILE_MAX_BYTES).toBe(contracts.FILE_MAX_BYTES);
  for (const kind of contracts.RECORD_KINDS) expect(local.recordMaxBytes(kind)).toBe(contracts.recordMaxBytes(kind));
});
