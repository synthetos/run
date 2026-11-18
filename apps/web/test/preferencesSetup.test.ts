import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { EMPTY_SETUP_RECORD } from '@synthetos/library';
import { emptyCache } from '../src/workspace/cloud/cloudCache.ts';
import { connectSetup } from '../src/workspace/cloud/setupSync.ts';
import { PreferencesView, SETUP_AGAIN } from '../src/workspace/views/OtherViews.ts';
import { restartSetup } from '../src/wizard/setupActions.ts';
import { record } from './syncFixtures.ts';

const build = { version: '1.2.3', sha: '0123456789abcdef0123456789abcdef01234567' };
let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; });

describe('Preferences: Run setup again (spec §6.1)', () => {
  it('is absent without an account', () => {
    expect(renderToString(h(PreferencesView, { build }))).not.toContain('data-action="run-setup-again"');
  });
  it('with an account it offers the button, which brings the wizard back at step 1', () => {
    const cache = emptyCache();
    const content = { ...EMPTY_SETUP_RECORD, dismissed: true, step: 5, done: [1, 2, 3, 4] };
    cache.records = [record('setup', content, 2)];
    stop = connectSetup(cache, { persist: () => true, change: () => undefined }).stop;
    const html = renderToString(h(PreferencesView, { build }));
    expect(html).toContain(`data-action="run-setup-again">${SETUP_AGAIN}<`);
    expect(html).toContain('Walk through machine, firmware, homing, tools and a first project again.');
    expect(html).not.toMatch(/E-stop|never need|Saved in this browser/);
    // The button's handler is the module's restartSetup: assert through the record it writes.
    restartSetup();
    expect(cache.pending[0]).toMatchObject({ content: { dismissed: false, step: 1, done: [] } });
  });
});
