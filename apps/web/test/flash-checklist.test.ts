import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { c6Boxes } from '@synthetos/safety';
import { ConfirmSettings } from '../src/firmware/ConfirmSettings.ts';
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

it('omits E-stop advice only on the open updater, retaining danger notes and mains checks', () => {
  const props = { view: { message: null }, target: { kind: 'backup' as const, id: 'test', fb: 450.02, sha256: 'a'.repeat(64) }, onCancel: () => {}, onConfirm: () => {} };
  const workspace = renderToString(h(ConfirmFlash, props));
  const update = renderToString(h(ConfirmFlash, { ...props, openUpdate: true }));
  expect(workspace).toContain('E-stop');
  expect(update).not.toContain('E-stop');
  expect(update).toContain('5. The tool is clear of the work.');
  expect(update).toContain('data-safety="W11"');
  expect(update).toContain('data-safety="W28"');
  expect(update).toContain('Spindle and VFD mains are switched off');
  expect(update).toContain('Spindle, VFD, laser and coolant mains power are switched off');
});
it('keeps workspace restore advice unchanged while the open updater omits E-stop advice', () => {
  const props = { changes: [{ key: 'xvm', label: 'Velocity', from: 100, to: 200, words: '100 to 200', risk: { category: 'other' as const, highRisk: false, consequence: null, afterWrite: null } }], boardId: 'board', blocked: false, onCancel: () => {}, onConfirm: () => {} };
  expect(renderToString(h(ConfirmSettings, props))).toContain('Keep your hand near the E-stop.');
  const update = renderToString(h(ConfirmSettings, { ...props, restoreOnly: true }));
  expect(update).not.toContain('E-stop');
  expect(update).toContain('reads each back. It stops at the first problem.');
});
