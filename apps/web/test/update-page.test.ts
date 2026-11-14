import { expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { UpdatePage } from '../src/pages/update/UpdatePage.ts';
import { PAGES } from '../src/pages/registry.ts';

it('prerenders the separate update entry without workspace navigation or controls', () => {
  const html = renderToString(h(UpdatePage, { build: { version: '1.0.0', sha: 'a'.repeat(40) } }));
  expect(PAGES['/update/index.html']).toBeDefined();
  expect(html).toContain('Update your TinyG');
  expect(html).toContain('No account needed.');
  expect(html).toContain('data-region="safety-bar"');
  expect(html).not.toContain('href="/"');
  expect(html).not.toContain('data-region="machine-strip"');
});
