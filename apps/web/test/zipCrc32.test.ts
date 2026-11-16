import { expect, it } from 'vitest';
import { crc32 } from '../src/projects/zip/crc32.ts';
it('matches the standard CRC-32 check vector', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
it('checks an empty file', () => expect(crc32(new Uint8Array())).toBe(0));
it('uses only the selected byte view', () => expect(crc32(new TextEncoder().encode('x123456789x').subarray(1, 10))).toBe(0xcbf43926));
