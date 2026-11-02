import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOutsideRepo } from '../src/release/keyPath.ts';

describe('sign:builds and sign:advisory refuse a key inside the repository', () => {
  const root = resolve('/work/run');
  it('a file whose name starts with two dots is inside the repository', () => {
    expect(isOutsideRepo(root, join(root, '..release.pkcs8.pem'))).toBe(false);
    expect(isOutsideRepo(root, join(root, '..keys', 'release.pkcs8.pem'))).toBe(false);
  });
  it('files under the repository are inside; the parent and its other children are outside', () => {
    expect(isOutsideRepo(root, join(root, 'release.pkcs8.pem'))).toBe(false);
    expect(isOutsideRepo(root, root)).toBe(false);
    expect(isOutsideRepo(root, resolve(root, '..'))).toBe(true);
    expect(isOutsideRepo(root, resolve(root, '../keys/release.pkcs8.pem'))).toBe(true);
    expect(isOutsideRepo(root, resolve('/elsewhere/release.pkcs8.pem'))).toBe(true);
  });
});
