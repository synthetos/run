import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { c6Boxes } from '@synthetos/safety';
import { ConfirmFlash } from '../src/firmware/FlashViews.ts';
it('numbers the final mains checkbox without changing the registered C6 text', () => {
  const boxes = c6Boxes().boxes;
  const rendered = renderToString(h(ConfirmFlash, {
    view: { message: null }, target: { kind: 'backup', id: 'test', fb: 450.02, sha256: 'a'.repeat(64) },
    onCancel: () => {}, onConfirm: () => {},
  }));
  const labels = [...rendered.matchAll(/<label>(.*?)<\/label>/g)].map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
  expect(labels).toHaveLength(boxes.length);
  for (const [i, label] of labels.entries()) expect(label).toMatch(new RegExp(`^${i + 1}\\. `));
  expect(labels.at(-1)).toBe(`8. ${boxes.at(-1)}`);
  expect(boxes.at(-1)).toBe('Spindle and VFD mains are switched off and will stay off until my settings are restored and confirmed');
});
