import { expect, it } from 'vitest';
import { fileMetaText } from '../src/projects/fileMeta.ts';

it('shows the hash only at Advanced', () => {
  expect(fileMetaText('2 KB', 'Nov 1', '0fea5c6e4b99aa', false)).toBe('2 KB · added Nov 1');
  expect(fileMetaText('2 KB', 'Nov 1', '0fea5c6e4b99aa', true)).toBe('2 KB · added Nov 1 · sha256 0fea5c6e4b');
});
